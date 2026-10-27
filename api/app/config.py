import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    jwt_secret: str
    jwt_audience: str
    meta_api_key: str | None
    meta_base_url: str
    blob_token: str | None

    @property
    def db_path(self) -> Path:
        return self.data_dir / "galileo.db"

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def reports_dir(self) -> Path:
        return self.data_dir / "reports"

    @property
    def plots_dir(self) -> Path:
        return self.data_dir / "plots"


@lru_cache
def get_settings() -> Settings:
    return Settings(
        data_dir=Path(os.environ.get("GALILEO_DATA_DIR", "/data/galileo-live")),
        jwt_secret=os.environ.get("APP_JWT_SECRET", ""),
        jwt_audience=os.environ.get("APP_JWT_AUDIENCE", "galileo-vps"),
        meta_api_key=os.environ.get("MODEL_API_KEY") or None,
        meta_base_url=os.environ.get("META_API_BASE_URL", "https://api.meta.ai/v1"),
        blob_token=os.environ.get("BLOB_READ_WRITE_TOKEN") or None,
    )
