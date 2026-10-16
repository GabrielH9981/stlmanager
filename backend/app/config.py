import os
from pathlib import Path

# Carregar variáveis do .env caso existam
def _load_env_file():
    candidates = [
        Path.cwd() / ".env",
        Path(__file__).resolve().parent.parent.parent / ".env",
        Path(__file__).resolve().parent.parent / ".env"
    ]
    for p in candidates:
        if p.exists() and p.is_file():
            try:
                with open(p, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            k, v = k.strip(), v.strip().strip("'\"")
                            if k not in os.environ:
                                os.environ[k] = v
                break
            except Exception:
                pass

_load_env_file()

# Determinar diretório raiz do projeto
# No Docker: /app
# Nativo Windows/Linux: raiz do repositório STLManager
APP_DIR = Path(__file__).resolve().parent
ROOT_DIR = APP_DIR.parent
if (ROOT_DIR.parent / "docker-compose.yml").exists() or (ROOT_DIR.parent / "data").exists():
    ROOT_DIR = ROOT_DIR.parent

DATA_DIR = Path(os.getenv("DATA_DIR", str(ROOT_DIR / "data")))

# Caminho da biblioteca de arquivos 3D:
# No Docker: /library (setado via env LIBRARY_PATH)
# Nativo (Windows/Linux): STL_LIBRARY_PATH do .env (ex: C:/Users/.../Downloads)
raw_library_path = os.getenv("LIBRARY_PATH") or os.getenv("STL_LIBRARY_PATH") or str(DATA_DIR / "library")
LIBRARY_PATH = Path(raw_library_path)

# Garantir que os diretórios essenciais existam
DATA_DIR.mkdir(parents=True, exist_ok=True)
THUMBNAILS_DIR = DATA_DIR / "thumbnails"
THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)
PREVIEWS_DIR = DATA_DIR / "previews"
PREVIEWS_DIR.mkdir(parents=True, exist_ok=True)

# Normalização de URL do SQLite para Windows e Linux
db_file = DATA_DIR / "stlmanager.db"
db_path_str = str(db_file.resolve()).replace('\\', '/')
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_path_str}")

SUPPORTED_EXTENSIONS = {".stl", ".obj", ".3mf"}


