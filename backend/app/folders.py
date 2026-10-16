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
    Identifica tanto projetos baseados em pastas (pastas com múltiplas peças)
    quanto projetos baseados em arquivos (.3mf com múltiplas mesas/objetos).
    """
    # 1. Agrupar modelos por pasta
    folder_groups: Dict[str, List[Any]] = {}
    standalone_3mfs = []
    standalone_singles = []
    
    for m in models:
        f_path = clean_folder_path(m.relative_path)
        if f_path not in folder_groups:
            folder_groups[f_path] = []
        folder_groups[f_path].append(m)

    projects: List[Dict[str, Any]] = []

    for f_path, items in folder_groups.items():
        # Se a pasta tem 2 ou mais arquivos, ela é tratada como um Projeto Multi-Peças
        if len(items) >= 2 and f_path != 'Raiz':
            folder_name = f_path.split('/')[-1]
            root_name = f_path.split('/')[0]
            
            total_size = sum(getattr(i, 'file_size_bytes', 0) for i in items)
            total_tris = sum(getattr(i, 'triangles_count', 0) for i in items)
            
            # Encontra um item com thumbnail para representar o projeto
            rep_item = None
            for i in items:
                dict_i = i.to_dict() if hasattr(i, 'to_dict') else i
                if dict_i.get('has_thumbnail'):
                    rep_item = dict_i
                    break
            if not rep_item and items:
                rep_item = items[0].to_dict() if hasattr(items[0], 'to_dict') else items[0]
                
            parts_summary = [i.to_dict() if hasattr(i, 'to_dict') else i for i in items]
            parts_summary.sort(key=lambda x: x['filename'])

            projects.append({
                "id": f"folder:{f_path}",
                "type": "folder_project",
                "title": folder_name.replace('_', ' ').title(),
                "folder_path": f_path,
                "folder_root": root_name,
                "parts_count": len(items),
                "total_size_bytes": total_size,
                "total_size_mb": round(total_size / (1024 * 1024), 2),
                "total_triangles": total_tris,
                "thumbnail_url": rep_item.get('thumbnail_url') if rep_item else None,
                "parts": parts_summary
            })
        else:
            # Arquivo avulso ou projeto 3mf
            for i in items:
                dict_i = i.to_dict() if hasattr(i, 'to_dict') else i
                if dict_i.get('file_extension') == '.3mf':
                    standalone_3mfs.append(dict_i)
                else:
                    standalone_singles.append(dict_i)

    # Adicionar projetos .3mf avulsos como projetos
    for m in standalone_3mfs:
        projects.append({
            "id": f"file:{m['id']}",
            "type": "file_3mf_project",
            "title": m['filename'].rsplit('.', 1)[0].replace('_', ' '),
            "folder_path": m.get('folder_path', 'Raiz'),
            "folder_root": m.get('folder_root', 'Raiz'),
            "parts_count": 1,
            "total_size_bytes": m['file_size_bytes'],
            "total_size_mb": m['file_size_mb'],
            "total_triangles": m['triangles_count'],
            "thumbnail_url": m.get('thumbnail_url'),
            "model_id": m['id'],
            "parts": [m]
        })

    # Adicionar arquivos avulsos individuais
    for s in standalone_singles:
        projects.append({
            "id": f"single:{s['id']}",
            "type": "single_model",
            "title": s['filename'].rsplit('.', 1)[0].replace('_', ' '),
            "folder_path": s.get('folder_path', 'Raiz'),
            "folder_root": s.get('folder_root', 'Raiz'),
            "parts_count": 1,
            "total_size_bytes": s['file_size_bytes'],
            "total_size_mb": s['file_size_mb'],
            "total_triangles": s['triangles_count'],
            "thumbnail_url": s.get('thumbnail_url'),
            "model_id": s['id'],
            "parts": [s]
        })

    # Ordenar: primeiro projetos com mais peças, depois por título
    projects.sort(key=lambda x: (-x['parts_count'], x['title'].lower()))
    return projects
