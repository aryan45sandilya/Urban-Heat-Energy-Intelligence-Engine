"""Stage 2A — construct the urban-heat-island dataset.

Target
------
`uhi_intensity_c` — the hourly air-temperature anomaly of a site relative to the
rural landscape around it:

    ΔT(s,t) = T_obs(s,t) − mean_r [ T_obs(r,t) − Γ · (z_s − z_r) ]

where `r` runs over the K nearest *rural* reference stations and Γ is the
standard environmental lapse rate (6.5 °C/km), applied so that a hill station is
not credited with a cool "anomaly" that is really just altitude.

Why this target rather than raw temperature
-------------------------------------------
Raw air temperature is dominated by the synoptic weather pattern, which is
identical for a city and its countryside; a model of raw temperature learns the
season, not the city. Differencing against the rural background removes the
synoptic signal, and what remains is the quantity urban planners actually care
about: how much hotter this particular place is than it would otherwise be.

Leakage safeguards
------------------
* The site's own observations never appear among the features.
* A station is never its own reference, and references must be ≥ 15 km away.
* Reference and site are matched hour-for-hour in UTC — no forward fill.

Output
    data/processed/heat_dataset.parquet
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .build_stations import build as build_network, ISD_HOURLY_PATH
from .config import (
    LAPSE_RATE_C_PER_M, MAX_ELEV_DIFF_M, N_REFERENCE_STATIONS, PROCESSED_DIR,
    REF_MIN_DISTANCE_KM, REF_SEARCH_RADIUS_KM, UHI_PLAUSIBLE_RANGE,
)
from .utils import get_logger, haversine_km

log = get_logger(__name__)

HEAT_DATASET_PATH = PROCESSED_DIR / "heat_dataset.parquet"
PAIRS_PATH = PROCESSED_DIR / "station_reference_pairs.parquet"

BACKGROUND_VARS = ("dewpoint_c", "wind_speed_ms", "sky_cover_oktas", "slp_hpa", "precip_1h_mm")
MIN_REFERENCES_REPORTING = 2


def assign_references(stations: pd.DataFrame) -> pd.DataFrame:
    """Match every station to its K nearest qualifying rural reference stations."""
    # A station sitting on water (lighthouses, harbour beacons, offshore buoys)
    # is thermally governed by the sea, not by the rural landscape, so it cannot
    # serve as a land reference. Absence of any mapped road within 1 km is a
    # reliable land mask in this domain — every inland station in the US
    # Northeast has some carriageway nearby. Such stations remain valid *sites*;
    # they are simply not used as yardsticks.
    rural = stations[
        (stations["urban_class"] == "rural")
        & (stations["water_fraction_1km"] <= 0.35)
        & (stations["road_length_km_km2_1km"] >= 0.25)
    ].reset_index(drop=True)
    if len(rural) < N_REFERENCE_STATIONS + 1:
        raise RuntimeError(
            f"Only {len(rural)} rural stations available — cannot form reference sets."
        )
    log.info("rural reference pool: %d stations", len(rural))

    rows = []
    for site in stations.itertuples(index=False):
        dist = haversine_km(site.lat, site.lon, rural["lat"].to_numpy(), rural["lon"].to_numpy())
        elev_gap = np.abs(rural["elevation_m"].to_numpy() - site.elevation_m)
        eligible = (
            (dist >= REF_MIN_DISTANCE_KM)
            & (dist <= REF_SEARCH_RADIUS_KM)
            & (elev_gap <= MAX_ELEV_DIFF_M)
            & (rural["station_id"].to_numpy() != site.station_id)
        )
        if eligible.sum() < MIN_REFERENCES_REPORTING:
            continue
        order = np.argsort(np.where(eligible, dist, np.inf))[:N_REFERENCE_STATIONS]
        for rank, idx in enumerate(order):
            if not eligible[idx]:
                continue
            rows.append({
                "station_id": site.station_id,
                "ref_station_id": rural.loc[idx, "station_id"],
                "rank": rank,
                "distance_km": float(dist[idx]),
                "ref_elevation_m": float(rural.loc[idx, "elevation_m"]),
                "site_elevation_m": float(site.elevation_m),
            })

    pairs = pd.DataFrame(rows)
    n_sites = pairs["station_id"].nunique()
    log.info("reference pairing: %d sites × up to %d references (median distance %.0f km)",
             n_sites, N_REFERENCE_STATIONS, pairs["distance_km"].median())
    return pairs


def _pivot(obs: pd.DataFrame, column: str) -> pd.DataFrame:
    wide = obs.pivot_table(index="ts_utc", columns="station_id", values=column,
                           aggfunc="first", observed=True)
    wide.columns = [str(c) for c in wide.columns]
    return wide.astype("float32")


def build(force: bool = False) -> pd.DataFrame:
    if HEAT_DATASET_PATH.exists() and not force:
        log.info("reusing cached heat dataset → %s", HEAT_DATASET_PATH.name)
        return pd.read_parquet(HEAT_DATASET_PATH)

    stations = build_network()
    obs = pd.read_parquet(ISD_HOURLY_PATH)
    obs["station_id"] = obs["station_id"].astype(str)

    pairs = assign_references(stations)
    pairs.to_parquet(PAIRS_PATH, index=False)

    log.info("pivoting observations to a station × hour grid …")
    temp = _pivot(obs, "temp_c")
    # A sparse channel (sky cover, in particular) produces a pivot with fewer
    # hours and fewer stations than the temperature grid. Reindexing onto the
    # temperature axes keeps every grid the same shape, so a missing channel
    # becomes NaN in the right cell rather than silently shifting the alignment.
    background = {var: _pivot(obs, var).reindex(index=temp.index, columns=temp.columns)
                  for var in BACKGROUND_VARS}
    log.info("grid: %d hours × %d stations", len(temp), temp.shape[1])

    frames = []
    grouped = pairs.groupby("station_id")
    for i, (station_id, group) in enumerate(grouped, start=1):
        if station_id not in temp.columns:
            continue
        refs = [r for r in group["ref_station_id"] if r in temp.columns]
        if len(refs) < MIN_REFERENCES_REPORTING:
            continue

        site_elev = float(group["site_elevation_m"].iloc[0])
        ref_elev = group.set_index("ref_station_id")["ref_elevation_m"].reindex(refs).to_numpy()
        # Bring each reference to the site's altitude before comparing.
        lapse_adj = -LAPSE_RATE_C_PER_M * (site_elev - ref_elev)

        ref_temp = temp[refs].to_numpy(dtype="float32") + lapse_adj.astype("float32")
        n_ref = np.sum(~np.isnan(ref_temp), axis=1)
        with np.errstate(invalid="ignore"):
            t_ref = np.nanmean(ref_temp, axis=1)

        site_temp = temp[station_id].to_numpy(dtype="float32")
        uhi = site_temp - t_ref

        valid = (n_ref >= MIN_REFERENCES_REPORTING) & np.isfinite(uhi) & np.isfinite(site_temp)
        if valid.sum() == 0:
            continue

        frame = {
            "station_id": station_id,
            "ts_utc": temp.index.to_numpy()[valid],
            "uhi_intensity_c": uhi[valid].astype("float32"),
            "t_site_c": site_temp[valid].astype("float32"),
            "t_ref_c": t_ref[valid].astype("float32"),
            "n_reference_stations": n_ref[valid].astype("int8"),
            "mean_reference_distance_km": np.float32(group["distance_km"].mean()),
        }
        for var in BACKGROUND_VARS:
            with np.errstate(invalid="ignore"):
                values = np.nanmean(background[var][refs].to_numpy(dtype="float32"), axis=1)
            name = "dewpoint_ref_c" if var == "dewpoint_c" else var
            frame[name] = values[valid].astype("float32")

        frames.append(pd.DataFrame(frame))
        if i % 40 == 0:
            log.info("  sites processed %d/%d", i, grouped.ngroups)

    dataset = pd.concat(frames, ignore_index=True)
    log.info("raw site-hours: %d", len(dataset))

    lo, hi = UHI_PLAUSIBLE_RANGE
    outside = ~dataset["uhi_intensity_c"].between(lo, hi)
    log.info("dropping %d (%.3f%%) site-hours outside the plausible ΔT range [%.0f, %.0f] °C",
             int(outside.sum()), 100 * outside.mean(), lo, hi)
    dataset = dataset[~outside]

    # Background dew point is essential (it drives humidity features); rows
    # without it are dropped rather than filled with an invented value.
    dataset = dataset.dropna(subset=["t_ref_c", "dewpoint_ref_c"])

    morph_cols = [
        "lat", "lon", "elevation_m", "station_name", "state", "urban_class",
        "building_plan_fraction_1km", "building_count_km2_1km", "road_length_km_km2_1km",
        "green_fraction_1km", "water_fraction_1km", "impervious_fraction_1km",
        "building_count_km2_3km", "green_count_km2_3km", "water_count_km2_3km",
        "road_count_km2_3km",
    ]
    dataset = dataset.merge(stations[["station_id"] + morph_cols], on="station_id", how="inner")
    dataset = dataset.sort_values(["ts_utc", "station_id"]).reset_index(drop=True)

    dataset.to_parquet(HEAT_DATASET_PATH, index=False)
    log.info("heat dataset → %s · %d rows · %d sites · ΔT mean %.2f °C (sd %.2f)",
             HEAT_DATASET_PATH.name, len(dataset), dataset["station_id"].nunique(),
             dataset["uhi_intensity_c"].mean(), dataset["uhi_intensity_c"].std())
    return dataset


if __name__ == "__main__":  # pragma: no cover
    build()
