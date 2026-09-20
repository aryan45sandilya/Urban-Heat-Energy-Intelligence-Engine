"""Runtime configuration, sourced from the environment."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="UHEI_", env_file=".env", extra="ignore", protected_namespaces=()
    )

    app_name: str = "Urban Heat & Energy Intelligence Engine"
    version: str = "1.0.0"
    environment: str = "development"
    log_level: str = "INFO"

    # Artifact locations — overridable so a container can mount them elsewhere.
    models_dir: Path = REPO_ROOT / "ml" / "models"
    reports_dir: Path = REPO_ROOT / "ml" / "reports"

    # Comma-separated list of allowed browser origins.
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # Guard rails on request size.
    max_scenarios: int = 8
    max_batch_predictions: int = 64

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
