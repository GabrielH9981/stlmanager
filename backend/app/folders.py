import re
from typing import List, Dict, Any
from pathlib import Path

def clean_folder_path(relative_path: str) -> str:
    """
    Normaliza o caminho relativo de um arquivo para uma estrutura de pastas limpa,
    removendo carimbos de data do Google Drive / ZIPs e redundâncias.
    Exemplo: 'CSGO-20261016T130627Z-1-001/CSGO/ak47/Part_1.stl' -> 'CSGO/ak47'
    """
    parts = relative_path.replace('\\', '/').strip('/').split('/')
    if len(parts) <= 1:
        return 'Raiz'
    
    folder_parts = parts[:-1]
    cleaned = []
    for p in folder_parts:
        # Remove sufixos como '-20261016T130627Z-1-001' gerados por downloads
        c = re.sub(r'-\d{8}T\d{6}Z.*$', '', p).strip()
        if not c:
            continue
        # Evita repetir nomes consecutivos idênticos
        if not cleaned or cleaned[-1].lower() != c.lower():
            cleaned.append(c)
            
    return '/'.join(cleaned) if cleaned else 'Raiz'


def get_folder_root(folder_path: str) -> str:
    """Retorna a pasta raiz de primeiro nível (ex: 'CSGO/ak47' -> 'CSGO')."""
    if not folder_path or folder_path == 'Raiz':
        return 'Raiz'
    return folder_path.split('/')[0]


def build_folder_tree(models: List[Any]) -> List[Dict[str, Any]]:
    """
    Agrupa uma lista de ModelItems por suas pastas limpas e retorna
    uma lista estruturada com contagens e caminhos.
    """
    folders_map: Dict[str, Dict[str, Any]] = {}
    
    for m in models:
        f_path = clean_folder_path(m.relative_path)
        root = get_folder_root(f_path)
        
        if root not in folders_map:
            folders_map[root] = {
                "name": root,
                "path": root,
                "count": 0,
                "total_size_bytes": 0,
                "subfolders": {}
            }
            
        folders_map[root]["count"] += 1
        folders_map[root]["total_size_bytes"] += getattr(m, 'file_size_bytes', 0)
        
        if f_path != root and f_path != 'Raiz':
            sub_name = f_path[len(root):].strip('/')
            if sub_name not in folders_map[root]["subfolders"]:
                folders_map[root]["subfolders"][sub_name] = {
                    "name": sub_name,
                    "path": f_path,
                    "count": 0,
                    "total_size_bytes": 0
                }
            folders_map[root]["subfolders"][sub_name]["count"] += 1
            folders_map[root]["subfolders"][sub_name]["total_size_bytes"] += getattr(m, 'file_size_bytes', 0)
            
    result = []
    for root, data in sorted(folders_map.items()):
        sub_list = sorted(list(data["subfolders"].values()), key=lambda x: x["path"])
        result.append({
            "name": data["name"],
            "path": data["path"],
            "count": data["count"],
            "total_size_bytes": data["total_size_bytes"],
            "subfolders": sub_list
        })
        
    return result


def build_projects_list(models: List[Any]) -> List[Dict[str, Any]]:
    """
    Identifica de forma precisa:
    1. Projetos 3MF (arquivos fatiados com multi-mesas, ex: KATSUYU.3mf, KATSUYU projeto.3mf)
    2. Projetos de Pasta (pastas contendo múltiplas peças STL/OBJ avulsas que compõem uma montagem, ex: CSGO AK47)
    3. Modelos Únicos Avulsos (arquivos individuais)
    """
    folder_groups: Dict[str, List[Any]] = {}
    
    for m in models:
        f_path = clean_folder_path(m.relative_path)
        if f_path not in folder_groups:
            folder_groups[f_path] = []
        folder_groups[f_path].append(m)

    projects: List[Dict[str, Any]] = []

    for f_path, items in folder_groups.items():
        mf3_items = []
        part_items = []
        
        for i in items:
            ext = getattr(i, 'file_extension', '').lower()
            if not ext and hasattr(i, 'filename'):
                ext = Path(i.filename).suffix.lower()
            if ext == '.3mf':
                mf3_items.append(i)
            else:
                part_items.append(i)

        # 1. Cada arquivo .3mf é um Projeto de Fatiador autônomo com suas próprias mesas de impressão
        for m in mf3_items:
            dict_m = m.to_dict() if hasattr(m, 'to_dict') else m
            projects.append({
                "id": f"file:{dict_m['id']}",
                "type": "file_3mf_project",
                "title": dict_m['filename'].rsplit('.', 1)[0].replace('_', ' '),
                "folder_path": f_path,
                "folder_root": f_path.split('/')[0] if f_path != 'Raiz' else 'Raiz',
                "parts_count": 1,
                "total_size_bytes": dict_m['file_size_bytes'],
                "total_size_mb": dict_m.get('file_size_mb', round(dict_m['file_size_bytes'] / (1024 * 1024), 2)),
                "total_triangles": dict_m.get('triangles_count', 0),
                "thumbnail_url": dict_m.get('thumbnail_url'),
                "model_id": dict_m['id'],
                "parts": [dict_m]
            })

        # 2. Peças restantes (.stl, .obj) na pasta:
        # Se houver 2 ou mais peças STL/OBJ, formam um Projeto de Montagem de Pasta
        if len(part_items) >= 2 and f_path != 'Raiz':
            folder_name = f_path.split('/')[-1]
            root_name = f_path.split('/')[0]
            total_size = sum(getattr(i, 'file_size_bytes', 0) for i in part_items)
            total_tris = sum(getattr(i, 'triangles_count', 0) for i in part_items)
            
            rep_item = None
            for i in part_items:
                dict_i = i.to_dict() if hasattr(i, 'to_dict') else i
                if dict_i.get('has_thumbnail'):
                    rep_item = dict_i
                    break
            if not rep_item and part_items:
                rep_item = part_items[0].to_dict() if hasattr(part_items[0], 'to_dict') else part_items[0]

            parts_summary = [i.to_dict() if hasattr(i, 'to_dict') else i for i in part_items]
            parts_summary.sort(key=lambda x: x['filename'])

            projects.append({
                "id": f"folder:{f_path}",
                "type": "folder_project",
                "title": folder_name.replace('_', ' ').title(),
                "folder_path": f_path,
                "folder_root": root_name,
                "parts_count": len(part_items),
                "total_size_bytes": total_size,
                "total_size_mb": round(total_size / (1024 * 1024), 2),
                "total_triangles": total_tris,
                "thumbnail_url": rep_item.get('thumbnail_url') if rep_item else None,
                "parts": parts_summary
            })
        elif len(part_items) == 1:
            # 1 peça STL/OBJ avulsa
            s = part_items[0]
            dict_s = s.to_dict() if hasattr(s, 'to_dict') else s
            projects.append({
                "id": f"single:{dict_s['id']}",
                "type": "single_model",
                "title": dict_s['filename'].rsplit('.', 1)[0].replace('_', ' '),
                "folder_path": f_path,
                "folder_root": f_path.split('/')[0] if f_path != 'Raiz' else 'Raiz',
                "parts_count": 1,
                "total_size_bytes": dict_s['file_size_bytes'],
                "total_size_mb": dict_s.get('file_size_mb', round(dict_s['file_size_bytes'] / (1024 * 1024), 2)),
                "total_triangles": dict_s.get('triangles_count', 0),
                "thumbnail_url": dict_s.get('thumbnail_url'),
                "model_id": dict_s['id'],
                "parts": [dict_s]
            })

    # Ordenar: Projetos (3MF e Montagens de Pasta) primeiro, depois avulsos
    projects.sort(key=lambda x: (
        0 if x['type'] in ('folder_project', 'file_3mf_project') else 1,
        -x['parts_count'],
        x['title'].lower()
    ))
    return projects
