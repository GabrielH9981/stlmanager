import re
import unicodedata
from pathlib import Path
from typing import Tuple, List

TAXONOMY = {
    "Decoração & Festividades": [
        "natal", "noel", "arvore", "biscoito", "chapeu", "meia", "gelo", "neve", 
        "snowman", "santa", "christmas", "xmas", "enfeite", "ornamento", "decoracao",
        "decor", "vaso", "vase", "abajur", "lampada", "quadro", "escultura",
        "halloween", "pumpkin", "abobora", "fantasma", "ghost", "witch", "pascoa",
        "easter", "coelho", "bunny", "ovo", "egg"
    ],
    "Peças Funcionais & Suportes": [
        "suporte", "holder", "bracket", "mount", "stand", "base", "apoio",
        "organizador", "organizer", "caixa", "box", "case", "estojo", "gaveta",
        "tampa", "cover", "lid", "gancho", "hook", "clip", "presilha",
        "clamp", "adaptador", "adapter", "conector", "connector"
    ],
    "Miniaturas & Action Figures": [
        "miniatura", "miniature", "mini", "busto", "bust", "figure", "figura",
        "action figure", "estatua", "statue", "rpg", "dnd", "tabletop", "warhammer",
        "dragao", "dragon", "monstro", "monster", "heroi", "hero", "warrior",
        "guerreiro", "skull", "caveira", "pokemon", "anime", "chibi"
    ],
    "Articulados & Flexíveis": [
        "articulado", "articulated", "flexi", "flexivel", "flexible",
        "print in place", "pip", "moving", "chain", "corrente", "lagarto", "lizard"
    ],
    "Ferramentas & Hardware": [
        "ferramenta", "tool", "parafuso", "screw", "bolt", "porca", "nut",
        "engrenagem", "gear", "manopla", "knob", "handle", "puxador",
        "chave", "wrench", "gabarito", "jig", "guia", "guide", "dobradica", "hinge"
    ],
    "Impressora 3D & Upgrades": [
        "ender", "voron", "prusa", "bambu", "elegoo", "anycubic", "klipper",
        "extrusora", "extruder", "hotend", "shroud", "fan duct", "spool",
        "carretel", "filament", "filamento", "tensioner", "tensionador", "bed mount"
    ],
    "Brinquedos & Jogos": [
        "brinquedo", "toy", "jogo", "game", "dado", "dice", "puzzle",
        "quebra-cabeca", "card", "boardgame", "tabuleiro", "fidget", "spinner"
    ]
}

STOP_WORDS = {
    "v1", "v2", "v3", "v4", "final", "stl", "obj", "3mf", "fixed", "remix", 
    "print", "the", "and", "para", "com", "sem", "versao", "version", "copia"
}

def normalize_text(text: str) -> str:
    """Remove acentos e caracteres especiais para comparação flexível."""
    text = unicodedata.normalize('NFKD', text).encode('ASCII', 'ignore').decode('utf-8')
    return text.lower()

def classify_model(filepath: str) -> Tuple[str, List[str]]:
    """
    Analisa o nome do arquivo e a árvore de diretórios para classificar
    o modelo em uma categoria e sugerir tags relevantes.
    """
    path_obj = Path(filepath)
    filename = path_obj.stem
    parent_dirs = [p.name for p in path_obj.parents if p.name and p.name not in {"library", "data", "app"}]
    
    # Texto combinado para busca
    search_context = f"{filename} {' '.join(parent_dirs)}"
    normalized_context = normalize_text(search_context)
    
    # Extrair palavras para tags
    raw_words = re.findall(r'[a-zA-Z0-9]+', normalized_context)
    tags = set()
    for w in raw_words:
        if len(w) > 2 and w not in STOP_WORDS and not w.isdigit():
            tags.add(w)
            
    # Pontuação por categoria
    best_category = "Geral"
    highest_score = 0
    
    for category, keywords in TAXONOMY.items():
        score = 0
        for kw in keywords:
            norm_kw = normalize_text(kw)
            if " " in norm_kw:
                if norm_kw in normalized_context:
                    score += 3
            else:
                # Palavra exata ou prefixo
                if re.search(r'\b' + re.escape(norm_kw), normalized_context):
                    score += 2
                    
        if score > highest_score:
            highest_score = score
            best_category = category

    # Se não atingiu pontuação mínima da taxonomia, usa o diretório pai limpo
    if highest_score < 2:
        from .folders import clean_folder_path, get_folder_root
        try:
            rel = str(path_obj.relative_to(path_obj.anchor))
        except Exception:
            rel = str(path_obj)
        clean_folder = clean_folder_path(rel)
        root_folder = get_folder_root(clean_folder)
        if root_folder and root_folder != 'Raiz':
            best_category = root_folder
        else:
            best_category = "Geral"

    return best_category, sorted(list(tags))
