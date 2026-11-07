"""Settings from environment variables (or a .env file)."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "development"
    data_dir: Path = Path("data")
    database_path: Path | None = None
    max_upload_mb: int = 50
    user_quota_mb: int = 500
    backup_dir: Path | None = None
    backup_days: int = 14
    jobs: bool = True
    secret_key: str = ""
    allowed_origins: str = "http://localhost:5173"
    web_dist: Path = Path(__file__).resolve().parents[2] / "web" / "dist"
    version: str = ""
    # Problem reports (#109): email them to Kev, or file them in a private repository.
    report_email: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    github_report_token: str = ""
    github_report_repo: str = ""

    @property
    def production(self) -> bool:
        return self.env == "production"

    @property
    def db_path(self) -> Path:
        return self.database_path or self.data_dir / "bettercad.db"

    @property
    def blob_dir(self) -> Path:
        return self.data_dir / "blobs"

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    def check(self) -> None:
        """Refuse to start in production without a secret key."""
        if self.production and not self.secret_key:
            raise RuntimeError("SECRET_KEY must be set when ENV=production.")


@lru_cache
def get_settings() -> Settings:
    return Settings()
