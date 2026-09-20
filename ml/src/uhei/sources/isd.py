"""NOAA NCEI Integrated Surface Database (ISD-Lite) adapter.

ISD-Lite is a fixed-width, quality-controlled hourly subset of the global ISD
archive. Every value in it is a physical observation from a real instrument.

Record layout (12 whitespace-separated fields, -9999 == missing):
    1  year                          7  sea-level pressure   (hPa  ×10)
    2  month                         8  wind direction       (deg true)
    3  day                           9  wind speed           (m/s  ×10)
    4  hour (UTC)                   10  sky-cover code       (oktas, 0-8)
    5  air temperature  (°C ×10)    11  1-hour precipitation (mm ×10)
    6  dew-point temp   (°C ×10)    12  6-hour precipitation (mm ×10)
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

from ..config import RAW_DIR, STATES, DOMAIN_BBOX
from ..utils import download, get_logger, make_session

log = get_logger(__name__)

HISTORY_URL = "https://www.ncei.noaa.gov/pub/data/noaa/isd-history.csv"
ISD_LITE_URL = "https://www.ncei.noaa.gov/pub/data/noaa/isd-lite/{year}/{usaf}-{wban}-{year}.gz"

ISD_DIR = RAW_DIR / "isd"

_COLUMNS = [
    "year", "month", "day", "hour",
    "temp_c10", "dewpoint_c10", "slp_hpa10",
    "wind_dir_deg", "wind_speed_ms10", "sky_cover_oktas",
    "precip_1h_mm10", "precip_6h_mm10",
]
_MISSING = -9999


def fetch_station_history(force: bool = False) -> pd.DataFrame:
    """Download and parse the ISD station inventory, restricted to the domain."""
    dest = ISD_DIR / "isd-history.csv"
    path = download(HISTORY_URL, dest, force=force)
    if path is None:
        raise RuntimeError(f"Could not download ISD station history from {HISTORY_URL}")

    df = pd.read_csv(path, dtype={"USAF": str, "WBAN": str})
    df.columns = [c.strip() for c in df.columns]
    df = df.rename(columns={
        "STATION NAME": "station_name", "CTRY": "country", "STATE": "state",
        "LAT": "lat", "LON": "lon", "ELEV(M)": "elevation_m",
        "BEGIN": "begin", "END": "end", "ICAO": "icao",
    })
    df["usaf"] = df["USAF"].str.strip().str.zfill(6)
    df["wban"] = df["WBAN"].str.strip().str.zfill(5)
    df["station_id"] = df["usaf"] + "-" + df["wban"]
    df["station_name"] = df["station_name"].astype(str).str.strip().str.title()

    for col in ("lat", "lon", "elevation_m"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["begin"] = pd.to_datetime(df["begin"], format="%Y%m%d", errors="coerce")
    df["end"] = pd.to_datetime(df["end"], format="%Y%m%d", errors="coerce")

    keep = [
        "station_id", "usaf", "wban", "station_name", "icao", "country", "state",
        "lat", "lon", "elevation_m", "begin", "end",
    ]
    df = df[keep]

    bbox = DOMAIN_BBOX
    mask = (
        df["country"].eq("US")
        & df["state"].isin(STATES)
        & df["lat"].between(bbox["lat_min"], bbox["lat_max"])
        & df["lon"].between(bbox["lon_min"], bbox["lon_max"])
        & df["lat"].notna() & df["lon"].notna()
        & df["elevation_m"].between(-50, 2500)
        & ~(df["lat"].eq(0) & df["lon"].eq(0))
    )
    out = df.loc[mask].drop_duplicates("station_id").reset_index(drop=True)
    log.info("ISD inventory: %d stations inside the study domain", len(out))
    return out


def _isd_lite_path(station_id: str, year: int) -> Path:
    return ISD_DIR / "lite" / str(year) / f"{station_id}-{year}.gz"


def fetch_station_year(station_id: str, year: int, session=None) -> Path | None:
    usaf, wban = station_id.split("-")
    url = ISD_LITE_URL.format(year=year, usaf=usaf, wban=wban)
    return download(url, _isd_lite_path(station_id, year), session=session)


def fetch_many(station_ids: list[str], years: tuple[int, ...], workers: int = 8) -> dict[str, list[Path]]:
    """Download ISD-Lite files in parallel. Missing station-years are skipped."""
    session = make_session()
    jobs = [(sid, yr) for sid in station_ids for yr in years]
    results: dict[str, list[Path]] = {sid: [] for sid in station_ids}

    def _job(item):
        sid, yr = item
        return sid, fetch_station_year(sid, yr, session=session)

    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for sid, path in pool.map(_job, jobs):
            done += 1
            if path is not None:
                results[sid].append(path)
            if done % 100 == 0:
                log.info("  ISD download %d/%d", done, len(jobs))
    have = {k: v for k, v in results.items() if v}
    log.info("ISD-Lite: %d/%d stations returned at least one year of data",
             len(have), len(station_ids))
    return have


def parse_station(station_id: str, paths: list[Path]) -> pd.DataFrame:
    """Parse one station's ISD-Lite files into a tidy, unit-correct frame."""
    frames = []
    for path in sorted(paths):
        try:
            raw = pd.read_csv(
                path, sep=r"\s+", header=None, names=_COLUMNS,
                compression="gzip", engine="c",
            )
        except Exception as exc:  # pragma: no cover - corrupt archive member
            log.warning("unreadable ISD file %s (%s)", path.name, exc)
            continue
        if raw.empty:
            continue
        frames.append(raw)
    if not frames:
        return pd.DataFrame()

    df = pd.concat(frames, ignore_index=True)
    df = df.replace(_MISSING, np.nan)

    ts = pd.to_datetime(
        dict(year=df["year"], month=df["month"], day=df["day"], hour=df["hour"]),
        errors="coerce", utc=True,
    )
    out = pd.DataFrame({
        "station_id": station_id,
        "ts_utc": ts,
        "temp_c": df["temp_c10"] / 10.0,
        "dewpoint_c": df["dewpoint_c10"] / 10.0,
        "slp_hpa": df["slp_hpa10"] / 10.0,
        "wind_dir_deg": df["wind_dir_deg"],
        "wind_speed_ms": df["wind_speed_ms10"] / 10.0,
        "sky_cover_oktas": df["sky_cover_oktas"],
        "precip_1h_mm": df["precip_1h_mm10"] / 10.0,
    })

    # Physical plausibility gates — values outside these are instrument faults,
    # not weather. They are dropped, never imputed with invented numbers.
    out.loc[~out["temp_c"].between(-50, 55), "temp_c"] = np.nan
    out.loc[~out["dewpoint_c"].between(-60, 40), "dewpoint_c"] = np.nan
    out.loc[out["dewpoint_c"] > out["temp_c"] + 0.6, "dewpoint_c"] = np.nan
    out.loc[~out["slp_hpa"].between(900, 1085), "slp_hpa"] = np.nan
    out.loc[~out["wind_speed_ms"].between(0, 75), "wind_speed_ms"] = np.nan
    out.loc[~out["wind_dir_deg"].between(0, 360), "wind_dir_deg"] = np.nan
    out.loc[~out["sky_cover_oktas"].between(0, 8), "sky_cover_oktas"] = np.nan
    out.loc[~out["precip_1h_mm"].between(0, 200), "precip_1h_mm"] = np.nan

    out = out.dropna(subset=["ts_utc"])
    out = out.drop_duplicates(subset=["station_id", "ts_utc"], keep="first")
    return out.sort_values("ts_utc").reset_index(drop=True)
