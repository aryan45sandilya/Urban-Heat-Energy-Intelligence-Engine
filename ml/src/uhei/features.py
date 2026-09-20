"""Feature engineering — the single source of truth for both tasks.

This module is imported by the training pipeline *and* by the serving layer, so
a prediction made through the API is transformed by exactly the same code that
produced the training matrix. Every function here is pure: same input → same
output, no fitted state, no hidden globals.

Anything fitted (imputation statistics, scaling) lives inside the scikit-learn
pipeline and is fitted on the training split only.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from pandas.tseries.holiday import USFederalHolidayCalendar

from .utils import clear_sky_index, heat_index_c, relative_humidity_pct, solar_elevation_deg

LOCAL_TZ = "America/New_York"   # the entire study domain observes US Eastern Time


# ── Season ───────────────────────────────────────────────────────────────────
def meteorological_season(month) -> np.ndarray:
    """0 = winter (DJF), 1 = spring (MAM), 2 = summer (JJA), 3 = autumn (SON)."""
    m = np.asarray(month, dtype=int)
    return ((m % 12) // 3).astype(np.int8)


def _cyclical(values, period: float) -> tuple[np.ndarray, np.ndarray]:
    angle = 2.0 * np.pi * np.asarray(values, dtype=float) / period
    return np.sin(angle), np.cos(angle)


# ── Shared temporal block ────────────────────────────────────────────────────
def add_time_features(df: pd.DataFrame, ts_col: str = "ts_utc") -> pd.DataFrame:
    """Calendar + solar-cycle features derived from a tz-aware UTC timestamp."""
    out = df.copy()
    ts = pd.DatetimeIndex(pd.to_datetime(out[ts_col], utc=True))
    local = ts.tz_convert(LOCAL_TZ)

    out["hour_local"] = local.hour.astype(np.int16)
    out["day_of_week"] = local.dayofweek.astype(np.int8)
    out["day_of_year"] = local.dayofyear.astype(np.int16)
    out["month"] = local.month.astype(np.int8)
    out["year"] = local.year.astype(np.int16)
    out["season"] = meteorological_season(out["month"])
    out["is_weekend"] = (out["day_of_week"] >= 5).astype(np.int8)

    out["hour_sin"], out["hour_cos"] = _cyclical(out["hour_local"], 24.0)
    out["doy_sin"], out["doy_cos"] = _cyclical(out["day_of_year"], 365.25)
    return out


def add_holiday_flag(df: pd.DataFrame, ts_col: str = "ts_utc") -> pd.DataFrame:
    """US federal holidays — a deterministic published calendar, not an estimate."""
    out = df.copy()
    ts = pd.DatetimeIndex(pd.to_datetime(out[ts_col], utc=True)).tz_convert(LOCAL_TZ)
    dates = ts.normalize().tz_localize(None)
    calendar = USFederalHolidayCalendar()
    holidays = set(calendar.holidays(start=dates.min(), end=dates.max()))
    out["is_holiday"] = dates.isin(holidays).astype(np.int8)
    return out


def add_solar_features(df: pd.DataFrame, ts_col: str = "ts_utc",
                       lat_col: str = "lat", lon_col: str = "lon") -> pd.DataFrame:
    out = df.copy()
    elev = solar_elevation_deg(out[ts_col], out[lat_col].to_numpy(), out[lon_col].to_numpy())
    out["solar_elevation_deg"] = elev.astype(np.float32)
    out["clear_sky_index"] = clear_sky_index(elev).astype(np.float32)
    out["is_night"] = (elev < -0.83).astype(np.int8)      # -0.83° ≈ refracted sunset
    return out


# ═════════════════════════════════════════════════════════════════════════════
# Task A — Urban heat island intensity
# ═════════════════════════════════════════════════════════════════════════════

HEAT_RAW_INPUTS = [
    # Background (rural reference) atmospheric state
    "t_ref_c", "dewpoint_ref_c", "wind_speed_ms", "sky_cover_oktas",
    "slp_hpa", "precip_1h_mm",
    # Site geography
    "lat", "lon", "elevation_m",
    # Site urban morphology (OSM-derived)
    "building_plan_fraction_1km", "building_count_km2_1km", "road_length_km_km2_1km",
    "green_fraction_1km", "water_fraction_1km", "impervious_fraction_1km",
    "building_count_km2_3km", "green_count_km2_3km", "water_count_km2_3km",
]

HEAT_FEATURES = [
    # Background atmosphere
    "t_ref_c", "rh_ref_pct", "dewpoint_depression_c", "wind_speed_ms",
    "sky_cover_oktas", "slp_hpa", "precip_1h_mm", "is_precipitating",
    # Solar & time
    "solar_elevation_deg", "clear_sky_index", "is_night",
    "hour_sin", "hour_cos", "doy_sin", "doy_cos", "season", "is_weekend",
    # Geography
    "lat", "lon", "elevation_m",
    # Urban morphology
    "building_plan_fraction_1km", "building_count_km2_1km", "road_length_km_km2_1km",
    "green_fraction_1km", "water_fraction_1km", "impervious_fraction_1km",
    "building_count_km2_3km", "green_count_km2_3km", "water_count_km2_3km",
    # Physically motivated interactions
    "impervious_x_calm", "impervious_x_night", "green_x_clearsky",
    "building3k_x_calm", "cloud_x_night", "water_x_summer",
]

HEAT_TARGET = "uhi_intensity_c"


def engineer_heat_features(df: pd.DataFrame) -> pd.DataFrame:
    """Build the urban-heat feature matrix from raw observation + morphology columns."""
    out = df.copy()
    if "hour_local" not in out.columns:
        out = add_time_features(out)
    if "solar_elevation_deg" not in out.columns:
        out = add_solar_features(out)

    out["rh_ref_pct"] = relative_humidity_pct(out["t_ref_c"], out["dewpoint_ref_c"]).astype(np.float32)
    out["dewpoint_depression_c"] = (out["t_ref_c"] - out["dewpoint_ref_c"]).astype(np.float32)
    # A silent precipitation channel means "no rain reported", which for this
    # flag is the same as no rain — a fixed constant, not a batch statistic.
    out["is_precipitating"] = (out["precip_1h_mm"].fillna(0.0) > 0.1).astype(np.int8)

    # Calm, clear nights are when the urban heat island is strongest — these
    # interactions give the linear baselines a fair chance at that physics and
    # make the tree models' splits easier to read.
    #
    # Missing wind or cloud is deliberately *not* filled here. Filling from a
    # batch statistic would make the transformation depend on which rows happen
    # to be present: during training the median would be drawn from the whole
    # record including the test window, and at serving time a single-row request
    # would take the median of itself. Both are wrong, and in opposite ways.
    # NaN is propagated instead and handled by the imputer inside the pipeline,
    # which is fitted on training folds only.
    calm = 1.0 / (1.0 + out["wind_speed_ms"])
    night = out["is_night"].astype(float)
    cloud = out["sky_cover_oktas"]

    out["impervious_x_calm"] = (out["impervious_fraction_1km"] * calm).astype(np.float32)
    out["impervious_x_night"] = (out["impervious_fraction_1km"] * night).astype(np.float32)
    out["green_x_clearsky"] = (out["green_fraction_1km"] * out["clear_sky_index"]).astype(np.float32)
    out["building3k_x_calm"] = (out["building_count_km2_3km"] * calm).astype(np.float32)
    out["cloud_x_night"] = (cloud * night).astype(np.float32)
    out["water_x_summer"] = (out["water_fraction_1km"] * (out["season"] == 2).astype(float)).astype(np.float32)

    return out


# ═════════════════════════════════════════════════════════════════════════════
# Task B — Zonal electricity demand
# ═════════════════════════════════════════════════════════════════════════════

ENERGY_RAW_INPUTS = [
    "zone", "temp_c", "dewpoint_c", "wind_speed_ms", "sky_cover_oktas",
    "temp_24h_mean_c", "temp_24h_max_c", "lat", "lon",
]

ENERGY_FEATURES = [
    "temp_c", "rh_pct", "heat_index_c", "wind_speed_ms", "sky_cover_oktas",
    "cooling_degrees", "heating_degrees",
    "temp_24h_mean_c", "temp_24h_max_c", "temp_24h_cdd",
    "solar_elevation_deg", "clear_sky_index",
    "hour_sin", "hour_cos", "doy_sin", "doy_cos",
    "hour_local", "day_of_week", "month", "season", "is_weekend", "is_holiday",
    "zone_code",
]

ENERGY_TARGET = "load_mw"

# Balance-point temperatures for degree-day construction (°C). 18.3 °C (65 °F)
# is the long-standing US convention used by NOAA and EIA.
COOLING_BALANCE_C = 18.3
HEATING_BALANCE_C = 18.3


def engineer_energy_features(df: pd.DataFrame, zone_codes: dict[str, int] | None = None) -> pd.DataFrame:
    """Build the electricity-demand feature matrix.

    Only *weather and calendar* drive this model. No lagged or autoregressive
    load term is used: the product question is "what does demand look like under
    these conditions", not "what is the next value of this time series".
    """
    out = df.copy()
    if "hour_local" not in out.columns:
        out = add_time_features(out)
    if "is_holiday" not in out.columns:
        out = add_holiday_flag(out)
    if "solar_elevation_deg" not in out.columns:
        out = add_solar_features(out)

    out["rh_pct"] = relative_humidity_pct(out["temp_c"], out["dewpoint_c"]).astype(np.float32)
    out["heat_index_c"] = heat_index_c(out["temp_c"], out["rh_pct"]).astype(np.float32)
    out["cooling_degrees"] = np.clip(out["temp_c"] - COOLING_BALANCE_C, 0, None).astype(np.float32)
    out["heating_degrees"] = np.clip(HEATING_BALANCE_C - out["temp_c"], 0, None).astype(np.float32)
    out["temp_24h_cdd"] = np.clip(out["temp_24h_mean_c"] - COOLING_BALANCE_C, 0, None).astype(np.float32)

    if zone_codes is None:
        zone_codes = {z: i for i, z in enumerate(sorted(out["zone"].astype(str).unique()))}
    out["zone_code"] = out["zone"].astype(str).map(zone_codes).astype("float32")
    return out
