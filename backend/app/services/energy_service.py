"""Electricity-demand prediction, explanation and scenario simulation."""
from __future__ import annotations

import logging
from datetime import datetime

import pandas as pd

from app.core.errors import ResourceNotFound
from app.schemas.common import ModelStamp
from app.services.registry import registry
from uhei.catalog import ENERGY_CATALOG
from uhei.config import NYISO_ZONES
from uhei.features import LOCAL_TZ, engineer_energy_features
from uhei.utils import dewpoint_from_rh, heat_index_c, relative_humidity_pct

log = logging.getLogger("uhei.energy")

DEFAULT_TIMESTAMP = pd.Timestamp("2024-07-16 21:00", tz="UTC")     # 17:00 EDT — system peak hour

DISCLAIMER = (
    "This is a weather- and calendar-driven estimate of zonal electricity demand fitted "
    "to three years of NYISO metered load. It carries no information about grid events, "
    "outages, generation mix or price, and it is not a dispatch forecast."
)

SIMULATION_METHOD = (
    "Model-based scenario simulation: the fitted demand model is evaluated on baseline "
    "and modified conditions. Differences describe the model's sensitivity to those "
    "inputs, not a causal forecast of grid behaviour."
)


def resolve_timestamp(value: datetime | None) -> pd.Timestamp:
    if value is None:
        return DEFAULT_TIMESTAMP
    ts = pd.Timestamp(value)
    if ts.tzinfo is None:
        ts = ts.tz_localize("UTC")
    return ts.tz_convert("UTC").floor("h")


def resolve_conditions(conditions) -> dict[str, float]:
    dewpoint = conditions.dewpoint_c
    if dewpoint is None:
        dewpoint = float(dewpoint_from_rh(conditions.temp_c, conditions.relative_humidity_pct))
    mean_24h = conditions.temp_24h_mean_c
    max_24h = conditions.temp_24h_max_c
    return {
        "temp_c": float(conditions.temp_c),
        "dewpoint_c": float(min(dewpoint, conditions.temp_c)),
        "wind_speed_ms": float(conditions.wind_speed_ms),
        "sky_cover_oktas": float(conditions.sky_cover_oktas),
        "temp_24h_mean_c": float(mean_24h if mean_24h is not None else conditions.temp_c),
        "temp_24h_max_c": float(max_24h if max_24h is not None else conditions.temp_c),
    }


def zone_record(zone: str) -> dict:
    for entry in registry.zones:
        if entry["zone"] == zone:
            return entry
    if zone in NYISO_ZONES:
        return {"zone": zone, "name": NYISO_ZONES[zone]["name"],
                "mean_mw": None, "max_mw": None}
    raise ResourceNotFound(f"Unknown NYISO zone '{zone}'.",
                           detail={"zone": zone,
                                   "known": [z["zone"] for z in registry.zones]})


def _model_stamp() -> ModelStamp:
    metadata = registry.reports.get("model_metadata", {})
    task_meta = (metadata.get("tasks") or {}).get("energy", {})
    metrics = (task_meta.get("metrics") or {}).get("test", {})
    return ModelStamp(
        task="energy",
        name=task_meta.get("selected_model", "Random Forest (tuned)"),
        version=metadata.get("version", "unknown"),
        trained_at=metadata.get("trained_at"),
        test_r2=metrics.get("r2"),
        test_rmse=metrics.get("rmse"),
        target="load_mw",
        unit="MW",
    )


def predict(zone: str, timestamp: datetime | None, conditions, explain: bool = True) -> dict:
    bundle = registry.model("energy")
    record = zone_record(zone)
    ts = resolve_timestamp(timestamp)
    resolved = resolve_conditions(conditions)

    meta = NYISO_ZONES.get(zone, {"lat": 42.9, "lon": -75.5})
    frame = pd.DataFrame([{
        "zone": zone, "ts_utc": ts, "lat": meta["lat"], "lon": meta["lon"], **resolved,
    }])
    engineered = engineer_energy_features(frame, zone_codes=bundle.get("zone_codes"))
    X = engineered[bundle["features"]].astype("float32")

    load = float(bundle["pipeline"].predict(X)[0])
    rh = float(relative_humidity_pct(resolved["temp_c"], resolved["dewpoint_c"]))
    hi = float(heat_index_c(resolved["temp_c"], rh))

    payload = {
        "prediction": {
            "load_mw": round(load, 1),
            "zone": zone,
            "zone_name": record["name"],
            "heat_index_c": round(hi, 2),
            "relative_humidity_pct": round(rh, 1),
            "cooling_degrees": round(float(engineered.iloc[0]["cooling_degrees"]), 2),
            "heating_degrees": round(float(engineered.iloc[0]["heating_degrees"]), 2),
        },
        "context": {
            "zone": zone,
            "name": record["name"],
            "observed_mean_mw": record.get("mean_mw"),
            "observed_max_mw": record.get("max_mw"),
            "share_of_observed_peak": (round(load / record["max_mw"], 4)
                                       if record.get("max_mw") else None),
        },
        "conditions": resolved,
        "timestamp_utc": ts.isoformat(),
        "timestamp_local": ts.tz_convert(LOCAL_TZ).isoformat(),
        "model": _model_stamp(),
        "disclaimer": DISCLAIMER,
    }
    if explain:
        payload["explanation"] = registry.explainer("energy").explain_row(X)
    return payload


def simulate(zone: str, timestamp: datetime | None, baseline_conditions,
             scenarios: list, explain: bool = True) -> dict:
    base = predict(zone, timestamp, baseline_conditions, explain=explain)
    base_state = base["conditions"]
    base_load = base["prediction"]["load_mw"]

    results = []
    for scenario in scenarios:
        outcome = predict(zone, timestamp, scenario.conditions, explain=explain)
        delta = outcome["prediction"]["load_mw"] - base_load
        changes = []
        for field, after in outcome["conditions"].items():
            before = base_state.get(field)
            if before is None or abs(after - before) < 1e-9:
                continue
            spec = ENERGY_CATALOG.get(field)
            changes.append({
                "field": field,
                "label": spec.label if spec else field.replace("_", " ").title(),
                "unit": spec.unit if spec else "",
                "baseline_value": round(before, 3),
                "scenario_value": round(after, 3),
                "delta": round(after - before, 3),
            })
        results.append({
            "name": scenario.name,
            "description": scenario.description,
            "prediction": outcome["prediction"],
            "delta_mw": round(delta, 1),
            "percent_change": round(100.0 * delta / base_load, 2) if base_load else None,
            "changes": changes,
            "explanation": outcome.get("explanation"),
        })

    return {
        "zone": zone,
        "zone_name": base["prediction"]["zone_name"],
        "timestamp_utc": base["timestamp_utc"],
        "timestamp_local": base["timestamp_local"],
        "baseline": base,
        "scenarios": results,
        "method": SIMULATION_METHOD,
        "disclaimer": DISCLAIMER,
    }
