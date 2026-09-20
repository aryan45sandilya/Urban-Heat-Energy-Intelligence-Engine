"""Stage 1 — build the observation network.

Assembles the station universe for the study:
  1. ISD inventory  → candidate stations inside the domain with a matching period of record
  2. ISD-Lite pull  → real hourly observations, kept only where coverage is adequate
  3. OSM morphology → the physical urban fabric around each surviving station
  4. Classification → urban vs rural, from the *observed* distribution of built-up density

Outputs
    data/interim/isd_hourly.parquet   tidy hourly observations (long format)
    data/interim/stations.parquet     station metadata + morphology + urban class
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .config import (
    INTERIM_DIR, MIN_HOURLY_COVERAGE, MORPH_RADII_M, RURAL_BPF3K_MAX,
    URBAN_BPF3K_MIN, YEARS,
)
from .sources import isd, osm
from .utils import get_logger

log = get_logger(__name__)

ISD_HOURLY_PATH = INTERIM_DIR / "isd_hourly.parquet"
STATIONS_PATH = INTERIM_DIR / "stations.parquet"

MAX_STATIONS = 260          # bound on Overpass work; stations ranked by data coverage
_NUMERIC_COLS = ["temp_c", "dewpoint_c", "slp_hpa", "wind_speed_ms",
                 "wind_dir_deg", "sky_cover_oktas", "precip_1h_mm"]


def select_candidates(force: bool = False) -> pd.DataFrame:
    """Stations whose period of record spans the whole study window."""
    # Always use the cached ISD history for candidate selection. A force-refreshed
    # history shows only a handful of recently-indexed stations with 2026 end dates
    # while most active stations are still listed with their August-2025 end date —
    # the metadata is updated asynchronously by NOAA, not all at once. Using force
    # here produces a far smaller candidate set than the cached file does.
    inventory = isd.fetch_station_history(force=False)
    start = pd.Timestamp(f"{min(YEARS)}-01-01")
    # Active stations are processed in batches, so they cluster within a few days
    # of the history file's last-refresh date. Use max_end - 7 days as the threshold
    # to capture the whole batch rather than just the single most-recent date.
    max_end = inventory["end"].max()
    end = max_end - pd.Timedelta(days=7)
    covered = inventory[(inventory["begin"] <= start) & (inventory["end"] >= end)]
    log.info("candidates with full period of record: %d", len(covered))
    return covered.reset_index(drop=True)


def pull_observations(candidates: pd.DataFrame, force: bool = False) -> pd.DataFrame:
    """Download + parse ISD-Lite for the candidate set (cached on disk)."""
    if ISD_HOURLY_PATH.exists() and not force:
        log.info("reusing cached hourly observations → %s", ISD_HOURLY_PATH.name)
        return pd.read_parquet(ISD_HOURLY_PATH)

    files = isd.fetch_many(candidates["station_id"].tolist(), YEARS)
    # For the current (partial) year, count only hours up to today rather than
    # assuming a full year — otherwise partial-year stations fail the coverage gate.
    today = pd.Timestamp.today()
    expected_hours = 0
    for y in YEARS:
        if y < today.year:
            expected_hours += (366 if y % 4 == 0 else 365) * 24
        else:
            year_start = pd.Timestamp(f"{y}-01-01")
            expected_hours += int((today - year_start).total_seconds() // 3600)

    frames, kept = [], []
    for i, (station_id, paths) in enumerate(files.items(), start=1):
        df = isd.parse_station(station_id, paths)
        if df.empty:
            continue
        usable = df["temp_c"].notna().sum()
        coverage = usable / expected_hours
        if coverage < MIN_HOURLY_COVERAGE:
            continue
        kept.append((station_id, coverage))
        frames.append(df)
        if i % 50 == 0:
            log.info("  parsed %d/%d stations (%d kept)", i, len(files), len(frames))

    if not frames:
        raise RuntimeError("No station passed the coverage gate — check network access.")

    coverage_rank = pd.DataFrame(kept, columns=["station_id", "coverage"]) \
        .sort_values("coverage", ascending=False).head(MAX_STATIONS)
    keep_ids = set(coverage_rank["station_id"])

    obs = pd.concat([f for f in frames if f["station_id"].iloc[0] in keep_ids],
                    ignore_index=True)
    obs = obs[obs["ts_utc"].dt.year.isin(YEARS)]
    for col in _NUMERIC_COLS:
        obs[col] = obs[col].astype("float32")
    obs["station_id"] = obs["station_id"].astype("category")

    obs.to_parquet(ISD_HOURLY_PATH, index=False)
    log.info("hourly observations: %d rows · %d stations → %s",
             len(obs), obs["station_id"].nunique(), ISD_HOURLY_PATH.name)
    return obs


def _classify(stations: pd.DataFrame) -> pd.DataFrame:
    """Split the network into urban / rural / intermediate from observed density.

    Thresholds are taken from the empirical distribution of building density at
    the 3 km scale (terciles), then clamped by the absolute floors in config so
    that a domain which happens to contain no real city cannot manufacture one.
    """
    density = stations["building_count_km2_3km"]
    plan = stations["building_plan_fraction_1km"]

    hi = max(float(density.quantile(0.66)), 1.0)
    lo = min(float(density.quantile(0.33)), hi - 1e-6)

    urban = (density >= hi) & (plan >= URBAN_BPF3K_MIN)
    rural = (density <= lo) & (plan <= RURAL_BPF3K_MAX)

    stations = stations.copy()
    stations["urban_class"] = np.select([urban, rural], ["urban", "rural"], default="suburban")
    log.info("classification → %s", stations["urban_class"].value_counts().to_dict())
    log.info("  building density 3km: rural ≤ %.1f /km² · urban ≥ %.1f /km²", lo, hi)
    return stations


def build(force: bool = False) -> pd.DataFrame:
    if STATIONS_PATH.exists() and not force:
        log.info("reusing cached station table → %s", STATIONS_PATH.name)
        return pd.read_parquet(STATIONS_PATH)

    candidates = select_candidates(force=force)
    obs = pull_observations(candidates, force=force)

    present = obs["station_id"].astype(str).unique().tolist()
    stations = candidates[candidates["station_id"].isin(present)].reset_index(drop=True)

    coverage = (obs.groupby("station_id", observed=True)["temp_c"]
                   .apply(lambda s: float(s.notna().mean()))
                   .rename("temp_coverage").reset_index())
    coverage["station_id"] = coverage["station_id"].astype(str)
    stations = stations.merge(coverage, on="station_id", how="left")

    morph = osm.build_morphology_table(stations[["station_id", "lat", "lon"]], MORPH_RADII_M)
    if morph.empty:
        raise RuntimeError("Overpass returned no morphology — cannot classify the network.")

    stations = stations.merge(morph, on="station_id", how="inner")
    stations = _classify(stations)

    # Impervious-surface proxy: sealed ground = buildings + carriageway.
    # Road width is not tagged for most ways, so we use a fixed 7 m carriageway,
    # a documented assumption rather than a measurement.
    stations["impervious_fraction_1km"] = np.clip(
        stations["building_plan_fraction_1km"]
        + stations["road_length_km_km2_1km"] * 1000.0 * 7.0 / 1e6,
        0.0, 1.0,
    )

    stations.to_parquet(STATIONS_PATH, index=False)
    log.info("station table → %s (%d stations)", STATIONS_PATH.name, len(stations))
    return stations


if __name__ == "__main__":  # pragma: no cover
    build()
