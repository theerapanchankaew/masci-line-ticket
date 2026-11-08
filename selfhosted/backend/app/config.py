import os
from dataclasses import dataclass
from pathlib import Path


def secret(name: str, default: str = "") -> str:
    filename = os.getenv(name + "_FILE")
    return Path(filename).read_text().strip() if filename else os.getenv(name, default)


@dataclass
class Settings:
    database_url: str
    line_secret: str
    line_token: str
    line_destination: str
    line_mode: str
    public_origin: str
    uploads: Path
    environment: str

    @classmethod
    def load(cls):
        url = secret("DATABASE_URL", "sqlite:///./desk.db")
        settings = cls(
            url,
            secret("LINE_CHANNEL_SECRET"),
            secret("LINE_CHANNEL_ACCESS_TOKEN"),
            os.getenv("LINE_DESTINATION", ""),
            os.getenv("LINE_MODE", "dry_run"),
            os.getenv("PUBLIC_ORIGIN", "http://localhost:8080").rstrip("/"),
            Path(os.getenv("UPLOAD_DIR", "./uploads")),
            os.getenv("APP_ENV", "development"),
        )
        if settings.line_mode not in {"dry_run", "live"}:
            raise ValueError("LINE_MODE must be dry_run or live")
        if settings.line_mode == "live" and not all(
            [settings.line_secret, settings.line_token, settings.line_destination]
        ):
            raise ValueError("Live LINE requires channel secret, access token and bot destination")
        if settings.environment == "production" and (
            not url.startswith("postgresql") or not settings.public_origin.startswith("https://")
        ):
            raise ValueError("Production requires PostgreSQL and HTTPS PUBLIC_ORIGIN")
        return settings
