import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Optional, List
from pathlib import Path
from fastapi import FastAPI, Depends, Query, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import select, func, desc, asc
from sqlalchemy.ext.asyncio import AsyncSession
import trimesh

from .config import LIBRARY_PATH, DATA_DIR, THUMBNAILS_DIR, PREVIEWS_DIR
from .database import init_db, get_db
from .models import ModelItem
from .scanner import scanner

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Inicializa as tabelas do banco de dados na inicialização
    await init_db()

    # Normalizar caminhos com backslash salvos anteriormente no Windows
    try:
        from sqlalchemy import text
        from .database import engine
        async with engine.begin() as conn:
            await conn.execute(text("UPDATE models SET relative_path = replace(relative_path, '\\', '/') WHERE relative_path LIKE '%\\%'"))
    except Exception as e:
        logger.warning(f"Aviso ao normalizar caminhos: {e}")

    # Limpar caches de GLBs de mesas anteriores para evitar mistura de modelos
    try:
        for p in PREVIEWS_DIR.glob("*_plate_*.glb"):
            try:
                p.unlink()
            except Exception:
                pass
    except Exception as e:
        logger.warning(f"Aviso ao limpar cache de mesas: {e}")

    # Inicia uma primeira varredura automática se a biblioteca existir
    if LIBRARY_PATH.exists():
        await scanner.start_scan()
    yield

app = FastAPI(
    title="STLManager API",
    description="Intelligent 3D Model Manager (STL/OBJ/3MF)",
    version="0.1.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Schemas para atualização
class ModelUpdateSchema(BaseModel):
    category: Optional[str] = None
    tags: Optional[List[str]] = None
    notes: Optional[str] = None
    is_favorite: Optional[bool] = None

class ThumbnailUploadSchema(BaseModel):
    image_base64: str

@app.get("/api/health")
async def health():
    return {"status": "ok", "library_path": str(LIBRARY_PATH)}

@app.post("/api/scan/start")
async def start_scan(custom_path: Optional[str] = None):
    started = await scanner.start_scan(custom_path)
    if not started:
        return {"status": "already_running", "message": "Uma varredura já está em andamento."}
    return {"status": "started", "message": "Varredura iniciada com sucesso."}

@app.get("/api/scan/status")
async def scan_status():
    return scanner.get_status()

@app.get("/api/stats")
async def get_stats(db: AsyncSession = Depends(get_db)):
    # Total de modelos
    total_query = select(func.count(ModelItem.id))
    total_models = (await db.execute(total_query)).scalar() or 0

    # Tamanho total em bytes
    size_query = select(func.sum(ModelItem.file_size_bytes))
    total_size_bytes = (await db.execute(size_query)).scalar() or 0

    # Status Triplo: Sólido, Não-Sólido e Projeto
    project_query = select(func.count(ModelItem.id)).where(ModelItem.file_extension == ".3mf")
    project_count = (await db.execute(project_query)).scalar() or 0

    solid_query = select(func.count(ModelItem.id)).where(ModelItem.is_watertight == True, ModelItem.file_extension != ".3mf")
    solid_count = (await db.execute(solid_query)).scalar() or 0

    non_solid_query = select(func.count(ModelItem.id)).where(ModelItem.is_watertight == False, ModelItem.file_extension != ".3mf")
    non_solid_count = (await db.execute(non_solid_query)).scalar() or 0

    # Duplicatas
    dup_query = select(func.count(ModelItem.id)).where(ModelItem.is_duplicate == True)
    duplicate_count = (await db.execute(dup_query)).scalar() or 0

    # Contagem por categoria
    cat_query = select(ModelItem.category, func.count(ModelItem.id)).group_by(ModelItem.category)
    cat_results = (await db.execute(cat_query)).all()
    categories_breakdown = {cat: count for cat, count in cat_results}

    return {
        "total_models": total_models,
        "total_size_mb": round(total_size_bytes / (1024 * 1024), 2),
        "solid_count": solid_count,
        "project_count": project_count,
        "non_solid_count": non_solid_count,
        "watertight_count": solid_count, # retrocompatibilidade
        "duplicate_count": duplicate_count,
        "categories": categories_breakdown
    }

@app.get("/api/models")
async def list_models(
    search: Optional[str] = Query(None, description="Filtra por nome, tags ou caminho"),
    category: Optional[str] = Query(None, description="Filtra por categoria"),
    folder: Optional[str] = Query(None, description="Filtra por caminho da pasta"),
    status: Optional[str] = Query(None, description="Filtra por status: solid, non_solid, project"),
    is_watertight: Optional[bool] = Query(None),
    is_duplicate: Optional[bool] = Query(None),
    is_favorite: Optional[bool] = Query(None),
    sort_by: str = Query("name", pattern="^(name|size|date|triangles|volume)$"),
    order: str = Query("asc", pattern="^(asc|desc)$"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(ModelItem)

    if search:
        search_fmt = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            func.lower(ModelItem.filename).like(search_fmt) |
            func.lower(ModelItem.tags).like(search_fmt) |
            func.lower(func.replace(ModelItem.relative_path, '\\', '/')).like(search_fmt) |
            func.lower(func.replace(ModelItem.filepath, '\\', '/')).like(search_fmt)
        )

    if category:
        stmt = stmt.where(ModelItem.category == category)

    if folder:
        norm_folder = folder.replace('\\', '/').strip('/').lower()
        stmt = stmt.where(func.lower(func.replace(ModelItem.relative_path, '\\', '/')).like(f"%{norm_folder}%"))

    if status == "project":
        stmt = stmt.where(ModelItem.file_extension == ".3mf")
    elif status == "solid":
        stmt = stmt.where(ModelItem.is_watertight == True, ModelItem.file_extension != ".3mf")
    elif status == "non_solid":
        stmt = stmt.where(ModelItem.is_watertight == False, ModelItem.file_extension != ".3mf")

    if is_watertight is not None:
        stmt = stmt.where(ModelItem.is_watertight == is_watertight)

    if is_duplicate is not None:
        stmt = stmt.where(ModelItem.is_duplicate == is_duplicate)

    if is_favorite is not None:
        stmt = stmt.where(ModelItem.is_favorite == is_favorite)

    # Ordenação
    order_func = desc if order == "desc" else asc
    if sort_by == "name":
        stmt = stmt.order_by(order_func(ModelItem.filename))
    elif sort_by == "size":
        stmt = stmt.order_by(order_func(ModelItem.file_size_bytes))
    elif sort_by == "date":
        stmt = stmt.order_by(order_func(ModelItem.file_mtime))
    elif sort_by == "triangles":
        stmt = stmt.order_by(order_func(ModelItem.triangles_count))
    elif sort_by == "volume":
        stmt = stmt.order_by(order_func(ModelItem.volume_cm3))

    # Paginação
    stmt = stmt.offset(offset).limit(limit)
    result = await db.execute(stmt)
    models = result.scalars().all()

    return [m.to_dict() for m in models]

@app.get("/api/models/{model_id}")
async def get_model(model_id: int, db: AsyncSession = Depends(get_db)):
    stmt = select(ModelItem).where(ModelItem.id == model_id)
    res = await db.execute(stmt)
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")
    return item.to_dict()

@app.patch("/api/models/{model_id}")
async def update_model(model_id: int, payload: ModelUpdateSchema, db: AsyncSession = Depends(get_db)):
    stmt = select(ModelItem).where(ModelItem.id == model_id)
    res = await db.execute(stmt)
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")

    if payload.category is not None:
        item.category = payload.category
    if payload.tags is not None:
        item.tags = ",".join(payload.tags)
    if payload.notes is not None:
        item.notes = payload.notes
    if payload.is_favorite is not None:
        item.is_favorite = payload.is_favorite

    await db.commit()
    await db.refresh(item)
    return item.to_dict()

@app.get("/api/models/{model_id}/file")
async def get_model_file(model_id: int, db: AsyncSession = Depends(get_db)):
    stmt = select(ModelItem).where(ModelItem.id == model_id)
    res = await db.execute(stmt)
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")

    p = Path(item.filepath)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Arquivo físico não encontrado no disco.")

    if item.file_extension == ".stl":
        media_type = "application/sla"
    elif item.file_extension == ".3mf":
        media_type = "model/3mf"
    elif item.file_extension == ".obj":
        media_type = "model/obj"
    else:
        media_type = "application/octet-stream"
    return FileResponse(
        path=str(p),
        media_type=media_type,
        filename=item.filename
    )

@app.get("/api/models/{model_id}/thumbnail")
async def get_model_thumbnail(model_id: int, db: AsyncSession = Depends(get_db)):
    stmt = select(ModelItem).where(ModelItem.id == model_id)
    res = await db.execute(stmt)
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")

    webp_path = THUMBNAILS_DIR / f"{item.file_hash}.webp"
    if webp_path.exists():
        return FileResponse(path=str(webp_path), media_type="image/webp")

    png_path = THUMBNAILS_DIR / f"{item.file_hash}.png"
    if png_path.exists():
        return FileResponse(path=str(png_path), media_type="image/png")

    # Se for arquivo .3mf, extrai a imagem embutida gerada pelo fatiador
    if item.file_extension == ".3mf" and Path(item.filepath).exists():
        import zipfile
        try:
            with zipfile.ZipFile(item.filepath) as z:
                names = z.namelist()
                candidates = [
                    'Metadata/plate_1.png',
                    'Auxiliaries/.thumbnails/thumbnail_middle.png',
                    'Auxiliaries/.thumbnails/thumbnail_3mf.png'
                ]
                chosen = None
                for c in candidates:
                    if c in names:
                        chosen = c
                        break
                if not chosen:
                    for n in names:
                        if n.lower().endswith(('.png', '.jpg')) and ('thumbnail' in n.lower() or 'plate' in n.lower()):
                            chosen = n
                            break
                if chosen:
                    img_data = z.read(chosen)
                    with open(png_path, "wb") as f:
                        f.write(img_data)
                    return FileResponse(path=str(png_path), media_type="image/png")
        except Exception as e:
            pass

    raise HTTPException(status_code=404, detail="Thumbnail não disponível.")


@app.post("/api/models/{model_id}/thumbnail")
async def upload_model_thumbnail(model_id: int, payload: ThumbnailUploadSchema, db: AsyncSession = Depends(get_db)):
    stmt = select(ModelItem).where(ModelItem.id == model_id)
    res = await db.execute(stmt)
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")

    raw_data = payload.image_base64
    if "," in raw_data:
        raw_data = raw_data.split(",", 1)[1]

    import base64
    try:
        image_bytes = base64.b64decode(raw_data)
        thumb_path = THUMBNAILS_DIR / f"{item.file_hash}.webp"
        with open(thumb_path, "wb") as f:
            f.write(image_bytes)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Erro ao salvar thumbnail: {e}")

    return {"status": "saved", "thumbnail_url": f"/api/models/{item.id}/thumbnail"}

@app.get("/api/models/{model_id}/mesh.glb")
async def get_model_glb(model_id: int, db: AsyncSession = Depends(get_db)):
    stmt = select(ModelItem).where(ModelItem.id == model_id)
    res = await db.execute(stmt)
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")

    glb_path = PREVIEWS_DIR / f"{item.file_hash}.glb"
    if glb_path.exists():
        return FileResponse(path=str(glb_path), media_type="model/gltf-binary")

    # Arquivos multi-mesa gigantes (> 40MB ou > 2M triângulos)
    if item.file_size_bytes > 40 * 1024 * 1024 or item.triangles_count > 2_000_000:
        size_mb = round(item.file_size_bytes / (1024 * 1024), 1)
        raise HTTPException(
            status_code=413,
            detail=f"Este projeto é muito grande ({size_mb} MB / {item.triangles_count:,} triângulos) para renderização WebGL direta. Recomendado baixar para abrir no fatiador."
        )

    # Converter em threadpool
    loop = asyncio.get_running_loop()
    def convert_to_glb():
        loaded = trimesh.load(item.filepath)
        glb_data = loaded.export(file_type='glb')
        with open(glb_path, 'wb') as f:
            f.write(glb_data)
        return glb_path

    try:
        await loop.run_in_executor(None, convert_to_glb)
    except Exception as e:
        logger.error(f"Erro ao converter modelo {item.id} para GLB: {e}")
        raise HTTPException(status_code=500, detail=f"Falha ao gerar malha GLB: {e}")

    return FileResponse(path=str(glb_path), media_type="model/gltf-binary")

@app.get("/api/models/{model_id}/plates")
async def get_model_plates(model_id: int, db: AsyncSession = Depends(get_db)):
    stmt = select(ModelItem).where(ModelItem.id == model_id)
    res = await db.execute(stmt)
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")

    if item.file_extension != ".3mf":
        return {"is_project": False, "total_plates": 0, "plates": []}

    filepath = Path(item.filepath)
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Arquivo físico não encontrado no disco.")

    loop = asyncio.get_running_loop()

    def parse_plates():
        import zipfile
        import re
        import json
        import xml.etree.ElementTree as ET

        plates = []
        try:
            with zipfile.ZipFile(filepath) as z:
                namelist = set(z.namelist())

                # Parse slice_info.config se existir (contém tempos, filamentos, gramas e peças por mesa)
                slice_plates = {}
                if 'Metadata/slice_info.config' in namelist:
                    try:
                        root = ET.fromstring(z.read('Metadata/slice_info.config').decode('utf-8'))
                        for p in root.findall('plate'):
                            idx_meta = p.find("metadata[@key='index']")
                            if idx_meta is not None:
                                idx = int(idx_meta.attrib.get('value', '0'))
                                time_meta = p.find("metadata[@key='prediction']")
                                weight_meta = p.find("metadata[@key='weight']")
                                fil = p.find('filament')
                                objs = [o.attrib.get('name') for o in p.findall('object') if o.attrib.get('name')]
                                slice_plates[idx] = {
                                    'prediction_seconds': int(time_meta.attrib.get('value')) if time_meta is not None and time_meta.attrib.get('value') else None,
                                    'weight_g': float(weight_meta.attrib.get('value')) if weight_meta is not None and weight_meta.attrib.get('value') else None,
                                    'filament_type': fil.attrib.get('type') if fil is not None else None,
                                    'filament_color': fil.attrib.get('color') if fil is not None else None,
                                    'objects': objs
                                }
                    except Exception as e:
                        logger.warning(f"Erro ao parsear slice_info.config de {filepath}: {e}")

                # Detectar todas as mesas com renderização
                plate_indices = set()
                for name in namelist:
                    m = re.match(r'^Metadata/plate_(\d+)\.png$', name)
                    if m:
                        plate_indices.add(int(m.group(1)))

                for idx in sorted(plate_indices):
                    info = {
                        'index': idx,
                        'title': f'Mesa {idx}',
                        'image_url': f'/api/models/{model_id}/plates/{idx}/image',
                        'thumb_url': f'/api/models/{model_id}/plates/{idx}/image?size=small' if f'Metadata/plate_{idx}_small.png' in namelist else f'/api/models/{model_id}/plates/{idx}/image',
                        'objects': [],
                        'bed_type': None,
                        'nozzle_diameter': None,
                        'print_time_str': None,
                        'filament_weight_g': None,
                        'filament_type': None,
                        'filament_color': None
                    }

                    if idx in slice_plates:
                        sp = slice_plates[idx]
                        info['objects'] = sp.get('objects', [])
                        info['filament_weight_g'] = sp.get('weight_g')
                        info['filament_type'] = sp.get('filament_type')
                        info['filament_color'] = sp.get('filament_color')
                        secs = sp.get('prediction_seconds')
                        if secs:
                            h = secs // 3600
                            m = (secs % 3600) // 60
                            info['print_time_str'] = f'{h}h {m}m' if h > 0 else f'{m}m'

                    json_name = f'Metadata/plate_{idx}.json'
                    if json_name in namelist:
                        try:
                            pjson = json.loads(z.read(json_name).decode('utf-8'))
                            info['bed_type'] = pjson.get('bed_type')
                            info['nozzle_diameter'] = pjson.get('nozzle_diameter')
                            if not info['objects'] and 'bbox_objects' in pjson:
                                info['objects'] = [bo.get('name') for bo in pjson['bbox_objects'] if bo.get('name')]
                        except Exception:
                            pass

                    plates.append(info)
        except Exception as e:
            logger.error(f"Erro ao extrair mesas de {filepath}: {e}")

        return {
            "model_id": model_id,
            "filename": item.filename,
            "is_project": len(plates) > 0,
            "total_plates": len(plates),
            "plates": plates
        }

    return await loop.run_in_executor(None, parse_plates)


@app.get("/api/models/{model_id}/plates/{plate_num}/image")
async def get_model_plate_image(model_id: int, plate_num: int, size: str = "full", db: AsyncSession = Depends(get_db)):
    stmt = select(ModelItem).where(ModelItem.id == model_id)
    res = await db.execute(stmt)
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")

    if item.file_extension != ".3mf":
        raise HTTPException(status_code=400, detail="Apenas arquivos .3mf possuem mesas.")

    filepath = Path(item.filepath)
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Arquivo físico não encontrado no disco.")

    import zipfile

    try:
        with zipfile.ZipFile(filepath) as z:
            names = set(z.namelist())
            target_name = None
            if size == "small" and f"Metadata/plate_{plate_num}_small.png" in names:
                target_name = f"Metadata/plate_{plate_num}_small.png"
            elif f"Metadata/plate_{plate_num}.png" in names:
                target_name = f"Metadata/plate_{plate_num}.png"
            elif f"Metadata/plate_{plate_num}_small.png" in names:
                target_name = f"Metadata/plate_{plate_num}_small.png"

            if not target_name:
                raise HTTPException(status_code=404, detail=f"Imagem da mesa {plate_num} não encontrada.")

            img_bytes = z.read(target_name)
            return Response(
                content=img_bytes,
                media_type="image/png",
                headers={"Cache-Control": "public, max-age=86400"}
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao carregar imagem da mesa {plate_num} de {filepath}: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao ler imagem da mesa: {e}")

@app.get("/api/folders")
async def list_folders(db: AsyncSession = Depends(get_db)):
    from .folders import build_folder_tree
    stmt = select(ModelItem)
    res = await db.execute(stmt)
    models = res.scalars().all()
    return build_folder_tree(models)

@app.get("/api/projects")
async def list_projects(
    folder: Optional[str] = Query(None, description="Filtra por caminho da pasta"),
    search: Optional[str] = Query(None, description="Filtra por nome, tags ou caminho"),
    status: Optional[str] = Query(None, description="Filtra por status: solid, non_solid, project"),
    db: AsyncSession = Depends(get_db)
):
    from .folders import build_projects_list
    stmt = select(ModelItem)

    if folder:
        norm_folder = folder.replace('\\', '/').strip('/').lower()
        stmt = stmt.where(func.lower(func.replace(ModelItem.relative_path, '\\', '/')).like(f"%{norm_folder}%"))

    if search:
        search_fmt = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            func.lower(ModelItem.filename).like(search_fmt) |
            func.lower(ModelItem.tags).like(search_fmt) |
            func.lower(func.replace(ModelItem.relative_path, '\\', '/')).like(search_fmt) |
            func.lower(func.replace(ModelItem.filepath, '\\', '/')).like(search_fmt)
        )

    if status == "project":
        stmt = stmt.where(ModelItem.file_extension == ".3mf")
    elif status == "solid":
        stmt = stmt.where(ModelItem.is_watertight == True, ModelItem.file_extension != ".3mf")
    elif status == "non_solid":
        stmt = stmt.where(ModelItem.is_watertight == False, ModelItem.file_extension != ".3mf")

    res = await db.execute(stmt)
    models = res.scalars().all()
    return build_projects_list(models)

class OpenProjectSchema(BaseModel):
    project_id: str
    slicer: Optional[str] = "bambu"

@app.post("/api/models/{model_id}/open")
async def open_model_in_slicer(
    model_id: int, 
    slicer: str = Query("bambu", description="Fatiador: bambu, orca, cura, default"), 
    db: AsyncSession = Depends(get_db)
):
    from .slicer import open_files_in_slicer
    stmt = select(ModelItem).where(ModelItem.id == model_id)
    res = await db.execute(stmt)
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")
    
    result = open_files_in_slicer([item.filepath], slicer_name=slicer)
    return result

@app.post("/api/models/{model_id}/open-folder")
async def open_model_folder(model_id: int, db: AsyncSession = Depends(get_db)):
    from .slicer import open_folder_in_explorer
    stmt = select(ModelItem).where(ModelItem.id == model_id)
    res = await db.execute(stmt)
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")
    
    result = open_folder_in_explorer(item.filepath)
    return result

@app.post("/api/projects/open")
async def open_project_in_slicer(payload: OpenProjectSchema, db: AsyncSession = Depends(get_db)):
    from .slicer import open_files_in_slicer
    project_id = payload.project_id
    slicer = payload.slicer or "bambu"

    if project_id.startswith("file:"):
        model_id = int(project_id.split(":", 1)[1])
        stmt = select(ModelItem).where(ModelItem.id == model_id)
        res = await db.execute(stmt)
        item = res.scalar_one_or_none()
        if not item:
            raise HTTPException(status_code=404, detail="Arquivo do projeto não encontrado.")
        return open_files_in_slicer([item.filepath], slicer_name=slicer)

    elif project_id.startswith("folder:"):
        folder_path = project_id.split(":", 1)[1]
        norm_folder = folder_path.replace('\\', '/').strip('/').lower()
        stmt = select(ModelItem).where(
            func.lower(func.replace(ModelItem.relative_path, '\\', '/')).like(f"%{norm_folder}%")
        )
        res = await db.execute(stmt)
        items = res.scalars().all()
        if not items:
            raise HTTPException(status_code=404, detail="Nenhum arquivo encontrado para este projeto.")
        
        filepaths = [i.filepath for i in items]
        return open_files_in_slicer(filepaths, slicer_name=slicer)

    elif project_id.startswith("single:"):
        model_id = int(project_id.split(":", 1)[1])
        stmt = select(ModelItem).where(ModelItem.id == model_id)
        res = await db.execute(stmt)
        item = res.scalar_one_or_none()
        if not item:
            raise HTTPException(status_code=404, detail="Modelo não encontrado.")
        return open_files_in_slicer([item.filepath], slicer_name=slicer)

    else:
        raise HTTPException(status_code=400, detail="Formato de project_id inválido.")

@app.get("/api/models/{model_id}/plates/{plate_num}/mesh.glb")
async def get_model_plate_glb(model_id: int, plate_num: int, db: AsyncSession = Depends(get_db)):
    stmt = select(ModelItem).where(ModelItem.id == model_id)
    res = await db.execute(stmt)
    item = res.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")

    if item.file_extension != ".3mf":
        raise HTTPException(status_code=400, detail="Apenas arquivos .3mf possuem mesas.")

    filepath = Path(item.filepath)
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Arquivo físico não encontrado no disco.")

    plate_glb_path = PREVIEWS_DIR / f"{item.file_hash}_plate_{plate_num}.glb"
    if plate_glb_path.exists():
        return FileResponse(
            path=str(plate_glb_path),
            media_type="model/gltf-binary",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
        )

    loop = asyncio.get_running_loop()

    def generate_plate_glb():
        import zipfile
        import xml.etree.ElementTree as ET
        import numpy as np
        import trimesh

        def strip_ns(elem):
            for e in elem.iter():
                if '}' in e.tag:
                    e.tag = e.tag.split('}', 1)[1]
            return elem

        def get_mesh_from_model_xml(xml_bytes, target_obj_id=None):
            root = strip_ns(ET.fromstring(xml_bytes))
            meshes = []
            for obj in root.findall('.//object'):
                if target_obj_id and str(obj.attrib.get('id', '')) != str(target_obj_id):
                    continue
                m_elem = obj.find('mesh')
                if m_elem is not None:
                    verts_elem = m_elem.find('vertices')
                    tris_elem = m_elem.find('triangles')
                    if verts_elem is not None and tris_elem is not None:
                        verts = [[float(v.attrib['x']), float(v.attrib['y']), float(v.attrib['z'])] for v in verts_elem.findall('vertex') if 'x' in v.attrib and 'y' in v.attrib and 'z' in v.attrib]
                        tris = [[int(t.attrib['v1']), int(t.attrib['v2']), int(t.attrib['v3'])] for t in tris_elem.findall('triangle') if 'v1' in t.attrib and 'v2' in t.attrib and 'v3' in t.attrib]
                        if verts and tris:
                            meshes.append(trimesh.Trimesh(vertices=verts, faces=tris))
            return meshes

        with zipfile.ZipFile(filepath) as z:
            names = set(z.namelist())
            object_ids = set()

            # 1. Busca mapeamento em Metadata/model_settings.config
            if 'Metadata/model_settings.config' in names:
                try:
                    root_cfg = strip_ns(ET.fromstring(z.read('Metadata/model_settings.config').decode('utf-8', errors='ignore')))
                    for plate in root_cfg.findall('.//plate'):
                        thumb_meta = plate.find("metadata[@key='thumbnail_file']")
                        p_meta = plate.find("metadata[@key='plater_id']")
                        pid = None
                        if p_meta is not None and p_meta.attrib.get('value'):
                            try:
                                pid = int(p_meta.attrib.get('value'))
                            except ValueError:
                                pass
                        if thumb_meta is not None and f'plate_{plate_num}' in thumb_meta.attrib.get('value', ''):
                            pid = plate_num

                        if pid == plate_num:
                            for mi in plate.findall('.//model_instance'):
                                for meta in mi.findall('metadata'):
                                    k = meta.attrib.get('key', '')
                                    v = meta.attrib.get('value', '')
                                    if k in ('object_id', 'identify_id') and v:
                                        object_ids.add(str(v))
                except Exception as e:
                    logger.debug(f"Aviso ao ler model_settings.config: {e}")

            # 2. Fallback em Metadata/slice_info.config
            if not object_ids and 'Metadata/slice_info.config' in names:
                try:
                    root_si = strip_ns(ET.fromstring(z.read('Metadata/slice_info.config').decode('utf-8', errors='ignore')))
                    for p in root_si.findall('.//plate'):
                        idx_meta = p.find("metadata[@key='index']")
                        if idx_meta is not None and int(idx_meta.attrib.get('value', '0')) == plate_num:
                            for obj in p.findall('.//object'):
                                for attr_key in ('id', 'identify_id', 'object_id'):
                                    if attr_key in obj.attrib:
                                        object_ids.add(str(obj.attrib[attr_key]))
                except Exception as e:
                    logger.debug(f"Aviso ao ler slice_info.config: {e}")

            plate_meshes = []
            if '3D/3dmodel.model' in names:
                try:
                    root_3d = strip_ns(ET.fromstring(z.read('3D/3dmodel.model').decode('utf-8', errors='ignore')))
                    for oid in object_ids:
                        for obj in root_3d.findall('.//object'):
                            if str(obj.attrib.get('id', '')) == str(oid):
                                comps = obj.findall('.//component')
                                if comps:
                                    for c in comps:
                                        c_oid = c.attrib.get('objectid') or c.attrib.get('id')
                                        c_path = ''
                                        for attr_k, attr_v in c.attrib.items():
                                            if 'path' in attr_k.lower():
                                                c_path = attr_v.lstrip('/')
                                        if c_path and c_path in names:
                                            sub_meshes = get_mesh_from_model_xml(z.read(c_path), c_oid)
                                            plate_meshes.extend(sub_meshes)
                                        elif c_oid:
                                            sub_meshes = get_mesh_from_model_xml(z.read('3D/3dmodel.model'), c_oid)
                                            plate_meshes.extend(sub_meshes)
                                else:
                                    sub_meshes = get_mesh_from_model_xml(z.read('3D/3dmodel.model'), oid)
                                    plate_meshes.extend(sub_meshes)
                except Exception as e:
                    logger.debug(f"Aviso ao ler 3dmodel.model: {e}")

            if not plate_meshes:
                # NUNCA salvar o arquivo inteiro no preview da mesa individual!
                raise HTTPException(
                    status_code=404, 
                    detail=f"Malha 3D isolada não disponível para a mesa {plate_num}."
                )

            combined = trimesh.util.concatenate(plate_meshes)
            glb_data = combined.export(file_type='glb')
            with open(plate_glb_path, 'wb') as f:
                f.write(glb_data)
            return plate_glb_path

    try:
        await loop.run_in_executor(None, generate_plate_glb)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao extrair GLB da mesa {plate_num} de {item.id}: {e}")
        raise HTTPException(status_code=500, detail=f"Falha ao gerar malha 3D da mesa: {e}")

    return FileResponse(
        path=str(plate_glb_path), 
        media_type="model/gltf-binary",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
    )

# Servir Frontend Estático
STATIC_DIR = Path(__file__).resolve().parent / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


