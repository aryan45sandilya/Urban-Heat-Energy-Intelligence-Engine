"""FastAPI application entry point."""
from __future__ import annotations

import sys
from pathlib import Path

# Ensure ml/src is importable when deployed as a monorepo (Railway, Docker, etc.)
# /app/backend/app/main.py → parents[2] = /app → /app/ml/src
_ml_src = Path(__file__).resolve().parents[2] / "ml" / "src"
if str(_ml_src) not in sys.path:
    sys.path.insert(0, str(_ml_src))

import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.services.registry import registry

settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s │ %(levelname)-7s │ %(name)-16s │ %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("uhei.api")

DESCRIPTION = """
Predictive intelligence for urban heat and electricity demand.

Every number returned by this API comes from a model fitted to real observations:
NOAA ISD-Lite hourly weather, OpenStreetMap urban morphology and NYISO metered
load. Nothing is simulated, synthesised or hard-coded.

**Urban heat** — predicts the hourly urban–rural air-temperature anomaly (ΔT)
at a measured location, and explains the prediction with SHAP.

**Electricity demand** — predicts zonal load from weather and calendar conditions.

**Simulation** — evaluates the same fitted model under modified inputs. The
difference between runs is the model's sensitivity, not a causal claim.
"""


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("loading artifacts from %s", settings.models_dir)
    registry.load()
    if not registry.ready:
        log.warning("starting WITHOUT models — prediction endpoints will return 503. "
                    "Run `python -m uhei.pipeline` to build them.")
    yield
    log.info("shutdown")


app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    description=DESCRIPTION,
    lifespan=lifespan,
    docs_url="/docs",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
    max_age=600,
)

register_error_handlers(app)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    request.state.request_id = request_id
    started = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - started) * 1000
    response.headers["x-request-id"] = request_id
    response.headers["x-response-time-ms"] = f"{elapsed_ms:.1f}"
    if request.url.path not in ("/health",):
        log.info("%s %s → %s (%.1f ms)", request.method, request.url.path,
                 response.status_code, elapsed_ms)
    return response


app.include_router(router)


@app.get("/", include_in_schema=False)
def root() -> dict:
    return {
        "name": settings.app_name,
        "version": settings.version,
        "docs": "/docs",
        "health": "/health",
    }
