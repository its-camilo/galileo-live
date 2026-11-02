import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path


def _csv(name: str, default: str) -> tuple[str, ...]:
    return tuple(x.strip() for x in os.environ.get(name, default).split(",") if x.strip())


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    jwt_secret: str
    jwt_audience: str
    jwt_issuer: str
    meta_api_key: str | None
    meta_base_url: str
    meta_chat_model: str
    blob_token: str | None
    allowed_origins: tuple[str, ...] = field(default_factory=tuple)
    allowed_hosts: tuple[str, ...] = field(default_factory=tuple)

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
        jwt_issuer=os.environ.get("APP_JWT_ISSUER", "galileo-web"),
        meta_api_key=os.environ.get("MODEL_API_KEY") or None,
        meta_base_url=os.environ.get("META_API_BASE_URL", "https://api.meta.ai/v1"),
        meta_chat_model=os.environ.get("META_CHAT_MODEL", "muse-spark-1.3"),
        blob_token=os.environ.get("BLOB_READ_WRITE_TOKEN") or None,
        allowed_origins=_csv("ALLOWED_ORIGINS", "https://galileo-live.vercel.app,http://localhost:3000"),
        allowed_hosts=_csv("ALLOWED_HOSTS", "vps-oracle-01.tailfb0395.ts.net,127.0.0.1,localhost"),
    )
