"""Shared fixtures for the API test suite.

The suite runs in two modes and says which one it is in:

* **with artifacts** — the pipeline has been run, so prediction endpoints are
  exercised against the real fitted model.
* **without artifacts** — only the degraded-mode behaviour is checked: the API
  must return a clear 503 rather than inventing a number.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings


@pytest.fixture(scope="session")
def settings():
    return get_settings()


@pytest.fixture(scope="session")
def client(settings):
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def has_models(settings) -> bool:
    return (settings.models_dir / "heat_model.joblib").exists()


@pytest.fixture(scope="session")
def has_energy_model(settings) -> bool:
    return (settings.models_dir / "energy_model.joblib").exists()


@pytest.fixture(scope="session")
def requires_models(has_models):
    if not has_models:
        pytest.skip("model artifacts not built — run `python -m uhei.pipeline`")


@pytest.fixture(scope="session")
def station_id(client, requires_models) -> str:
    response = client.get("/api/sites")
    if response.status_code != 200:
        pytest.skip("site network unavailable")
    sites = response.json()["sites"]
    if not sites:
        pytest.skip("no sites in the network")
    return sites[0]["station_id"]


@pytest.fixture
def conditions() -> dict:
    """A calm, humid summer night — the regime the product is about."""
    return {
        "t_ref_c": 24.0,
        "relative_humidity_pct": 72.0,
        "wind_speed_ms": 1.0,
        "sky_cover_oktas": 0.0,
        "slp_hpa": 1016.0,
        "precip_1h_mm": 0.0,
    }
