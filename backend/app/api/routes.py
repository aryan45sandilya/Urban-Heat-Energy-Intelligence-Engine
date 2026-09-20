"""HTTP surface of the UHEI engine."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Query, Response

from app.core.config import get_settings
from app.core.errors import InvalidInput, ResourceNotFound
from app.schemas.common import ErrorResponse
from app.schemas.energy import (
    EnergyPredictRequest, EnergyPredictResponse, EnergySimulateRequest, EnergySimulateResponse,
)
from app.schemas.heat import (
    HeatPredictRequest, HeatPredictResponse, HeatSimulateRequest, HeatSimulateResponse,
    HotspotRequest,
)
from app.services import energy_service, heat_service
from app.services.registry import registry

log = logging.getLogger("uhei.api")
router = APIRouter()
settings = get_settings()

ERRORS = {
    404: {"model": ErrorResponse, "description": "Resource not found"},
    422: {"model": ErrorResponse, "description": "Input rejected"},
    503: {"model": ErrorResponse, "description": "Model artifacts unavailable"},
}

TASKS = ("heat", "energy")


def _check_task(task: str) -> str:
    if task not in TASKS:
        raise InvalidInput(f"Unknown task '{task}'.", detail={"allowed": list(TASKS)})
    return task


# ── Service health & metadata ────────────────────────────────────────────────
@router.get("/health", tags=["system"], summary="Liveness and artifact status")
def health(response: Response) -> dict:
    status = registry.status()
    if not status["ready"]:
        response.status_code = 503
    return {"status": "ok" if status["ready"] else "degraded", **status}


@router.get("/api/meta", tags=["system"], summary="Project, dataset and model metadata")
def meta() -> dict:
    metadata = registry.report("model_metadata")
    return {
        "app": settings.app_name,
        "version": settings.version,
        "environment": settings.environment,
        **metadata,
    }


@router.get("/api/models", tags=["models"], summary="Every model trained, with its scores")
def models(task: str = Query("heat", description="heat | energy")) -> dict:
    _check_task(task)
    report = registry.report(f"model_report_{task}")
    return {
        "task": task,
        "target": report["target"],
        "split": report["split"],
        "candidates": report["comparison"],
        "selected": report["selected"],
        "tuning": report["tuning"],
        "notes": report["notes"],
        # Present once the finalize stage has run; the Model Lab uses these to
        # show where the model is actually informative rather than only its
        # headline score.
        "segment_metrics": report.get("segment_metrics"),
        "regime_metrics": report.get("regime_metrics"),
    }


@router.get("/api/model-metrics", tags=["models"], summary="Scores for the selected model")
def model_metrics(task: str = Query("heat")) -> dict:
    _check_task(task)
    report = registry.report(f"model_report_{task}")
    return {
        "task": task,
        "target": report["target"],
        "selected": report["selected"],
        "split": report["split"],
        "feature_importance": report["feature_importance"],
        "cross_validation": next(
            (c["cv"] for c in report["comparison"] if c["key"] == "random_forest"), None),
    }


@router.get("/api/features", tags=["models"], summary="Feature catalogue with observed ranges")
def features(task: str = Query("heat")) -> dict:
    _check_task(task)
    catalogue = registry.report("feature_metadata")
    if task not in catalogue:
        raise ResourceNotFound(f"No feature metadata for task '{task}'.")
    entries = catalogue[task]
    groups: dict[str, list] = {}
    for entry in entries:
        groups.setdefault(entry["group_label"], []).append(entry)
    return {
        "task": task,
        "count": len(entries),
        "features": entries,
        "groups": [{"label": k, "features": v} for k, v in groups.items()],
        "adjustable": [e for e in entries if e["adjustable"]],
    }


@router.get("/api/validation", tags=["system"], summary="Data-validation and leakage audit")
def validation() -> dict:
    return registry.report("validation")


@router.get("/api/eda", tags=["analysis"], summary="Exploratory analysis behind the charts")
def eda(task: str = Query("heat")) -> dict:
    _check_task(task)
    return registry.report(f"eda_{task}")


@router.get("/api/shap", tags=["analysis"], summary="Global SHAP structure")
def shap_global(task: str = Query("heat")) -> dict:
    _check_task(task)
    return registry.report(f"shap_{task}")


# ── Reference data ───────────────────────────────────────────────────────────
@router.get("/api/sites", tags=["reference"], summary="The observation network")
def sites(
    urban_class: str | None = Query(None),
    country: str | None = Query(None, description="Filter by country code, e.g. 'US' or 'IN'"),
    limit: int = Query(1000, ge=1, le=2000),
) -> dict:
    table = registry.site_table()
    if urban_class:
        table = table[table["urban_class"] == urban_class]
    if country and "country" in table.columns:
        table = table[table["country"].str.upper() == country.upper()]

    # Build observed-stats lookup from hotspots.json (US) plus india_cities.json (IN).
    hotspots = registry.report("hotspots")
    observed: dict = {s["station_id"]: s.get("observed") for s in hotspots["sites"]}
    india_path = settings.reports_dir / "india_cities.json"
    if india_path.exists():
        import json as _json
        for s in _json.loads(india_path.read_text(encoding="utf-8")):
            observed[s["station_id"]] = s.get("observed")

    records = []
    for row in table.head(limit).itertuples(index=False):
        records.append({
            "station_id": row.station_id,
            "name": row.station_name,
            "state": getattr(row, "state", None),
            "country": getattr(row, "country", "US"),
            "lat": float(row.lat),
            "lon": float(row.lon),
            "elevation_m": float(row.elevation_m),
            "urban_class": row.urban_class,
            "morphology": {
                "building_plan_fraction_1km": float(row.building_plan_fraction_1km),
                "building_count_km2_1km": float(row.building_count_km2_1km),
                "building_count_km2_3km": float(row.building_count_km2_3km),
                "road_length_km_km2_1km": float(row.road_length_km_km2_1km),
                "green_fraction_1km": float(row.green_fraction_1km),
                "water_fraction_1km": float(row.water_fraction_1km),
                "impervious_fraction_1km": float(row.impervious_fraction_1km),
                "green_count_km2_3km": float(getattr(row, "green_count_km2_3km", 0) or 0),
                "water_count_km2_3km": float(getattr(row, "water_count_km2_3km", 0) or 0),
            },
            "observed": observed.get(row.station_id),
        })
    records.sort(key=lambda r: r["morphology"]["building_count_km2_3km"], reverse=True)
    return {"count": len(records), "sites": records}


@router.get("/api/zones", tags=["reference"], summary="NYISO load zones")
def zones() -> dict:
    return {"count": len(registry.zones), "zones": registry.zones}


# ── Prediction ───────────────────────────────────────────────────────────────
@router.post("/api/predict/heat", tags=["predict"], responses=ERRORS,
             response_model=HeatPredictResponse,
             summary="Predict the urban heat island anomaly at a site")
def predict_heat(request: HeatPredictRequest) -> dict:
    return heat_service.predict(
        request.station_id, request.timestamp, request.conditions,
        request.overrides.as_dict(), explain=request.explain,
    )


@router.post("/api/predict/energy", tags=["predict"], responses=ERRORS,
             response_model=EnergyPredictResponse,
             summary="Predict zonal electricity demand")
def predict_energy(request: EnergyPredictRequest) -> dict:
    return energy_service.predict(
        request.zone, request.timestamp, request.conditions, explain=request.explain)


# ── Simulation ───────────────────────────────────────────────────────────────
@router.post("/api/simulate", tags=["simulate"], responses=ERRORS,
             response_model=HeatSimulateResponse,
             summary="Compare baseline and what-if scenarios (urban heat)")
def simulate_heat(request: HeatSimulateRequest) -> dict:
    if len(request.scenarios) > settings.max_scenarios:
        raise InvalidInput(f"At most {settings.max_scenarios} scenarios per request.")
    return heat_service.simulate(
        request.station_id, request.timestamp, request.baseline,
        request.scenarios, explain=request.explain,
        explain_scenarios=request.explain_scenarios)


@router.post("/api/simulate/energy", tags=["simulate"], responses=ERRORS,
             response_model=EnergySimulateResponse,
             summary="Compare baseline and what-if scenarios (electricity demand)")
def simulate_energy(request: EnergySimulateRequest) -> dict:
    if len(request.scenarios) > settings.max_scenarios:
        raise InvalidInput(f"At most {settings.max_scenarios} scenarios per request.")
    return energy_service.simulate(
        request.zone, request.timestamp, request.baseline,
        request.scenarios, explain=request.explain)


# ── Geospatial ───────────────────────────────────────────────────────────────
@router.get("/api/hotspots", tags=["map"], responses=ERRORS,
            summary="Pre-computed heat-island layer for a reference summer night")
def hotspots_baseline() -> dict:
    return registry.report("hotspots")


@router.post("/api/hotspots", tags=["map"], responses=ERRORS,
             summary="Recompute the map layer under user-specified conditions")
def hotspots_dynamic(request: HotspotRequest) -> dict:
    return heat_service.hotspots(
        request.timestamp, request.conditions, request.overrides.as_dict(),
        limit=request.limit)
