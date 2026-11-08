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
    # Sign-in (#88) is powertools-auth. To share the login with Kev's other apps, point this at the database that
    # holds their users, and set the cookie domain and prefix to theirs. Unset: BetterCad keeps its own users.
    auth_database_path: Path | None = None
    cookie_domain: str = ""
    cookie_prefix: str = "bc"
    # Where people reach BetterCad, e.g. https://bettercad.kevsrobots.com: password reset emails link here.
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

    @field_validator("auth_database_path", "database_path", "backup_dir", mode="before")
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
    def auth_db_path(self) -> Path:
        return self.auth_database_path or self.db_path

    @property
    def shared_login(self) -> bool:
        return self.auth_database_path is not None and self.auth_database_path.resolve() != self.db_path.resolve()

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
