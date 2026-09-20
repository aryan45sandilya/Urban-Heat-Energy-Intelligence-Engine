"""OpenStreetMap urban-morphology adapter (Overpass API).

For each weather station we measure the *real* physical fabric around it:
building plan area, road length, vegetated area and water area, from OSM ways.
Nothing here is estimated or assumed — every number is derived from tagged
geometry that exists in the OSM database at query time.

Two probes per station:
  • 1 km radius, full geometry  → local-scale areas and lengths
  • 3 km radius, feature counts → neighbourhood-scale built-up context

Known limitation (documented in the model card): only OSM *ways* are measured.
Multipolygon relations — a minority of buildings and some very large parks —
are not decomposed, so green fraction is a slight under-estimate in a few places.
"""
from __future__ import annotations

import json
import math
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Lock

import numpy as np
import pandas as pd
from matplotlib.path import Path as MplPath

from ..config import OVERPASS_ENDPOINTS, OVERPASS_SLEEP_S, RAW_DIR
from ..utils import get_logger, make_session

log = get_logger(__name__)

OSM_DIR = RAW_DIR / "osm"

GREEN_LANDUSE = {
    "forest", "grass", "meadow", "orchard", "village_green", "recreation_ground",
    "allotments", "farmland", "greenfield", "cemetery", "vineyard", "farmyard",
}
GREEN_LEISURE = {"park", "garden", "golf_course", "nature_reserve", "pitch", "common"}
GREEN_NATURAL = {"wood", "scrub", "grassland", "heath", "wetland", "tree_row"}
WATER_NATURAL = {"water", "bay", "strait", "wetland"}
WATER_LANDUSE = {"reservoir", "basin"}

# Roads whose surface is a meaningful impervious/heat-storage contributor.
ROAD_CLASSES = {
    "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified",
    "residential", "motorway_link", "trunk_link", "primary_link",
    "secondary_link", "tertiary_link", "living_street", "service",
}

_GEOM_QUERY = """[out:json][timeout:240];
(
  way["building"](around:{r},{lat},{lon});
  way["highway"](around:{r},{lat},{lon});
  way["landuse"](around:{r},{lat},{lon});
  way["leisure"](around:{r},{lat},{lon});
  way["natural"](around:{r},{lat},{lon});
  way["waterway"="riverbank"](around:{r},{lat},{lon});
);
out geom;"""

_COUNT_QUERY = """[out:json][timeout:240];
way["building"](around:{r},{lat},{lon});
out count;
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service)$"](around:{r},{lat},{lon});
out count;
(
  way["leisure"~"^(park|garden|golf_course|nature_reserve)$"](around:{r},{lat},{lon});
  way["landuse"~"^(forest|grass|meadow|farmland|recreation_ground|cemetery)$"](around:{r},{lat},{lon});
  way["natural"~"^(wood|scrub|grassland|wetland)$"](around:{r},{lat},{lon});
);
out count;
(
  way["natural"="water"](around:{r},{lat},{lon});
  way["waterway"="riverbank"](around:{r},{lat},{lon});
);
out count;"""


def _cache_path(station_id: str, kind: str, radius: int) -> Path:
    return OSM_DIR / f"{station_id}_{kind}_{radius}.json"


def _overpass(query: str, session, preferred: int = 0) -> dict | None:
    last_err = None
    # Try the worker's assigned endpoint first, then fall back to the others.
    order = list(OVERPASS_ENDPOINTS[preferred:]) + list(OVERPASS_ENDPOINTS[:preferred])
    # Two passes over the mirrors: a mirror that is busy right now is more
    # cheaply skipped than waited on, so back-off is short and rotation is fast.
    for attempt in range(2):
        for endpoint in order:
            try:
                resp = session.post(endpoint, data={"data": query}, timeout=(15, 240))
            except Exception as exc:  # pragma: no cover - network
                last_err = exc
                continue
            if resp.status_code == 200:
                try:
                    return resp.json()
                except json.JSONDecodeError as exc:
                    last_err = exc
                    continue
            last_err = f"HTTP {resp.status_code} @ {endpoint.split('/')[2]}"
            if resp.status_code in (429, 503, 504):
                time.sleep(2.0)
        time.sleep(5.0 * (attempt + 1))
    log.warning("Overpass query failed (%s)", last_err)
    return None


def _fetch_cached(station_id: str, lat: float, lon: float, radius: int,
                  kind: str, session, preferred: int = 0) -> dict | None:
    path = _cache_path(station_id, kind, radius)
    if path.exists() and path.stat().st_size > 0:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            path.unlink(missing_ok=True)
    template = _GEOM_QUERY if kind == "geom" else _COUNT_QUERY
    payload = _overpass(template.format(r=radius, lat=lat, lon=lon), session, preferred)
    if payload is None:
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")
    time.sleep(OVERPASS_SLEEP_S)
    return payload


def _classify_way(tags: dict) -> str | None:
    if "building" in tags and tags["building"] != "no":
        return "building"
    if tags.get("highway") in ROAD_CLASSES:
        return "road"
    if (tags.get("natural") in WATER_NATURAL and tags.get("natural") != "wetland") \
            or tags.get("landuse") in WATER_LANDUSE \
            or tags.get("waterway") == "riverbank" \
            or tags.get("water") is not None:
        return "water"
    if (tags.get("landuse") in GREEN_LANDUSE
            or tags.get("leisure") in GREEN_LEISURE
            or tags.get("natural") in GREEN_NATURAL):
        return "green"
    return None


def _sample_lattice(radius_m: int, spacing_m: float = 20.0) -> np.ndarray:
    """Regular lattice of sample points covering the disc, in local metres."""
    steps = np.arange(-radius_m, radius_m + spacing_m, spacing_m)
    gx, gy = np.meshgrid(steps, steps)
    points = np.column_stack([gx.ravel(), gy.ravel()])
    inside = points[:, 0] ** 2 + points[:, 1] ** 2 <= radius_m ** 2
    return points[inside]


def _to_local_metres(coords: np.ndarray, lat0: float, lon0: float) -> np.ndarray:
    """Equirectangular projection about the station — exact enough at ≤3 km."""
    scale_x = 111_320.0 * math.cos(math.radians(lat0))
    scale_y = 110_540.0
    return np.column_stack([(coords[:, 1] - lon0) * scale_x,
                            (coords[:, 0] - lat0) * scale_y])


def _summarise_geometry(payload: dict, radius_m: int, lat: float, lon: float,
                        spacing_m: float = 20.0) -> dict:
    """Measure surface cover by *areal sampling* inside the disc.

    Summing raw polygon areas would be wrong in two ways: a park or lake whose
    polygon extends well beyond the sampling radius would contribute its entire
    area (Central Park alone would saturate a 1 km disc), and overlapping
    polygons would be double-counted. Sampling a 20 m lattice and asking which
    points fall inside which class fixes both: every point counts once, and only
    the part of a feature that is actually within the radius is measured.
    """
    lattice = _sample_lattice(radius_m, spacing_m)
    n_points = len(lattice)
    cover = {"building": np.zeros(n_points, dtype=bool),
             "green": np.zeros(n_points, dtype=bool),
             "water": np.zeros(n_points, dtype=bool)}

    building_count = 0
    road_length = 0.0

    for el in payload.get("elements", []):
        if el.get("type") != "way":
            continue
        tags = el.get("tags") or {}
        geom = el.get("geometry") or []
        if len(geom) < 2:
            continue
        kind = _classify_way(tags)
        if kind is None:
            continue

        coords = np.array([[g["lat"], g["lon"]] for g in geom], dtype=float)
        local = _to_local_metres(coords, lat, lon)

        if kind == "road":
            # Clip to the disc segment-by-segment: a segment fully inside counts
            # in full, one that straddles the boundary counts for half.
            dist = np.hypot(local[:, 0], local[:, 1])
            inside = dist <= radius_m
            seg_len = np.hypot(np.diff(local[:, 0]), np.diff(local[:, 1]))
            weight = (inside[:-1].astype(float) + inside[1:].astype(float)) / 2.0
            road_length += float(np.sum(seg_len * weight))
            continue

        if len(local) < 3:
            continue
        if kind == "building":
            building_count += 1

        # Bounding-box prefilter keeps the point-in-polygon test cheap: most
        # buildings cover only a handful of lattice points.
        x0, y0 = local[:, 0].min(), local[:, 1].min()
        x1, y1 = local[:, 0].max(), local[:, 1].max()
        candidates = np.where(
            (lattice[:, 0] >= x0) & (lattice[:, 0] <= x1)
            & (lattice[:, 1] >= y0) & (lattice[:, 1] <= y1)
        )[0]
        if candidates.size == 0:
            continue
        hit = MplPath(local).contains_points(lattice[candidates])
        if hit.any():
            cover[kind][candidates[hit]] = True

    area_disc_km2 = math.pi * radius_m ** 2 / 1e6
    # Where a polygon is tagged both built and vegetated, the building wins:
    # a roof is not a green surface.
    cover["green"] &= ~cover["building"]
    cover["water"] &= ~cover["building"]

    return {
        "building_plan_fraction": float(cover["building"].mean()),
        "building_count_km2": building_count / area_disc_km2,
        "road_length_km_km2": (road_length / 1000.0) / area_disc_km2,
        "green_fraction": float(cover["green"].mean()),
        "water_fraction": float(cover["water"].mean()),
        "sample_points": int(n_points),
    }


def _summarise_counts(payload: dict, radius_m: int) -> dict:
    counts = [el for el in payload.get("elements", []) if el.get("type") == "count"]
    if len(counts) < 4:
        return {}
    area_km2 = math.pi * radius_m ** 2 / 1e6

    def total(i: int) -> float:
        return float(counts[i].get("tags", {}).get("total", 0))

    return {
        "building_count_km2": total(0) / area_km2,
        "road_count_km2": total(1) / area_km2,
        "green_count_km2": total(2) / area_km2,
        "water_count_km2": total(3) / area_km2,
    }


def station_morphology(station_id: str, lat: float, lon: float,
                       radii: tuple[int, ...], session=None, preferred: int = 0) -> dict | None:
    """Return morphology metrics for one station, or None if Overpass failed."""
    sess = session or make_session()
    out: dict = {"station_id": station_id}

    local_r = min(radii)
    geom = _fetch_cached(station_id, lat, lon, local_r, "geom", sess, preferred)
    if geom is None:
        return None
    summary = _summarise_geometry(geom, local_r, lat, lon)
    out["morphology_sample_points"] = summary.pop("sample_points")
    for key, value in summary.items():
        out[f"{key}_{local_r // 1000}km"] = value

    for radius in radii:
        if radius == local_r:
            continue
        counts = _fetch_cached(station_id, lat, lon, radius, "count", sess, preferred)
        if counts is None:
            return None
        summary = _summarise_counts(counts, radius)
        if not summary:
            return None
        for key, value in summary.items():
            out[f"{key}_{radius // 1000}km"] = value
    return out


def build_morphology_table(stations: pd.DataFrame, radii: tuple[int, ...],
                           workers: int = 4) -> pd.DataFrame:
    """Fetch morphology for every station; stations Overpass cannot serve are dropped.

    Work is spread across the configured Overpass mirrors — each worker is pinned
    to one mirror so no single public endpoint sees more concurrency than it
    publishes as its slot limit.
    """
    n_endpoints = max(len(OVERPASS_ENDPOINTS), 1)
    # urllib3-level retries are disabled here: mirror rotation in `_overpass` is
    # the retry strategy, and a stuck socket should surrender fast.
    sessions = [make_session(retries=0) for _ in range(n_endpoints)]
    total = len(stations)
    done = Counter()
    lock = Lock()
    rows: list[dict] = []

    def _job(item):
        index, row = item
        slot = index % n_endpoints
        result = station_morphology(row.station_id, row.lat, row.lon, radii,
                                    sessions[slot], preferred=slot)
        with lock:
            done["n"] += 1
            if result is not None:
                rows.append(result)
            if done["n"] % 10 == 0 or done["n"] == total:
                log.info("  OSM morphology %d/%d (%d resolved)", done["n"], total, len(rows))
        return result

    items = list(enumerate(stations.itertuples(index=False)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(_job, items))

    df = pd.DataFrame(rows)
    log.info("OSM morphology resolved for %d/%d stations", len(df), total)
    return df
