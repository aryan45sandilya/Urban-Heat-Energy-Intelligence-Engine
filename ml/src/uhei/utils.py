"""Shared utilities: logging, resilient HTTP, geodesy, solar geometry, comfort indices."""
from __future__ import annotations

import gzip
import logging
import math
import time
from pathlib import Path
from typing import Iterable

import numpy as np
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .config import HTTP_TIMEOUT, USER_AGENT

_LOG_FORMAT = "%(asctime)s │ %(levelname)-7s │ %(name)-22s │ %(message)s"


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if not logging.getLogger().handlers:
        logging.basicConfig(level=logging.INFO, format=_LOG_FORMAT, datefmt="%H:%M:%S")
    return logger


log = get_logger(__name__)


# ── HTTP ─────────────────────────────────────────────────────────────────────
def make_session(retries: int = 4, backoff: float = 1.5) -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    retry = Retry(
        total=retries,
        connect=retries,
        read=retries,
        backoff_factor=backoff,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET", "POST"}),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=16, pool_maxsize=16)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def download(url: str, dest: Path, session: requests.Session | None = None,
             force: bool = False) -> Path | None:
    """Download `url` to `dest`, caching on disk. Returns None on 404."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0 and not force:
        return dest
    sess = session or make_session()
    try:
        resp = sess.get(url, timeout=HTTP_TIMEOUT, stream=True)
    except requests.RequestException as exc:  # pragma: no cover - network
        log.warning("download failed %s (%s)", url, exc)
        return None
    if resp.status_code == 404:
        return None
    if resp.status_code != 200:
        log.warning("download %s → HTTP %s", url, resp.status_code)
        return None
    tmp = dest.with_suffix(dest.suffix + ".part")
    with open(tmp, "wb") as fh:
        for chunk in resp.iter_content(chunk_size=1 << 16):
            if chunk:
                fh.write(chunk)
    tmp.replace(dest)
    return dest


def read_gzip_text(path: Path) -> str:
    with gzip.open(path, "rt", encoding="utf-8", errors="replace") as fh:
        return fh.read()


# ── Geodesy ──────────────────────────────────────────────────────────────────
EARTH_RADIUS_KM = 6371.0088


def haversine_km(lat1, lon1, lat2, lon2):
    """Great-circle distance in km. Accepts scalars or numpy arrays."""
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = np.sin(dlat / 2.0) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2.0) ** 2
    return 2.0 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))


def polygon_area_m2(coords: Iterable[tuple[float, float]]) -> float:
    """Planar (equirectangular) shoelace area of a lat/lon ring, in m².

    Accurate to well under 1% for the ≤3 km neighbourhoods used here, which is
    far finer than the resolution of the underlying OSM tagging.
    """
    pts = list(coords)
    if len(pts) < 3:
        return 0.0
    lat0 = math.radians(sum(p[0] for p in pts) / len(pts))
    mx = EARTH_RADIUS_KM * 1000.0 * math.cos(lat0)
    my = EARTH_RADIUS_KM * 1000.0
    xs = [math.radians(p[1]) * mx for p in pts]
    ys = [math.radians(p[0]) * my for p in pts]
    area = 0.0
    for i in range(len(pts)):
        j = (i + 1) % len(pts)
        area += xs[i] * ys[j] - xs[j] * ys[i]
    return abs(area) / 2.0


def polyline_length_m(coords: Iterable[tuple[float, float]]) -> float:
    pts = list(coords)
    if len(pts) < 2:
        return 0.0
    total = 0.0
    for (a_lat, a_lon), (b_lat, b_lon) in zip(pts, pts[1:]):
        total += float(haversine_km(a_lat, a_lon, b_lat, b_lon)) * 1000.0
    return total


# ── Solar geometry (NOAA solar position algorithm) ───────────────────────────
def solar_elevation_deg(dt_utc, lat, lon):
    """Solar elevation angle in degrees.

    Deterministic astronomy — not modelled, not estimated. `dt_utc` may be a
    pandas DatetimeIndex/Series (tz-aware UTC) and lat/lon arrays of equal length.
    """
    import pandas as pd

    idx = pd.DatetimeIndex(pd.to_datetime(dt_utc, utc=True))
    day_of_year = idx.dayofyear.to_numpy(dtype=float)
    hour_utc = (idx.hour.to_numpy(dtype=float)
                + idx.minute.to_numpy(dtype=float) / 60.0)

    gamma = 2.0 * np.pi / 365.0 * (day_of_year - 1.0 + (hour_utc - 12.0) / 24.0)
    # Equation of time (minutes) and solar declination (radians) — Spencer (1971)
    eqtime = 229.18 * (
        0.000075
        + 0.001868 * np.cos(gamma)
        - 0.032077 * np.sin(gamma)
        - 0.014615 * np.cos(2 * gamma)
        - 0.040849 * np.sin(2 * gamma)
    )
    decl = (
        0.006918
        - 0.399912 * np.cos(gamma)
        + 0.070257 * np.sin(gamma)
        - 0.006758 * np.cos(2 * gamma)
        + 0.000907 * np.sin(2 * gamma)
        - 0.002697 * np.cos(3 * gamma)
        + 0.00148 * np.sin(3 * gamma)
    )
    lon = np.asarray(lon, dtype=float)
    lat_rad = np.radians(np.asarray(lat, dtype=float))
    time_offset = eqtime + 4.0 * lon
    true_solar_time = (hour_utc * 60.0 + time_offset) % 1440.0
    hour_angle = np.radians(true_solar_time / 4.0 - 180.0)
    cos_zenith = (np.sin(lat_rad) * np.sin(decl)
                  + np.cos(lat_rad) * np.cos(decl) * np.cos(hour_angle))
    return np.degrees(np.arcsin(np.clip(cos_zenith, -1.0, 1.0)))


def clear_sky_index(elev_deg):
    """Normalised extraterrestrial irradiance proxy (0..1): sin of solar elevation."""
    return np.clip(np.sin(np.radians(np.asarray(elev_deg, dtype=float))), 0.0, None)


# ── Humidity & heat indices ──────────────────────────────────────────────────
def relative_humidity_pct(temp_c, dewpoint_c):
    """Magnus-Tetens relative humidity from temperature and dew point."""
    t = np.asarray(temp_c, dtype=float)
    td = np.asarray(dewpoint_c, dtype=float)
    a, b = 17.625, 243.04
    rh = 100.0 * np.exp(a * td / (b + td) - a * t / (b + t))
    return np.clip(rh, 1.0, 100.0)


def dewpoint_from_rh(temp_c, rh_pct):
    """Inverse of `relative_humidity_pct` — dew point (°C) from temperature and RH."""
    t = np.asarray(temp_c, dtype=float)
    rh = np.clip(np.asarray(rh_pct, dtype=float), 1.0, 100.0)
    a, b = 17.625, 243.04
    gamma = np.log(rh / 100.0) + a * t / (b + t)
    return (b * gamma) / (a - gamma)


def heat_index_c(temp_c, rh_pct):
    """NWS heat index (apparent temperature), in °C.

    Implements the Rothfusz regression with the standard low-humidity and
    high-humidity adjustments; below 80 °F the simple Steadman form is used.
    """
    t_f = np.asarray(temp_c, dtype=float) * 9.0 / 5.0 + 32.0
    rh = np.asarray(rh_pct, dtype=float)

    simple = 0.5 * (t_f + 61.0 + ((t_f - 68.0) * 1.2) + (rh * 0.094))
    hi_f = np.where(((simple + t_f) / 2.0) < 80.0, simple, np.nan)

    full = (
        -42.379
        + 2.04901523 * t_f
        + 10.14333127 * rh
        - 0.22475541 * t_f * rh
        - 0.00683783 * t_f * t_f
        - 0.05481717 * rh * rh
        + 0.00122874 * t_f * t_f * rh
        + 0.00085282 * t_f * rh * rh
        - 0.00000199 * t_f * t_f * rh * rh
    )
    adj_dry = ((13.0 - rh) / 4.0) * np.sqrt(np.clip(17.0 - np.abs(t_f - 95.0), 0.0, None) / 17.0)
    full = np.where((rh < 13.0) & (t_f > 80.0) & (t_f < 112.0), full - adj_dry, full)
    adj_wet = ((rh - 85.0) / 10.0) * ((87.0 - t_f) / 5.0)
    full = np.where((rh > 85.0) & (t_f > 80.0) & (t_f < 87.0), full + adj_wet, full)

    hi_f = np.where(np.isnan(hi_f), full, hi_f)
    return (hi_f - 32.0) * 5.0 / 9.0


HEAT_RISK_BANDS = (
    # (upper bound of heat index in °C, label, NWS-aligned description)
    (26.7, "none", "No elevated heat stress expected."),
    (32.2, "caution", "Fatigue possible with prolonged exposure or activity."),
    (39.4, "extreme-caution", "Heat cramps and heat exhaustion possible."),
    (51.0, "danger", "Heat cramps and heat exhaustion likely; heat stroke possible."),
    (999.0, "extreme-danger", "Heat stroke highly likely."),
)


def heat_risk_band(heat_index_value: float) -> tuple[str, str]:
    """Map a heat index (°C) onto the NWS heat-stress category.

    This is an *interpretation* of the model's continuous prediction using a
    published threshold table — it is not itself a model output.
    """
    for upper, label, description in HEAT_RISK_BANDS:
        if heat_index_value < upper:
            return label, description
    return HEAT_RISK_BANDS[-1][1], HEAT_RISK_BANDS[-1][2]


class Timer:
    """Context manager measuring wall-clock seconds."""

    def __enter__(self):
        self._t0 = time.perf_counter()
        return self

    def __exit__(self, *exc):
        self.seconds = time.perf_counter() - self._t0
        return False
