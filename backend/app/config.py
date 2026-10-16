import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR / "data")))
LIBRARY_PATH = Path(os.getenv("LIBRARY_PATH", "/library"))

# Ensure data and thumbnail directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
THUMBNAILS_DIR = DATA_DIR / "thumbnails"
THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)
PREVIEWS_DIR = DATA_DIR / "previews"
PREVIEWS_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite+aiosqlite:///{DATA_DIR}/stlmanager.db")

SUPPORTED_EXTENSIONS = {".stl", ".obj", ".3mf"}

