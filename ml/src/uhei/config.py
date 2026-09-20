"""Central configuration: paths, study domain, and pipeline constants.

Every constant that governs *what data is pulled* and *how the study is framed*
lives here so the pipeline is reproducible from a single place.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# ── Paths ────────────────────────────────────────────────────────────────────
ML_DIR = Path(__file__).resolve().parents[2]          # <root>/ml
PROJECT_ROOT = ML_DIR.parent                           # <root>
DATA_DIR = ML_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
INTERIM_DIR = DATA_DIR / "interim"
PROCESSED_DIR = DATA_DIR / "processed"
MODELS_DIR = ML_DIR / "models"
REPORTS_DIR = ML_DIR / "reports"
FIGURES_DIR = REPORTS_DIR / "figures"

for _d in (RAW_DIR, INTERIM_DIR, PROCESSED_DIR, MODELS_DIR, REPORTS_DIR, FIGURES_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# ── Study period ─────────────────────────────────────────────────────────────
# Four-plus years: 2022 through September 2026. Chronological split below.
YEARS: tuple[int, ...] = (2022, 2023, 2024, 2025, 2026)

# Chronological (time-ordered) split — no random shuffling anywhere.
# ISD-Lite is a quality-controlled product that lags real-time by ~3-6 months,
# so the 2026 files don't exist yet even though YEARS includes 2026.
# Usable data runs through approximately August 2025. Split to put summer 2025
# in the test window — the most recent complete summer we can evaluate against.
TRAIN_END = "2024-06-30"      # train: 2022-01-01 .. 2024-06-30  (2.5 yrs, 2 full summers)
VALID_END = "2024-12-31"      # valid: 2024-07-01 .. 2024-12-31  (incl. summer 2024)
                              # test : 2025-01-01 .. ~2025-08-28 (incl. summer 2025)
# NOTE: validation/test windows deliberately contain a full summer so that the
# high-heat regime — the regime the product is about — is actually evaluated.

# ── Study domain ─────────────────────────────────────────────────────────────
# US Northeast / Mid-Atlantic corridor. Restricting to one broad climate region
# keeps the urban-vs-rural comparison meaningful (similar synoptic forcing,
# similar continental climate) instead of mixing deserts with coastal temperate.
STATES: tuple[str, ...] = ("NY", "NJ", "CT", "MA", "PA", "RI", "DE", "MD", "DC", "NH", "VT")

DOMAIN_BBOX = dict(lat_min=38.5, lat_max=45.2, lon_min=-80.6, lon_max=-69.6)

# ── Urban-heat-island construction parameters ────────────────────────────────
MORPH_RADII_M: tuple[int, ...] = (1000, 3000)   # local + neighbourhood context
REF_SEARCH_RADIUS_KM = 150.0     # max distance for a rural reference station
REF_MIN_DISTANCE_KM = 15.0       # min distance (a reference must not be "the same place")
N_REFERENCE_STATIONS = 3         # rural references averaged per urban station
LAPSE_RATE_C_PER_M = 0.0065      # standard environmental lapse rate for elevation correction
MAX_ELEV_DIFF_M = 300.0          # reject reference pairs with larger elevation contrast

# Urban / rural classification thresholds on OSM-derived building plan fraction
# at the 3 km radius. Set from the empirical distribution at build time; these
# are the fallbacks used when the distribution is degenerate.
URBAN_BPF3K_MIN = 0.04
RURAL_BPF3K_MAX = 0.012

# Quality gates
MIN_HOURLY_COVERAGE = 0.70       # fraction of hours a station must report
UHI_PLAUSIBLE_RANGE = (-8.0, 12.0)   # °C; anything outside is a data artefact

# ── NYISO energy domain ──────────────────────────────────────────────────────
# The 11 NYISO load zones. Coordinates are the zone's principal load centre and
# are used only to attach weather stations to a zone.
NYISO_ZONES: dict[str, dict] = {
    "CAPITL": {"name": "Capital", "lat": 42.6526, "lon": -73.7562},
    "CENTRL": {"name": "Central", "lat": 43.0481, "lon": -76.1474},
    "DUNWOD": {"name": "Dunwoodie", "lat": 40.9312, "lon": -73.8988},
    "GENESE": {"name": "Genesee", "lat": 43.1566, "lon": -77.6088},
    "HUD VL": {"name": "Hudson Valley", "lat": 41.7004, "lon": -73.9210},
    "LONGIL": {"name": "Long Island", "lat": 40.7891, "lon": -73.1350},
    "MHK VL": {"name": "Mohawk Valley", "lat": 43.1009, "lon": -75.2327},
    "MILLWD": {"name": "Millwood", "lat": 41.2042, "lon": -73.8207},
    "N.Y.C.": {"name": "New York City", "lat": 40.7128, "lon": -74.0060},
    "NORTH":  {"name": "North", "lat": 44.6995, "lon": -73.4529},
    "WEST":   {"name": "West", "lat": 42.8864, "lon": -78.8784},
}
ZONE_STATION_RADIUS_KM = 90.0    # stations within this radius represent a zone

# ── Modelling ────────────────────────────────────────────────────────────────
RANDOM_STATE = 42
N_JOBS = 2
MAX_TRAIN_ROWS = 60_000          # cap for tractable tuning on commodity hardware
CV_SPLITS = 3                    # TimeSeriesSplit folds on the training window

# ── Network / polite scraping ────────────────────────────────────────────────
USER_AGENT = os.environ.get(
    "UHEI_USER_AGENT",
    "UHEI/1.0 (Urban Heat & Energy Intelligence Engine; research/portfolio project)",
)
HTTP_TIMEOUT = 120
OVERPASS_ENDPOINTS = (
    # Ordered by measured throughput. The main overpass-api.de instance rate-limits
    # bulk use aggressively (HTTP 429), so mirrors that publish a higher slot
    # allowance are preferred and the load is spread evenly across them.
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
)
OVERPASS_SLEEP_S = 1.0


@dataclass(frozen=True)
class DataSource:
    key: str
    name: str
    url: str
    license: str
    description: str


DATA_SOURCES: tuple[DataSource, ...] = (
    DataSource(
        key="noaa_isd_lite",
        name="NOAA NCEI Integrated Surface Database (ISD-Lite)",
        url="https://www.ncei.noaa.gov/pub/data/noaa/isd-lite/",
        license="U.S. Government work — public domain (NOAA open data)",
        description=(
            "Quality-controlled hourly surface weather observations from physical "
            "stations: air temperature, dew point, sea-level pressure, wind, sky "
            "cover and precipitation."
        ),
    ),
    DataSource(
        key="noaa_isd_history",
        name="NOAA NCEI ISD Station History",
        url="https://www.ncei.noaa.gov/pub/data/noaa/isd-history.csv",
        license="U.S. Government work — public domain (NOAA open data)",
        description="Station inventory: identifiers, coordinates, elevation, period of record.",
    ),
    DataSource(
        key="openstreetmap",
        name="OpenStreetMap via Overpass API",
        url="https://overpass-api.de/",
        license="ODbL 1.0 — © OpenStreetMap contributors",
        description=(
            "Building footprints, road network, green space and water bodies used to "
            "derive urban-morphology features around each station."
        ),
    ),
    DataSource(
        key="nyiso_load",
        name="NYISO Real-Time Actual Load (Palisades archive)",
        url="http://mis.nyiso.com/public/",
        license="NYISO public market information — free public use",
        description="Real-time metered electricity load for the 11 NYISO load zones.",
    ),
    DataSource(
        key="open_meteo_elevation",
        name="Open-Meteo Elevation API (Copernicus DEM GLO-90)",
        url="https://open-meteo.com/en/docs/elevation-api",
        license="CC-BY 4.0 (Open-Meteo) / Copernicus DEM",
        description="Digital-elevation lookup used to sanity-check station elevations.",
    ),
)
