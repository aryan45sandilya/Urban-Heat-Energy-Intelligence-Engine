"""Urban-heat prediction, explanation and scenario simulation."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from app.core.errors import InvalidInput
from app.schemas.common import ModelStamp
from app.services.registry import registry
from uhei.catalog import HEAT_CATALOG
from uhei.features import LOCAL_TZ, engineer_heat_features
from uhei.hotspots import CONDITION_FIELDS, SITE_COLUMNS, predict_sites
from uhei.utils import dewpoint_from_rh, heat_index_c, heat_risk_band, relative_humidity_pct

log = logging.getLogger("uhei.heat")

# When no time is supplied we use the hour at which the nocturnal heat island is
# typically strongest — 23:00 US Eastern in mid-July.
DEFAULT_TIMESTAMP = pd.Timestamp("2024-07-16 03:00", tz="UTC")

DISCLAIMER = (
    "This is a statistical prediction of the urban–rural temperature anomaly learned "
    "from three years of hourly observations. It describes an association between "
    "conditions and measured temperature differences; it is not a causal claim and not "
    "an official forecast."
)

SIMULATION_METHOD = (
    "Model-based scenario simulation: the same fitted model is evaluated twice, once on "
    "the baseline inputs and once on the modified inputs. The difference is the model's "
    "response to the change in inputs, not a prediction of what would happen if the city "
    "were rebuilt."
)


def resolve_timestamp(value: datetime | None) -> pd.Timestamp:
    if value is None:
        return DEFAULT_TIMESTAMP
    ts = pd.Timestamp(value)
    if ts.tzinfo is None:
        ts = ts.tz_localize("UTC")
    return ts.tz_convert("UTC").floor("h")


def resolve_conditions(conditions) -> dict[str, float]:
    """Normalise a conditions payload into the model's raw input names."""
    dewpoint = conditions.dewpoint_ref_c
    if dewpoint is None:
        dewpoint = float(dewpoint_from_rh(conditions.t_ref_c, conditions.relative_humidity_pct))
    return {
        "t_ref_c": float(conditions.t_ref_c),
        "dewpoint_ref_c": float(min(dewpoint, conditions.t_ref_c)),
        "wind_speed_ms": float(conditions.wind_speed_ms),
        "sky_cover_oktas": float(conditions.sky_cover_oktas),
        "slp_hpa": float(conditions.slp_hpa),
        "precip_1h_mm": float(conditions.precip_1h_mm),
    }


def build_site_frame(station_id: str, overrides: dict[str, float]) -> tuple[pd.DataFrame, pd.Series]:
    site = registry.site(station_id)
    frame = site.to_frame().T.reset_index(drop=True)
    for column in SITE_COLUMNS:
        if column not in frame.columns:
            raise InvalidInput(f"site record is missing '{column}'")
    for key, value in overrides.items():
        if key not in frame.columns:
            raise InvalidInput(f"'{key}' is not an adjustable site attribute",
                               detail={"field": key})
        frame[key] = float(value)

    numeric = [c for c in SITE_COLUMNS if c not in ("station_id", "station_name",
                                                    "state", "urban_class")]
    frame[numeric] = frame[numeric].astype("float64")
    return frame, site


def _model_stamp() -> ModelStamp:
    metadata = registry.reports.get("model_metadata", {})
    task_meta = (metadata.get("tasks") or {}).get("heat", {})
    metrics = (task_meta.get("metrics") or {}).get("test", {})
    return ModelStamp(
        task="heat",
        name=task_meta.get("selected_model", "Random Forest (tuned)"),
        version=metadata.get("version", "unknown"),
        trained_at=metadata.get("trained_at"),
        test_r2=metrics.get("r2"),
        test_rmse=metrics.get("rmse"),
        target="uhi_intensity_c",
        unit="°C",
    )


def _risk(heat_index: float) -> dict:
    band, description = heat_risk_band(heat_index)
    return {
        "band": band,
        "description": description,
        "heat_index_c": round(float(heat_index), 2),
        "basis": ("US National Weather Service heat-index categories, applied to the "
                  "model's predicted temperature. The category is an interpretation of "
                  "the continuous prediction, not a separate model output."),
    }


def _site_summary(site: pd.Series, frame: pd.DataFrame, overrides: dict[str, float]) -> dict:
    morphology_keys = [
        "building_plan_fraction_1km", "building_count_km2_1km", "building_count_km2_3km",
        "road_length_km_km2_1km", "green_fraction_1km", "water_fraction_1km",
        "impervious_fraction_1km", "green_count_km2_3km", "water_count_km2_3km",
    ]
    return {
        "station_id": str(site["station_id"]),
        "name": str(site["station_name"]),
        "state": None if pd.isna(site.get("state")) else str(site.get("state")),
        "lat": float(site["lat"]),
        "lon": float(site["lon"]),
        "elevation_m": float(site["elevation_m"]),
        "urban_class": str(site["urban_class"]),
        "morphology": {k: float(frame.iloc[0][k]) for k in morphology_keys
                       if k in frame.columns},
        "overridden": {k: float(v) for k, v in overrides.items()},
    }


def predict(station_id: str, timestamp: datetime | None, conditions,
            overrides: dict[str, float], explain: bool = True) -> dict:
    bundle = registry.model("heat")
    ts = resolve_timestamp(timestamp)
    resolved = resolve_conditions(conditions)

    frame, site = build_site_frame(station_id, overrides)
    frame["ts_utc"] = ts
    for field in CONDITION_FIELDS:
        frame[field] = resolved[field]

    engineered = engineer_heat_features(frame)
    X = engineered[bundle["features"]].astype("float32")

    uhi = float(bundle["pipeline"].predict(X)[0])
    site_temp = uhi + resolved["t_ref_c"]
    rh = float(relative_humidity_pct(site_temp, resolved["dewpoint_ref_c"]))
    hi = float(heat_index_c(site_temp, rh))

    payload = {
        "prediction": {
            "uhi_intensity_c": round(uhi, 3),
            "site_temperature_c": round(site_temp, 2),
            "background_temperature_c": round(resolved["t_ref_c"], 2),
            "relative_humidity_pct": round(rh, 1),
            "heat_index_c": round(hi, 2),
        },
        "risk": _risk(hi),
        "site": _site_summary(site, frame, overrides),
        "conditions": resolved,
        "timestamp_utc": ts.isoformat(),
        "timestamp_local": ts.tz_convert(LOCAL_TZ).isoformat(),
        "model": _model_stamp(),
        "disclaimer": DISCLAIMER,
    }
    if explain:
        payload["explanation"] = registry.explainer("heat").explain_row(X)
    return payload


# ── Scenario simulation ──────────────────────────────────────────────────────
_TRACKED_FIELDS = list(CONDITION_FIELDS) + [
    "building_plan_fraction_1km", "building_count_km2_1km", "building_count_km2_3km",
    "road_length_km_km2_1km", "green_fraction_1km", "water_fraction_1km",
    "impervious_fraction_1km",
]


def _changes(baseline: dict, scenario: dict) -> list[dict]:
    out = []
    for field in _TRACKED_FIELDS:
        if field not in baseline or field not in scenario:
            continue
        before, after = float(baseline[field]), float(scenario[field])
        if abs(after - before) < 1e-9:
            continue
        spec = HEAT_CATALOG.get(field)
        out.append({
            "field": field,
            "label": spec.label if spec else field.replace("_", " ").title(),
            "unit": spec.unit if spec else "",
            "baseline_value": round(before, 4),
            "scenario_value": round(after, 4),
            "delta": round(after - before, 4),
        })
    return out


def simulate(station_id: str, timestamp: datetime | None, baseline_conditions,
             scenarios: list, explain: bool = True,
             explain_scenarios: bool = False) -> dict:
    base = predict(station_id, timestamp, baseline_conditions, {}, explain=explain)
    base_state = dict(base["conditions"])
    base_state.update(base["site"]["morphology"])

    results = []
    for scenario in scenarios:
        conditions = scenario.conditions or baseline_conditions
        overrides = scenario.overrides.as_dict()
        outcome = predict(station_id, timestamp, conditions, overrides,
                          explain=explain_scenarios)

        state = dict(outcome["conditions"])
        state.update(outcome["site"]["morphology"])

        delta_uhi = outcome["prediction"]["uhi_intensity_c"] - base["prediction"]["uhi_intensity_c"]
        base_uhi = base["prediction"]["uhi_intensity_c"]
        results.append({
            "name": scenario.name,
            "description": scenario.description,
            "prediction": outcome["prediction"],
            "risk": outcome["risk"],
            "delta_uhi_c": round(delta_uhi, 3),
            "delta_temperature_c": round(
                outcome["prediction"]["site_temperature_c"]
                - base["prediction"]["site_temperature_c"], 3),
            "delta_heat_index_c": round(
                outcome["prediction"]["heat_index_c"]
                - base["prediction"]["heat_index_c"], 3),
            # A percentage of a near-zero anomaly is meaningless, so it is omitted
            # rather than reported as a misleading three-digit number.
            "percent_change_uhi": (round(100.0 * delta_uhi / base_uhi, 1)
                                   if abs(base_uhi) >= 0.25 else None),
            "changes": _changes(base_state, state),
            "explanation": outcome.get("explanation"),
        })

    return {
        "site": base["site"],
        "timestamp_utc": base["timestamp_utc"],
        "timestamp_local": base["timestamp_local"],
        "baseline": base,
        "scenarios": results,
        "method": SIMULATION_METHOD,
        "disclaimer": DISCLAIMER,
    }


# ── Map layer ────────────────────────────────────────────────────────────────
def hotspots(timestamp: datetime | None, conditions, overrides: dict[str, float],
             limit: int | None = None) -> dict:
    bundle = registry.model("heat")
    ts = resolve_timestamp(timestamp)
    resolved = resolve_conditions(conditions)

    sites = registry.site_table().copy()
    for key, value in overrides.items():
        if key in sites.columns:
            sites[key] = float(value)

    predicted = predict_sites(bundle, sites, resolved, ts)
    predicted = predicted.sort_values("predicted_uhi_c", ascending=False)
    if limit:
        predicted = predicted.head(limit)

    values = predicted["predicted_uhi_c"].to_numpy()
    return {
        "timestamp_utc": ts.isoformat(),
        "timestamp_local": ts.tz_convert(LOCAL_TZ).isoformat(),
        "conditions": resolved,
        "overrides": {k: float(v) for k, v in overrides.items()},
        "sites": [
            {
                "station_id": row.station_id,
                "name": row.station_name,
                "state": row.state,
                "lat": float(row.lat),
                "lon": float(row.lon),
                "urban_class": row.urban_class,
                "uhi_c": round(float(row.predicted_uhi_c), 3),
                "temp_c": round(float(row.predicted_temp_c), 2),
                "heat_index_c": round(float(row.predicted_heat_index_c), 2),
                "heat_risk": row.heat_risk,
                "building_count_km2_3km": float(row.building_count_km2_3km),
                "impervious_fraction_1km": float(row.impervious_fraction_1km),
                "green_fraction_1km": float(row.green_fraction_1km),
            }
            for row in predicted.itertuples(index=False)
        ],
        "scale": {
            "min": float(np.min(values)), "max": float(np.max(values)),
            "mean": float(np.mean(values)),
            "p10": float(np.quantile(values, 0.10)),
            "p90": float(np.quantile(values, 0.90)),
        },
        "model": _model_stamp(),
        "disclaimer": DISCLAIMER,
        "note": ("Every point is a physical weather station with measured urban "
                 "morphology. The atmosphere is held identical across all sites so that "
                 "differences reflect location and urban fabric alone."),
    }
