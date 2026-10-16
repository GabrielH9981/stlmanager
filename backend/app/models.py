from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Float, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

class Base(DeclarativeBase):
    pass

class ModelItem(Base):
    __tablename__ = "models"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    filename: Mapped[str] = mapped_column(String(255), index=True)
    filepath: Mapped[str] = mapped_column(String(1024), unique=True, index=True)
    relative_path: Mapped[str] = mapped_column(String(1024), index=True)
    file_size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    file_hash: Mapped[str] = mapped_column(String(64), index=True)
    file_extension: Mapped[str] = mapped_column(String(16), index=True)
    
    # Timestamps
    file_mtime: Mapped[float] = mapped_column(Float, default=0.0)
    indexed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    # Categorization
    category: Mapped[str] = mapped_column(String(100), default="Geral", index=True)
    tags: Mapped[str] = mapped_column(String(500), default="")
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # 3D Geometry
    triangles_count: Mapped[int] = mapped_column(Integer, default=0)
    vertices_count: Mapped[int] = mapped_column(Integer, default=0)
    bbox_x: Mapped[float] = mapped_column(Float, default=0.0)
    bbox_y: Mapped[float] = mapped_column(Float, default=0.0)
    bbox_z: Mapped[float] = mapped_column(Float, default=0.0)
    volume_cm3: Mapped[float] = mapped_column(Float, default=0.0)
    is_watertight: Mapped[bool] = mapped_column(Boolean, default=False)
    
    # Duplicate tracking
    is_duplicate: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    duplicate_of_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("models.id"), nullable=True)
    def to_dict(self):
        from .config import THUMBNAILS_DIR
        from .folders import clean_folder_path, get_folder_root

        has_thumb = (
            (THUMBNAILS_DIR / f"{self.file_hash}.webp").exists() or 
            (THUMBNAILS_DIR / f"{self.file_hash}.png").exists() or
            self.file_extension == ".3mf"
        )

        clean_folder = clean_folder_path(self.relative_path)
        folder_root = get_folder_root(clean_folder)

        # Status triplo: 'project', 'solid', 'non_solid'
        if self.file_extension == ".3mf":
            mesh_status = "project"
            is_project = True
        elif self.is_watertight:
            mesh_status = "solid"
            is_project = False
        else:
            mesh_status = "non_solid"
            is_project = False

        return {
            "id": self.id,
            "filename": self.filename,
            "filepath": self.filepath,
            "relative_path": self.relative_path,
            "folder_path": clean_folder,
            "folder_root": folder_root,
            "file_size_bytes": self.file_size_bytes,
            "file_size_mb": round(self.file_size_bytes / (1024 * 1024), 2),
            "file_hash": self.file_hash,
            "file_extension": self.file_extension,
            "file_mtime": self.file_mtime,
            "indexed_at": self.indexed_at.isoformat() if self.indexed_at else None,
            "category": self.category,
            "tags": [t.strip() for t in self.tags.split(",") if t.strip()] if self.tags else [],
            "is_favorite": self.is_favorite,
            "notes": self.notes,
            "triangles_count": self.triangles_count,
            "vertices_count": self.vertices_count,
            "dimensions": {
                "x": round(self.bbox_x, 1),
                "y": round(self.bbox_y, 1),
                "z": round(self.bbox_z, 1),
            },
            "volume_cm3": round(self.volume_cm3, 2),
            "is_watertight": self.is_watertight,
            "mesh_status": mesh_status,
            "is_project": is_project,
            "is_duplicate": self.is_duplicate,
            "duplicate_of_id": self.duplicate_of_id,
            "has_thumbnail": has_thumb,
            "thumbnail_url": f"/api/models/{self.id}/thumbnail" if has_thumb else None
        }

