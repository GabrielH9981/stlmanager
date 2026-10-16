import os
import sys
import shutil
import logging
import subprocess
from pathlib import Path
from typing import List, Optional, Dict, Any

logger = logging.getLogger(__name__)

# Caminhos padrão conhecidos para os principais fatiadores 3D
WINDOWS_SLICER_CANDIDATES = {
    "bambu": [
        os.environ.get("BAMBU_STUDIO_PATH"),
        r"C:\Program Files\Bambu Studio\bambu-studio.exe",
        r"C:\Program Files\Bambu Lab\Bambu Studio\bambu-studio.exe",
        r"C:\Program Files (x86)\Bambu Studio\bambu-studio.exe",
        r"C:\Program Files (x86)\Bambu Lab\Bambu Studio\bambu-studio.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Bambu Studio\bambu-studio.exe"),
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\BambuLab\Bambu Studio\bambu-studio.exe"),
    ],
    "orca": [
        os.environ.get("ORCA_SLICER_PATH"),
        r"C:\Program Files\OrcaSlicer\orca-slicer.exe",
        r"C:\Program Files\OrcaSlicer\OrcaSlicer.exe",
        r"C:\Program Files (x86)\OrcaSlicer\orca-slicer.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\OrcaSlicer\orca-slicer.exe"),
    ],
    "cura": [
        os.environ.get("CURA_PATH"),
        r"C:\Program Files\UltiMaker Cura 5.8.0\UltiMaker-Cura.exe",
        r"C:\Program Files\UltiMaker Cura 5.7.0\UltiMaker-Cura.exe",
        r"C:\Program Files\UltiMaker Cura 5.6.0\UltiMaker-Cura.exe",
        r"C:\Program Files\UltiMaker Cura 5.5.0\UltiMaker-Cura.exe",
        r"C:\Program Files\UltiMaker Cura 5.4.0\UltiMaker-Cura.exe",
        r"C:\Program Files\UltiMaker Cura 5.3.0\UltiMaker-Cura.exe",
        r"C:\Program Files\UltiMaker Cura\UltiMaker-Cura.exe",
    ],
    "prusa": [
        os.environ.get("PRUSA_SLICER_PATH"),
        r"C:\Program Files\Prusa3D\PrusaSlicer\prusa-slicer.exe",
        r"C:\Program Files\Prusa3D\PrusaSlicer\prusa-slicer-console.exe",
    ]
}

def find_slicer_executable(slicer_name: str = "bambu") -> Optional[str]:
    """Procura pelo executável do fatiador no sistema."""
    slicer_key = slicer_name.lower().strip()
    
    # 1. Procura no PATH do sistema
    exe_name = f"{slicer_key}-studio.exe" if slicer_key == "bambu" else f"{slicer_key}.exe"
    which_path = shutil.which(exe_name) or shutil.which(slicer_key)
    if which_path and Path(which_path).exists():
        return which_path

    # 2. Procura nas listas de caminhos padrão do Windows
    candidates = WINDOWS_SLICER_CANDIDATES.get(slicer_key, [])
    for c in candidates:
        if c and Path(c).is_file():
            return str(c)

    # 3. Varredura recursiva leve em Program Files se for Bambu Studio
    if slicer_key == "bambu" and sys.platform.startswith("win"):
        prog_files = os.environ.get("ProgramFiles", r"C:\Program Files")
        bambu_dir = Path(prog_files) / "Bambu Studio"
        if bambu_dir.exists():
            for p in bambu_dir.glob("*.exe"):
                if "bambu" in p.name.lower():
                    return str(p)

    return None


def open_files_in_slicer(file_paths: List[str], slicer_name: str = "bambu") -> Dict[str, Any]:
    """
    Abre um ou mais arquivos 3D no fatiador especificado.
    Prioriza o executável do fatiador (ex: Bambu Studio) e faz fallback
    para o comando padrão do sistema operacional (os.startfile no Windows).
    """
    valid_paths = [str(Path(p).resolve()) for p in file_paths if Path(p).exists()]
    if not valid_paths:
        return {
            "success": False,
            "message": "Nenhum dos arquivos físicos foi encontrado no disco."
        }

    slicer_key = slicer_name.lower().strip()
    exe_path = find_slicer_executable(slicer_key)
    slicer_display = "Bambu Studio" if slicer_key == "bambu" else slicer_key.capitalize()

    # Cenário 1: Executável encontrado diretamente
    if exe_path:
        try:
            cmd = [exe_path] + valid_paths
            subprocess.Popen(cmd, shell=False)
            return {
                "success": True,
                "slicer": slicer_display,
                "exe_path": exe_path,
                "files_count": len(valid_paths),
                "message": f"Abrindo {len(valid_paths)} arquivo(s) no {slicer_display}."
            }
        except Exception as e:
            logger.error(f"Erro ao executar {exe_path}: {e}")

    # Cenário 2: Fallback no Windows usando os.startfile (abre no programa associado a .3mf / .stl)
    if hasattr(os, "startfile"):
        try:
            for p in valid_paths:
                os.startfile(p)
            return {
                "success": True,
                "slicer": "Padrão do Sistema (Associação do Windows)",
                "files_count": len(valid_paths),
                "message": f"Arquivo(s) aberto(s) no fatiador padrão associado do Windows."
            }
        except Exception as e:
            logger.error(f"Erro em os.startfile: {e}")
            return {
                "success": False,
                "message": f"Falha ao abrir arquivo pelo Windows: {e}"
            }

    # Cenário 3: Linux / macOS desktop (xdg-open / open)
    desktop_cmd = "xdg-open" if sys.platform.startswith("linux") else "open"
    if shutil.which(desktop_cmd):
        try:
            for p in valid_paths:
                subprocess.Popen([desktop_cmd, p])
            return {
                "success": True,
                "slicer": desktop_cmd,
                "files_count": len(valid_paths),
                "message": f"Comando {desktop_cmd} enviado para abrir o arquivo."
            }
        except Exception as e:
            return {
                "success": False,
                "message": f"Erro ao executar {desktop_cmd}: {e}"
            }

    return {
        "success": False,
        "message": f"Executável do {slicer_display} não encontrado e sem suporte a inicializador nativo de janela."
    }


def open_folder_in_explorer(filepath: str) -> Dict[str, Any]:
    """Abre a pasta contendo o arquivo no gerenciador de arquivos (Windows Explorer ou similar)."""
    p = Path(filepath).resolve()
    if not p.exists():
        return {"success": False, "message": "Arquivo físico não encontrado."}

    if sys.platform.startswith("win"):
        try:
            # Seleciona o arquivo diretamente no Windows Explorer
            subprocess.Popen(f'explorer /select,"{str(p)}"')
            return {"success": True, "message": "Pasta aberta no Windows Explorer."}
        except Exception as e:
            logger.error(f"Erro ao abrir explorer: {e}")

    folder = p.parent
    if hasattr(os, "startfile"):
        try:
            os.startfile(str(folder))
            return {"success": True, "message": "Pasta aberta no Explorer."}
        except Exception as e:
            pass

    desktop_cmd = "xdg-open" if sys.platform.startswith("linux") else "open"
    if shutil.which(desktop_cmd):
        try:
            subprocess.Popen([desktop_cmd, str(folder)])
            return {"success": True, "message": f"Pasta aberta via {desktop_cmd}."}
        except Exception as e:
            pass

    return {"success": False, "message": "Não foi possível abrir o gerenciador de arquivos."}
