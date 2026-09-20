"""Stage 6 — geospatial intelligence.

The map layer is built from the same station network the model was trained on:
185 real coordinates, each carrying its own measured urban morphology. Nothing
is interpolated into places where no observation exists, and no coordinate is
invented.

Two kinds of layer:

*Observed*  — what the instruments recorded (mean ΔT on summer nights, etc.).
*Modelled*  — what the tuned Random Forest predicts for every site when the
              atmosphere is held identical everywhere. Holding weather constant
              across all sites isolates the part of the anomaly attributable to
              the built fabric, which is exactly the planner's question.
"""
from __future__ import annotations

import gc
import json

import numpy as np
import pandas as pd

from .build_heat import HEAT_DATASET_PATH
from .build_stations import STATIONS_PATH
from .config import REPORTS_DIR
from .features import HEAT_FEATURES, engineer_heat_features
from .utils import get_logger, heat_index_c, heat_risk_band, relative_humidity_pct

log = get_logger(__name__)

HOTSPOTS_PATH = REPORTS_DIR / "hotspots.json"

SITE_COLUMNS = [
    "station_id", "station_name", "state", "lat", "lon", "elevation_m", "urban_class",
    "building_plan_fraction_1km", "building_count_km2_1km", "road_length_km_km2_1km",
    "green_fraction_1km", "water_fraction_1km", "impervious_fraction_1km",
    "building_count_km2_3km", "green_count_km2_3km", "water_count_km2_3km",
]

CONDITION_FIELDS = ("t_ref_c", "dewpoint_ref_c", "wind_speed_ms",
                    "sky_cover_oktas", "slp_hpa", "precip_1h_mm")


def load_sites() -> pd.DataFrame:
    stations = pd.read_parquet(STATIONS_PATH)
    return stations[SITE_COLUMNS].reset_index(drop=True)


def predict_sites(bundle: dict, sites: pd.DataFrame, conditions: dict,
                  ts_utc: pd.Timestamp) -> pd.DataFrame:
    """Predict ΔT at every site under one shared atmospheric state."""
    frame = sites.copy()
    frame["ts_utc"] = pd.Timestamp(ts_utc).tz_convert("UTC") if pd.Timestamp(ts_utc).tzinfo \
        else pd.Timestamp(ts_utc, tz="UTC")
    for field in CONDITION_FIELDS:
        frame[field] = float(conditions[field])

    engineered = engineer_heat_features(frame)
    X = engineered[bundle["features"]].astype("float32")
    frame["predicted_uhi_c"] = bundle["pipeline"].predict(X)

    frame["predicted_temp_c"] = frame["predicted_uhi_c"] + conditions["t_ref_c"]
    rh = relative_humidity_pct(frame["predicted_temp_c"], conditions["dewpoint_ref_c"])
    frame["predicted_rh_pct"] = rh
    frame["predicted_heat_index_c"] = heat_index_c(frame["predicted_temp_c"], rh)
    bands = [heat_risk_band(v) for v in frame["predicted_heat_index_c"]]
    frame["heat_risk"] = [b[0] for b in bands]
    frame["heat_risk_note"] = [b[1] for b in bands]
    return frame


def _baseline_conditions_from_engineered(engineered: pd.DataFrame) -> dict:
    """A representative calm summer night, taken from the observed record.

    These are medians of real observations in the summer months after sunset —
    not a hypothetical scenario. Using the median keeps the baseline inside the
    region of feature space the model actually saw.
    """
    night = engineered[(engineered["season"] == 2) & (engineered["is_night"] == 1)]
    if night.empty:
        night = engineered
    return {field: float(night[field].median()) for field in CONDITION_FIELDS}


# Thinning threshold — enough for accurate medians/means, not so large it OOMs.
_STATS_MAX_ROWS = 200_000


def build(bundle: dict) -> dict:
    heat_raw = pd.read_parquet(HEAT_DATASET_PATH)
    # Thin for the observed-statistics pass; 200k rows is more than enough for
    # reliable medians and group means. The stride preserves chronological spread
    # without biasing toward any particular season.
    _stride = max(1, len(heat_raw) // _STATS_MAX_ROWS)
    heat = heat_raw.iloc[::_stride].reset_index(drop=True)
    del heat_raw
    gc.collect()

    sites = load_sites()

    engineered = engineer_heat_features(heat)
    del heat
    gc.collect()

    summer_night = engineered[(engineered["season"] == 2) & (engineered["is_night"] == 1)]

    observed = (summer_night.groupby("station_id", observed=True)
                .agg(observed_mean_uhi_c=("uhi_intensity_c", "mean"),
                     observed_p90_uhi_c=("uhi_intensity_c", lambda s: float(s.quantile(0.90))),
                     observed_mean_temp_c=("t_site_c", "mean"),
                     observed_hours=("uhi_intensity_c", "size"))
                .reset_index())
    annual = (engineered.groupby("station_id", observed=True)
              .agg(annual_mean_uhi_c=("uhi_intensity_c", "mean"),
                   annual_hours=("uhi_intensity_c", "size"))
              .reset_index())

    # Reuse already-engineered frame — avoids a second 540 MB copy pass.
    conditions = _baseline_conditions_from_engineered(engineered)
    del engineered
    gc.collect()
    # Anchor the baseline at 23:00 local on a mid-July night — the hour at which
    # the nocturnal heat island is typically at its strongest.
    reference_ts = pd.Timestamp("2024-07-16 03:00", tz="UTC")   # 23:00 EDT
    predicted = predict_sites(bundle, sites, conditions, reference_ts)

    table = (predicted
             .merge(observed, on="station_id", how="left")
             .merge(annual, on="station_id", how="left"))
    table = table[table["observed_hours"].fillna(0) >= 100]

    records = []
    for row in table.itertuples(index=False):
        records.append({
            "station_id": row.station_id,
            "name": row.station_name,
            "state": row.state,
            "country": "US",
            "lat": float(row.lat),
            "lon": float(row.lon),
            "elevation_m": float(row.elevation_m),
            "urban_class": row.urban_class,
            # Every morphology column the model consumes must travel with the
            # site. Omitting one would not fail — the pipeline's imputer would
            # quietly substitute a training median — which is precisely why the
            # full set is written rather than the subset the UI happens to draw.
            "morphology": {
                "building_plan_fraction_1km": float(row.building_plan_fraction_1km),
                "building_count_km2_1km": float(row.building_count_km2_1km),
                "building_count_km2_3km": float(row.building_count_km2_3km),
                "road_length_km_km2_1km": float(row.road_length_km_km2_1km),
                "green_fraction_1km": float(row.green_fraction_1km),
                "water_fraction_1km": float(row.water_fraction_1km),
                "impervious_fraction_1km": float(row.impervious_fraction_1km),
                "green_count_km2_3km": float(row.green_count_km2_3km),
                "water_count_km2_3km": float(row.water_count_km2_3km),
            },
            "observed": {
                "summer_night_mean_uhi_c": float(row.observed_mean_uhi_c),
                "summer_night_p90_uhi_c": float(row.observed_p90_uhi_c),
                "summer_night_mean_temp_c": float(row.observed_mean_temp_c),
                "summer_night_hours": int(row.observed_hours),
                "annual_mean_uhi_c": float(row.annual_mean_uhi_c),
                "annual_hours": int(row.annual_hours),
            },
            "modelled": {
                "uhi_c": float(row.predicted_uhi_c),
                "temp_c": float(row.predicted_temp_c),
                "heat_index_c": float(row.predicted_heat_index_c),
                "heat_risk": row.heat_risk,
            },
        })

    records.sort(key=lambda r: r["modelled"]["uhi_c"], reverse=True)
    payload = {
        "generated_at": pd.Timestamp.utcnow().isoformat(),
        "reference_time_utc": str(reference_ts),
        "reference_time_local": "2024-07-15 23:00 US/Eastern",
        "baseline_conditions": conditions,
        "baseline_description": (
            "Median observed atmospheric conditions on summer nights across the study "
            "region, applied identically to every site so that the differences between "
            "sites come only from geography and urban fabric."
        ),
        "sites": records,
        "summary": {
            "n_sites": len(records),
            "modelled_uhi_range_c": [
                float(min(r["modelled"]["uhi_c"] for r in records)),
                float(max(r["modelled"]["uhi_c"] for r in records)),
            ],
            "observed_uhi_range_c": [
                float(min(r["observed"]["summer_night_mean_uhi_c"] for r in records)),
                float(max(r["observed"]["summer_night_mean_uhi_c"] for r in records)),
            ],
            "by_class": {
                cls: {
                    "n": int(sum(1 for r in records if r["urban_class"] == cls)),
                    "mean_observed_uhi_c": float(np.mean(
                        [r["observed"]["summer_night_mean_uhi_c"] for r in records
                         if r["urban_class"] == cls] or [np.nan])),
                    "mean_modelled_uhi_c": float(np.mean(
                        [r["modelled"]["uhi_c"] for r in records
                         if r["urban_class"] == cls] or [np.nan])),
                }
                for cls in ("urban", "suburban", "rural")
            },
        },
        "caveats": [
            "Each point is a physical weather station, not a grid cell. The map shows "
            "measured and modelled values at those locations only.",
            "Modelled values hold the atmosphere fixed across all sites; observed values "
            "are averages over real, varying weather.",
        ],
    }

    HOTSPOTS_PATH.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    log.info("hotspots → %s · %d sites · modelled ΔT %.2f…%.2f °C", HOTSPOTS_PATH.name,
             len(records), *payload["summary"]["modelled_uhi_range_c"])
    return payload
