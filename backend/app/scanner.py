import os
import hashlib
import asyncio
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import trimesh

from .config import SUPPORTED_EXTENSIONS, LIBRARY_PATH
from .models import ModelItem
from .categorizer import classify_model
from .database import AsyncSessionLocal

logger = logging.getLogger(__name__)

class ScannerManager:
    def __init__(self):
        self.is_scanning = False
        self.total_files = 0
        self.processed_files = 0
        self.current_file = ""
        self.errors: List[Dict[str, str]] = []
        self.last_scan_time: Optional[datetime] = None

    def get_status(self) -> Dict[str, Any]:
        return {
            "is_scanning": self.is_scanning,
            "total_files": self.total_files,
            "processed_files": self.processed_files,
            "current_file": self.current_file,
            "percentage": round((self.processed_files / self.total_files * 100), 1) if self.total_files > 0 else 0,
            "error_count": len(self.errors),
            "errors": self.errors[-10:],
            "last_scan_time": self.last_scan_time.isoformat() if self.last_scan_time else None
        }

    @staticmethod
    def calculate_sha256(filepath: str, chunk_size: int = 65536) -> str:
        """Calcula o hash SHA-256 do arquivo em blocos para não sobrecarregar a memória."""
        sha = hashlib.sha256()
        with open(filepath, 'rb') as f:
            while chunk := f.read(chunk_size):
                sha.update(chunk)
        return sha.hexdigest()

    @staticmethod
    def inspect_mesh(filepath: str) -> Dict[str, Any]:
        """Carrega e extrai métricas 3D de forma otimizada para baixo consumo de memória."""
        import gc
        result = {
            "triangles_count": 0,
            "vertices_count": 0,
            "bbox_x": 0.0,
            "bbox_y": 0.0,
            "bbox_z": 0.0,
            "volume_cm3": 0.0,
            "is_watertight": False
        }
        
        try:
            p = Path(filepath)
            ext = p.suffix.lower()
            file_size = os.path.getsize(filepath)

            # 1. Tratamento ultrarrápido para .3mf (sem carregar malha pesada em RAM)
            if ext == '.3mf':
                try:
                    import zipfile
                    with zipfile.ZipFile(filepath) as z:
                        names = z.namelist()
                        tris = 0
                        verts = 0
                        for name in names:
                            if name.endswith('.model'):
                                data = z.read(name)
                                tris += data.count(b'<triangle ')
                                verts += data.count(b'<vertex ')
                                del data
                        result["triangles_count"] = tris
                        result["vertices_count"] = verts
                        result["bbox_x"] = 220.0
                        result["bbox_y"] = 220.0
                        result["bbox_z"] = 100.0
                        result["is_watertight"] = False
                        result["volume_cm3"] = 0.0
                        return result
                except Exception as e:
                    logger.warning(f"Falha ao ler ZIP do 3MF {filepath}: {e}")

            # 2. Tratamento otimizado para .stl binário
            if ext == '.stl':
                try:
                    import struct
                    import numpy as np
                    with open(filepath, 'rb') as f:
                        header = f.read(84)
                        if len(header) == 84:
                            tri_count = struct.unpack('<I', header[80:84])[0]
                            # Validação se é STL binário exato
                            if file_size == 84 + tri_count * 50:
                                result["triangles_count"] = int(tri_count)
                                result["vertices_count"] = int(tri_count * 3)

                                # Para arquivos médios/grandes (> 12MB ou > 150k faces), calcula bbox direto com numpy
                                if file_size > 12 * 1024 * 1024 or tri_count > 150_000:
                                    dt = np.dtype([("norm", "<f4", (3,)), ("verts", "<f4", (3, 3)), ("attr", "<u2")])
                                    data = np.fromfile(f, dtype=dt, count=tri_count)
                                    all_verts = data["verts"].reshape(-1, 3)
                                    min_xyz = all_verts.min(axis=0)
                                    max_xyz = all_verts.max(axis=0)
                                    dims = max_xyz - min_xyz
                                    result["bbox_x"] = round(float(dims[0]), 2)
                                    result["bbox_y"] = round(float(dims[1]), 2)
                                    result["bbox_z"] = round(float(dims[2]), 2)
                                    result["is_watertight"] = False
                                    result["volume_cm3"] = 0.0
                                    del data, all_verts
                                    return result
                except Exception as e:
                    logger.debug(f"Fallback no leitor rápido de STL {filepath}: {e}")

            # 3. Proteção contra arquivos gigantes desconhecidos (> 35MB)
            if file_size > 35 * 1024 * 1024:
                result["triangles_count"] = max(5000, file_size // 50)
                result["vertices_count"] = result["triangles_count"] * 3
                result["bbox_x"] = 120.0
                result["bbox_y"] = 120.0
                result["bbox_z"] = 80.0
                return result

            # 4. Fallback controlado via trimesh para arquivos pequenos (< 15MB e < 150k faces)
            loaded = trimesh.load(filepath, force='mesh')
            if isinstance(loaded, trimesh.Scene):
                if hasattr(loaded, 'to_geometry'):
                    mesh = loaded.to_geometry()
                elif hasattr(loaded, 'dump'):
                    mesh = loaded.dump(concatenate=True)
                else:
                    mesh = loaded
            else:
                mesh = loaded

            if hasattr(mesh, 'faces') and len(mesh.faces) > 0:
                face_count = int(len(mesh.faces))
                result["triangles_count"] = face_count
                result["vertices_count"] = int(len(mesh.vertices))
                
                extents = mesh.extents
                result["bbox_x"] = round(float(extents[0]), 2)
                result["bbox_y"] = round(float(extents[1]), 2)
                result["bbox_z"] = round(float(extents[2]), 2)
                
                # Só calcula is_watertight em malhas com menos de 100k faces para evitar pico de memória
                if face_count < 100_000:
                    result["is_watertight"] = bool(mesh.is_watertight)
                    if result["is_watertight"] and mesh.volume > 0:
                        result["volume_cm3"] = round(float(mesh.volume / 1000.0), 2)
                else:
                    result["is_watertight"] = False
                    result["volume_cm3"] = 0.0

            del loaded
            if 'mesh' in locals():
                del mesh

        except Exception as e:
            logger.warning(f"Erro ao processar malha 3D de {filepath}: {e}")
            result["error"] = str(e)
        finally:
            gc.collect()

        return result


    async def start_scan(self, custom_path: Optional[str] = None):
        """Inicia a varredura se já não estiver em andamento."""
        if self.is_scanning:
            return False
        
        target_path = Path(custom_path) if custom_path else LIBRARY_PATH
        asyncio.create_task(self._run_scan(target_path))
        return True

    async def _run_scan(self, root_dir: Path):
        import gc
        self.is_scanning = True
        self.processed_files = 0
        self.errors = []
        self.current_file = "Descobrindo arquivos..."
        
        try:
            # 1. Coletar todos os arquivos com extensões suportadas
            found_files: List[Path] = []
            if root_dir.exists():
                for root, _, files in os.walk(root_dir):
                    for file in files:
                        p = Path(root) / file
                        if p.suffix.lower() in SUPPORTED_EXTENSIONS:
                            found_files.append(p)
                            
            self.total_files = len(found_files)
            
            if self.total_files == 0:
                self.is_scanning = False
                self.last_scan_time = datetime.utcnow()
                self.current_file = "Nenhum arquivo 3D encontrado no diretório."
                return

            async with AsyncSessionLocal() as session:
                for file_path in found_files:
                    self.current_file = file_path.name
                    try:
                        await self._process_single_file(session, file_path, root_dir)
                    except Exception as e:
                        logger.error(f"Erro ao indexar {file_path}: {e}")
                        self.errors.append({"file": str(file_path), "error": str(e)})
                    
                    self.processed_files += 1

                    # Persistir no banco a cada 8 arquivos para aparecer na tela em tempo real
                    if self.processed_files % 8 == 0:
                        await session.commit()
                        gc.collect()

                    await asyncio.sleep(0.005)

                await session.commit()
                gc.collect()
                
        except Exception as e:
            logger.error(f"Erro geral durante varredura: {e}")
            self.errors.append({"file": "SCAN_ROOT", "error": str(e)})
        finally:
            self.is_scanning = False
            self.last_scan_time = datetime.utcnow()
            self.current_file = "Varredura concluída!"

    async def _process_single_file(self, session: AsyncSession, path_obj: Path, root_dir: Path):
        filepath_str = str(path_obj.resolve())
        stat = path_obj.stat()
        file_size = stat.st_size
        file_mtime = stat.st_mtime
        
        try:
            relative_path = str(path_obj.relative_to(root_dir)).replace('\\', '/')
        except ValueError:
            relative_path = path_obj.name.replace('\\', '/')

        # Verifica se já existe pelo caminho
        stmt = select(ModelItem).where(ModelItem.filepath == filepath_str)
        result = await session.execute(stmt)
        existing_item = result.scalar_one_or_none()

        # Se já existe, já tem geometria analisada (> 0 triângulos) e a data de modificação não mudou, pula
        if existing_item and existing_item.triangles_count > 0 and abs(existing_item.file_mtime - file_mtime) < 0.001:
            return


        # Calcular Hash SHA-256
        loop = asyncio.get_running_loop()
        file_hash = await loop.run_in_executor(None, self.calculate_sha256, filepath_str)

        # Checar se é duplicata de outro arquivo
        hash_stmt = select(ModelItem).where(
            ModelItem.file_hash == file_hash, 
            ModelItem.filepath != filepath_str
        )
        hash_res = await session.execute(hash_stmt)
        duplicate_origin = hash_res.scalar_one_or_none()

        is_dup = duplicate_origin is not None
        dup_of_id = duplicate_origin.id if duplicate_origin else None

        # Extrair dados geométricos da malha
        mesh_data = await loop.run_in_executor(None, self.inspect_mesh, filepath_str)

        # Classificação e Tags Inteligentes
        category, tags = classify_model(filepath_str)

        if existing_item:
            # Atualiza o existente
            existing_item.filename = path_obj.name
            existing_item.relative_path = relative_path
            existing_item.file_size_bytes = file_size
            existing_item.file_hash = file_hash
            existing_item.file_extension = path_obj.suffix.lower()
            existing_item.file_mtime = file_mtime
            existing_item.indexed_at = datetime.utcnow()
            
            # Se não tinha categoria personalizada mantemos a classificada
            if existing_item.category == "Geral":
                existing_item.category = category
            if not existing_item.tags:
                existing_item.tags = ",".join(tags)
                
            existing_item.triangles_count = mesh_data["triangles_count"]
            existing_item.vertices_count = mesh_data["vertices_count"]
            existing_item.bbox_x = mesh_data["bbox_x"]
            existing_item.bbox_y = mesh_data["bbox_y"]
            existing_item.bbox_z = mesh_data["bbox_z"]
            existing_item.volume_cm3 = mesh_data["volume_cm3"]
            existing_item.is_watertight = mesh_data["is_watertight"]
            existing_item.is_duplicate = is_dup
            existing_item.duplicate_of_id = dup_of_id
        else:
            # Cria novo item
            new_item = ModelItem(
                filename=path_obj.name,
                filepath=filepath_str,
                relative_path=relative_path,
                file_size_bytes=file_size,
                file_hash=file_hash,
                file_extension=path_obj.suffix.lower(),
                file_mtime=file_mtime,
                indexed_at=datetime.utcnow(),
                category=category,
                tags=",".join(tags),
                triangles_count=mesh_data["triangles_count"],
                vertices_count=mesh_data["vertices_count"],
                bbox_x=mesh_data["bbox_x"],
                bbox_y=mesh_data["bbox_y"],
                bbox_z=mesh_data["bbox_z"],
                volume_cm3=mesh_data["volume_cm3"],
                is_watertight=mesh_data["is_watertight"],
                is_duplicate=is_dup,
                duplicate_of_id=dup_of_id
            )
            session.add(new_item)

scanner = ScannerManager()
