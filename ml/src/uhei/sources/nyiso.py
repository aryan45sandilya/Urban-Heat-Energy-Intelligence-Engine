"""NYISO zonal electricity-load adapter.

The New York Independent System Operator publishes its real-time *metered*
actual load ("Palisades" / `pal` archive) as free monthly ZIP bundles of daily
CSVs, at 5-minute resolution, for each of the 11 New York load zones. These are
settlement-grade measurements of real electricity demand.

Timestamps are local New York wall-clock time with an explicit `Time Zone`
column (EST/EDT), which makes the DST transitions unambiguous — we convert to
UTC using that column rather than guessing.
"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pandas as pd

from ..config import RAW_DIR
from ..utils import download, get_logger, make_session

log = get_logger(__name__)

NYISO_DIR = RAW_DIR / "nyiso"
PAL_URL = "http://mis.nyiso.com/public/csv/pal/{ym}01pal_csv.zip"

_UTC_OFFSET_HOURS = {"EST": 5, "EDT": 4}


def fetch_month(year: int, month: int, session=None) -> Path | None:
    ym = f"{year:04d}{month:02d}"
    dest = NYISO_DIR / f"{ym}pal_csv.zip"
    return download(PAL_URL.format(ym=ym), dest, session=session)


def fetch_years(years: tuple[int, ...]) -> list[Path]:
    session = make_session()
    paths = []
    for year in years:
        for month in range(1, 13):
            path = fetch_month(year, month, session=session)
            if path is not None:
                paths.append(path)
            else:
                log.warning("NYISO archive missing for %04d-%02d", year, month)
    log.info("NYISO: %d monthly archives available", len(paths))
    return paths


def _parse_zip(path: Path) -> pd.DataFrame:
    frames = []
    with zipfile.ZipFile(path) as zf:
        for member in zf.namelist():
            if not member.lower().endswith(".csv"):
                continue
            with zf.open(member) as fh:
                try:
                    raw = pd.read_csv(io.BytesIO(fh.read()))
                except Exception as exc:  # pragma: no cover - corrupt member
                    log.warning("unreadable NYISO member %s (%s)", member, exc)
                    continue
            frames.append(raw)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def load_hourly(paths: list[Path]) -> pd.DataFrame:
    """Parse monthly archives into hourly mean load per zone, indexed in UTC."""
    frames = []
    for path in paths:
        raw = _parse_zip(path)
        if raw.empty:
            continue
        raw.columns = [c.strip() for c in raw.columns]
        required = {"Time Stamp", "Time Zone", "Name", "Load"}
        if not required.issubset(raw.columns):
            log.warning("unexpected NYISO schema in %s: %s", path.name, list(raw.columns))
            continue
        local = pd.to_datetime(raw["Time Stamp"], format="%m/%d/%Y %H:%M:%S", errors="coerce")
        offset = raw["Time Zone"].astype(str).str.strip().map(_UTC_OFFSET_HOURS)
        ts_utc = local + pd.to_timedelta(offset, unit="h")
        frames.append(pd.DataFrame({
            "ts_utc": ts_utc.dt.tz_localize("UTC"),
            "zone": raw["Name"].astype(str).str.strip(),
            "load_mw": pd.to_numeric(raw["Load"], errors="coerce"),
        }))

    if not frames:
        return pd.DataFrame(columns=["ts_utc", "zone", "load_mw"])

    df = pd.concat(frames, ignore_index=True).dropna(subset=["ts_utc", "load_mw"])
    df = df[df["load_mw"] > 0]                       # zero/negative metered load is a gap
    df["ts_utc"] = df["ts_utc"].dt.floor("h")
    hourly = (
        df.groupby(["zone", "ts_utc"], as_index=False)
          .agg(load_mw=("load_mw", "mean"), n_samples=("load_mw", "size"))
    )
    # An hour is only trusted when most of its 5-minute intervals reported.
    hourly = hourly[hourly["n_samples"] >= 8].drop(columns="n_samples")
    log.info("NYISO hourly load: %d zone-hours across %d zones (%s → %s)",
             len(hourly), hourly["zone"].nunique(),
             hourly["ts_utc"].min(), hourly["ts_utc"].max())
    return hourly.sort_values(["zone", "ts_utc"]).reset_index(drop=True)
