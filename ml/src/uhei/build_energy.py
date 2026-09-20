"""Stage 2B — construct the zonal electricity-demand dataset.

Target
------
`load_mw` — NYISO's metered actual load for one of the 11 New York load zones,
averaged to the hour.

Weather attachment
------------------
Each zone is represented by the K nearest ISD stations to its principal load
centre, within 90 km. Their hourly observations are averaged to give the zone's
ambient conditions. This is an explicit, documented approximation: a load zone
is an area, not a point, and a handful of airports cannot describe it perfectly.

Leakage safeguards
------------------
* No autoregressive load term. The model answers "what demand do these
  conditions imply", not "what is the next number in this series".
* The rolling temperature aggregates are strictly backward-looking (the current
  hour and the 23 before it) and are computed per zone in chronological order.

Output
    data/processed/energy_dataset.parquet
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .build_stations import build as build_network, ISD_HOURLY_PATH
from .config import NYISO_ZONES, PROCESSED_DIR, YEARS, ZONE_STATION_RADIUS_KM
from .sources import nyiso
from .utils import get_logger, haversine_km

log = get_logger(__name__)

ENERGY_DATASET_PATH = PROCESSED_DIR / "energy_dataset.parquet"
ZONE_STATIONS_PATH = PROCESSED_DIR / "zone_stations.parquet"

STATIONS_PER_ZONE = 3
WEATHER_VARS = ("temp_c", "dewpoint_c", "wind_speed_ms", "sky_cover_oktas")


def assign_zone_stations(stations: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for zone, meta in NYISO_ZONES.items():
        dist = haversine_km(meta["lat"], meta["lon"],
                            stations["lat"].to_numpy(), stations["lon"].to_numpy())
        eligible = dist <= ZONE_STATION_RADIUS_KM
        if eligible.sum() == 0:
            log.warning("zone %s has no station within %.0f km", zone, ZONE_STATION_RADIUS_KM)
            continue
        order = np.argsort(np.where(eligible, dist, np.inf))[:STATIONS_PER_ZONE]
        for idx in order:
            if not eligible[idx]:
                continue
            rows.append({
                "zone": zone,
                "zone_name": meta["name"],
                "zone_lat": meta["lat"],
                "zone_lon": meta["lon"],
                "station_id": stations.iloc[idx]["station_id"],
                "station_name": stations.iloc[idx]["station_name"],
                "distance_km": float(dist[idx]),
            })
    mapping = pd.DataFrame(rows)
    log.info("zone↔station attachment: %d zones, %d links (median %.0f km)",
             mapping["zone"].nunique(), len(mapping), mapping["distance_km"].median())
    return mapping


def _zone_weather(obs: pd.DataFrame, mapping: pd.DataFrame) -> pd.DataFrame:
    merged = obs.merge(mapping[["zone", "station_id"]], on="station_id", how="inner")
    agg = (merged.groupby(["zone", "ts_utc"], observed=True)[list(WEATHER_VARS)]
                 .mean().reset_index())

    # Backward-looking thermal memory: buildings respond to the last day of
    # weather, not just the current hour. `closed="right"` keeps the window
    # ending at the current observation — nothing from the future enters.
    agg = agg.sort_values(["zone", "ts_utc"])
    roll = agg.groupby("zone", observed=True)["temp_c"].rolling(24, min_periods=12)
    agg["temp_24h_mean_c"] = roll.mean().reset_index(level=0, drop=True)
    agg["temp_24h_max_c"] = roll.max().reset_index(level=0, drop=True)
    return agg


def build(force: bool = False) -> pd.DataFrame:
    if ENERGY_DATASET_PATH.exists() and not force:
        log.info("reusing cached energy dataset → %s", ENERGY_DATASET_PATH.name)
        return pd.read_parquet(ENERGY_DATASET_PATH)

    stations = build_network()
    obs = pd.read_parquet(ISD_HOURLY_PATH)
    obs["station_id"] = obs["station_id"].astype(str)

    mapping = assign_zone_stations(stations)
    if mapping.empty:
        raise RuntimeError("No NYISO zone could be matched to a weather station.")
    mapping.to_parquet(ZONE_STATIONS_PATH, index=False)

    weather = _zone_weather(obs, mapping)

    archives = nyiso.fetch_years(YEARS)
    if not archives:
        raise RuntimeError("No NYISO load archives could be downloaded.")
    load = nyiso.load_hourly(archives)
    load = load[load["ts_utc"].dt.year.isin(YEARS)]

    dataset = load.merge(weather, on=["zone", "ts_utc"], how="inner")
    dataset = dataset.dropna(subset=["temp_c", "dewpoint_c", "load_mw", "temp_24h_mean_c"])

    centroids = mapping.drop_duplicates("zone").set_index("zone")
    dataset["lat"] = dataset["zone"].map(centroids["zone_lat"])
    dataset["lon"] = dataset["zone"].map(centroids["zone_lon"])
    dataset["zone_name"] = dataset["zone"].map(centroids["zone_name"])

    # Metered load below 1 MW in a NYISO zone is a reporting artefact.
    dataset = dataset[dataset["load_mw"] >= 1.0]
    dataset = dataset.sort_values(["ts_utc", "zone"]).reset_index(drop=True)

    dataset.to_parquet(ENERGY_DATASET_PATH, index=False)
    log.info("energy dataset → %s · %d rows · %d zones · load %.0f–%.0f MW",
             ENERGY_DATASET_PATH.name, len(dataset), dataset["zone"].nunique(),
             dataset["load_mw"].min(), dataset["load_mw"].max())
    return dataset


if __name__ == "__main__":  # pragma: no cover
    build()
