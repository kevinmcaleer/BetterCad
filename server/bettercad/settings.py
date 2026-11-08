"""Settings from environment variables (or a .env file)."""

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
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
    # Sign-in (#88) is the kevsrobots.com account, kept by Chatter. Its cookie is set on COOKIE_DOMAIN
    # (.kevsrobots.com), and BetterCad has to sit under that domain to see it.
    chatter_url: str = "https://chatter.kevsrobots.com"
    # Where this server asks Chatter who a cookie belongs to. Blank uses chatter_url; on the same machine, point it
    # straight at Chatter (http://chatter:8000) so the check doesn't go out through Cloudflare and back.
    chatter_api_url: str = ""
    cookie_domain: str = ""
    # Where people reach BetterCad, e.g. https://bettercad.kevsrobots.com: kevsrobots.com sends them back here.
    public_url: str = ""
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
    # Analytics (#111): the accounts (comma-separated emails) that can read /api/stats.
    stats_emails: str = ""

    @field_validator("database_path", "backup_dir", mode="before")
    @classmethod
    def _blank_is_unset(cls, v: object) -> object:
        # docker compose passes an unset variable as an empty string.
        return None if v == "" else v

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
