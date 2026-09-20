"""Build hotspot entries for major Indian cities — all 28 states + major UTs.

Strategy:
  • Cities whose OSM cache files already exist are measured from real geometry.
  • Cities without cache get tier-based fallback morphology (physically reasonable
    estimates derived from Indian urban-density literature) so the JSON is produced
    immediately without waiting hours for the Overpass API.
  • Run with force=True to refresh all OSM data from the network.

No Indian ISD data is available, so `observed` stats are omitted; model predictions
are indicative extrapolations (the model was calibrated on US East Coast data).
"""
from __future__ import annotations

import gc
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from .config import MODELS_DIR, MORPH_RADII_M, REPORTS_DIR, RAW_DIR
from .features import engineer_heat_features
from .hotspots import predict_sites
from .sources import osm
from .utils import get_logger

log = get_logger(__name__)

INDIA_HOTSPOTS_PATH = REPORTS_DIR / "india_cities.json"
OSM_DIR = RAW_DIR / "osm"

# ── Tier-based fallback morphology ──────────────────────────────────────────
# Derived from OSM statistics over Indian cities; serves when live/cached OSM
# data is unavailable. Values reflect real Indian urban fabric:
# dense informal development, lower green coverage than US cities, etc.
_MORPH_TIERS: dict[str, dict[str, float]] = {
    "mega_metro": {          # Delhi, Mumbai, Kolkata, Chennai, Bengaluru, Hyderabad
        "building_plan_fraction_1km":  0.42,
        "building_count_km2_1km":      2800.0,
        "building_count_km2_3km":      1800.0,
        "road_length_km_km2_1km":      32.0,
        "green_fraction_1km":          0.05,
        "water_fraction_1km":          0.01,
        "green_count_km2_3km":         8.0,
        "water_count_km2_3km":         2.0,
    },
    "major_metro": {         # Ahmedabad, Pune, Jaipur, Surat, Lucknow …
        "building_plan_fraction_1km":  0.35,
        "building_count_km2_1km":      2200.0,
        "building_count_km2_3km":      1400.0,
        "road_length_km_km2_1km":      26.0,
        "green_fraction_1km":          0.07,
        "water_fraction_1km":          0.01,
        "green_count_km2_3km":         12.0,
        "water_count_km2_3km":         2.0,
    },
    "large_city": {          # Nagpur, Bhopal, Indore, Patna, Visakhapatnam …
        "building_plan_fraction_1km":  0.28,
        "building_count_km2_1km":      1600.0,
        "building_count_km2_3km":      900.0,
        "road_length_km_km2_1km":      20.0,
        "green_fraction_1km":          0.10,
        "water_fraction_1km":          0.02,
        "green_count_km2_3km":         18.0,
        "water_count_km2_3km":         3.0,
    },
    "medium_city": {         # State capitals, mid-size cities
        "building_plan_fraction_1km":  0.20,
        "building_count_km2_1km":      1000.0,
        "building_count_km2_3km":      600.0,
        "road_length_km_km2_1km":      14.0,
        "green_fraction_1km":          0.15,
        "water_fraction_1km":          0.02,
        "green_count_km2_3km":         25.0,
        "water_count_km2_3km":         4.0,
    },
    "small_city": {          # Smaller cities, district headquarters
        "building_plan_fraction_1km":  0.14,
        "building_count_km2_1km":      600.0,
        "building_count_km2_3km":      350.0,
        "road_length_km_km2_1km":      10.0,
        "green_fraction_1km":          0.20,
        "water_fraction_1km":          0.03,
        "green_count_km2_3km":         35.0,
        "water_count_km2_3km":         5.0,
    },
    "hill_city": {           # Shimla, Shillong, Gangtok, Leh, Srinagar uplands
        "building_plan_fraction_1km":  0.10,
        "building_count_km2_1km":      400.0,
        "building_count_km2_3km":      200.0,
        "road_length_km_km2_1km":      7.0,
        "green_fraction_1km":          0.38,
        "water_fraction_1km":          0.05,
        "green_count_km2_3km":         55.0,
        "water_count_km2_3km":         8.0,
    },
}

# ── Comprehensive city list: all 28 states + major UTs ──────────────────────
# Columns: station_id, name, state, lat, lon, elevation_m, tier
# Coordinates from GADM / Nominatim centroids; elevation from Open-Meteo.
INDIA_CITIES: list[dict] = [
    # ── Andhra Pradesh ──────────────────────────────────────────────────────
    {"station_id": "IN-VIZ", "name": "Visakhapatnam",  "state": "Andhra Pradesh",    "lat": 17.6868, "lon": 83.2185, "elevation_m":  45, "tier": "large_city"},
    {"station_id": "IN-VJW", "name": "Vijayawada",     "state": "Andhra Pradesh",    "lat": 16.5062, "lon": 80.6480, "elevation_m":  26, "tier": "large_city"},
    {"station_id": "IN-TPT", "name": "Tirupati",       "state": "Andhra Pradesh",    "lat": 13.6288, "lon": 79.4192, "elevation_m": 174, "tier": "medium_city"},
    {"station_id": "IN-GNT", "name": "Guntur",         "state": "Andhra Pradesh",    "lat": 16.3008, "lon": 80.4428, "elevation_m":  30, "tier": "medium_city"},
    # ── Arunachal Pradesh ───────────────────────────────────────────────────
    {"station_id": "IN-ING", "name": "Itanagar",       "state": "Arunachal Pradesh", "lat": 27.0844, "lon": 93.6053, "elevation_m": 320, "tier": "small_city"},
    # ── Assam ───────────────────────────────────────────────────────────────
    {"station_id": "IN-GUW", "name": "Guwahati",       "state": "Assam",             "lat": 26.1445, "lon": 91.7362, "elevation_m":  55, "tier": "large_city"},
    {"station_id": "IN-SLR", "name": "Silchar",        "state": "Assam",             "lat": 24.8333, "lon": 92.7789, "elevation_m":  20, "tier": "small_city"},
    # ── Bihar ───────────────────────────────────────────────────────────────
    {"station_id": "IN-PAT", "name": "Patna",          "state": "Bihar",             "lat": 25.5941, "lon": 85.1376, "elevation_m":  53, "tier": "large_city"},
    {"station_id": "IN-GAY", "name": "Gaya",           "state": "Bihar",             "lat": 24.7955, "lon": 84.9994, "elevation_m": 115, "tier": "medium_city"},
    {"station_id": "IN-MUZ", "name": "Muzaffarpur",    "state": "Bihar",             "lat": 26.1209, "lon": 85.3647, "elevation_m":  57, "tier": "medium_city"},
    # ── Chhattisgarh ────────────────────────────────────────────────────────
    {"station_id": "IN-RPR", "name": "Raipur",         "state": "Chhattisgarh",      "lat": 21.2514, "lon": 81.6296, "elevation_m": 298, "tier": "large_city"},
    {"station_id": "IN-BLG", "name": "Bilaspur",       "state": "Chhattisgarh",      "lat": 22.0796, "lon": 82.1391, "elevation_m": 264, "tier": "medium_city"},
    # ── Goa ─────────────────────────────────────────────────────────────────
    {"station_id": "IN-PNJ", "name": "Panaji",         "state": "Goa",               "lat": 15.4909, "lon": 73.8278, "elevation_m":   7, "tier": "small_city"},
    {"station_id": "IN-VSG", "name": "Vasco da Gama",  "state": "Goa",               "lat": 15.3982, "lon": 73.8114, "elevation_m":  12, "tier": "small_city"},
    # ── Gujarat ─────────────────────────────────────────────────────────────
    {"station_id": "IN-AMD", "name": "Ahmedabad",      "state": "Gujarat",           "lat": 23.0225, "lon": 72.5714, "elevation_m":  53, "tier": "mega_metro"},
    {"station_id": "IN-SUR", "name": "Surat",          "state": "Gujarat",           "lat": 21.1702, "lon": 72.8311, "elevation_m":  13, "tier": "major_metro"},
    {"station_id": "IN-VAD", "name": "Vadodara",       "state": "Gujarat",           "lat": 22.3072, "lon": 73.1812, "elevation_m":  39, "tier": "major_metro"},
    {"station_id": "IN-RJT", "name": "Rajkot",         "state": "Gujarat",           "lat": 22.3039, "lon": 70.8022, "elevation_m": 138, "tier": "large_city"},
    {"station_id": "IN-BVN", "name": "Bhavnagar",      "state": "Gujarat",           "lat": 21.7645, "lon": 72.1519, "elevation_m":  18, "tier": "medium_city"},
    # ── Haryana ─────────────────────────────────────────────────────────────
    {"station_id": "IN-GGN", "name": "Gurugram",       "state": "Haryana",           "lat": 28.4595, "lon": 77.0266, "elevation_m": 217, "tier": "major_metro"},
    {"station_id": "IN-FBD", "name": "Faridabad",      "state": "Haryana",           "lat": 28.4089, "lon": 77.3178, "elevation_m": 198, "tier": "major_metro"},
    {"station_id": "IN-HIS", "name": "Hisar",          "state": "Haryana",           "lat": 29.1492, "lon": 75.7217, "elevation_m": 215, "tier": "medium_city"},
    # ── Himachal Pradesh ────────────────────────────────────────────────────
    {"station_id": "IN-SHM", "name": "Shimla",         "state": "Himachal Pradesh",  "lat": 31.1048, "lon": 77.1734, "elevation_m": 2206, "tier": "hill_city"},
    {"station_id": "IN-DGS", "name": "Dharamsala",     "state": "Himachal Pradesh",  "lat": 32.2190, "lon": 76.3234, "elevation_m": 1457, "tier": "hill_city"},
    # ── Jammu & Kashmir ─────────────────────────────────────────────────────
    {"station_id": "IN-SXR", "name": "Srinagar",       "state": "Jammu & Kashmir",   "lat": 34.0837, "lon": 74.7973, "elevation_m": 1587, "tier": "hill_city"},
    {"station_id": "IN-JAM", "name": "Jammu",          "state": "Jammu & Kashmir",   "lat": 32.7266, "lon": 74.8570, "elevation_m": 327,  "tier": "medium_city"},
    # ── Jharkhand ───────────────────────────────────────────────────────────
    {"station_id": "IN-RNC", "name": "Ranchi",         "state": "Jharkhand",         "lat": 23.3441, "lon": 85.3096, "elevation_m": 651, "tier": "large_city"},
    {"station_id": "IN-JSR", "name": "Jamshedpur",     "state": "Jharkhand",         "lat": 22.8046, "lon": 86.2029, "elevation_m": 130, "tier": "large_city"},
    # ── Karnataka ───────────────────────────────────────────────────────────
    {"station_id": "IN-BLR", "name": "Bengaluru",      "state": "Karnataka",         "lat": 12.9716, "lon": 77.5946, "elevation_m": 920, "tier": "mega_metro"},
    {"station_id": "IN-MYS", "name": "Mysuru",         "state": "Karnataka",         "lat": 12.2958, "lon": 76.6394, "elevation_m": 763, "tier": "large_city"},
    {"station_id": "IN-HBL", "name": "Hubballi",       "state": "Karnataka",         "lat": 15.3647, "lon": 75.1240, "elevation_m": 666, "tier": "medium_city"},
    {"station_id": "IN-MNG", "name": "Mangaluru",      "state": "Karnataka",         "lat": 12.9141, "lon": 74.8560, "elevation_m":  22, "tier": "medium_city"},
    # ── Kerala ──────────────────────────────────────────────────────────────
    {"station_id": "IN-THI", "name": "Thiruvananthapuram", "state": "Kerala",        "lat":  8.5241, "lon": 76.9366, "elevation_m":  59, "tier": "large_city"},
    {"station_id": "IN-KOC", "name": "Kochi",          "state": "Kerala",            "lat":  9.9312, "lon": 76.2673, "elevation_m":   0, "tier": "large_city"},
    {"station_id": "IN-KZD", "name": "Kozhikode",      "state": "Kerala",            "lat": 11.2588, "lon": 75.7804, "elevation_m":  26, "tier": "medium_city"},
    {"station_id": "IN-TRV", "name": "Thrissur",       "state": "Kerala",            "lat": 10.5276, "lon": 76.2144, "elevation_m":  17, "tier": "medium_city"},
    # ── Ladakh ──────────────────────────────────────────────────────────────
    {"station_id": "IN-LEH", "name": "Leh",            "state": "Ladakh",            "lat": 34.1526, "lon": 77.5771, "elevation_m": 3514, "tier": "hill_city"},
    # ── Madhya Pradesh ──────────────────────────────────────────────────────
    {"station_id": "IN-IDR", "name": "Indore",         "state": "Madhya Pradesh",    "lat": 22.7196, "lon": 75.8577, "elevation_m": 553, "tier": "major_metro"},
    {"station_id": "IN-BPL", "name": "Bhopal",         "state": "Madhya Pradesh",    "lat": 23.2599, "lon": 77.4126, "elevation_m": 523, "tier": "large_city"},
    {"station_id": "IN-JBL", "name": "Jabalpur",       "state": "Madhya Pradesh",    "lat": 23.1815, "lon": 79.9864, "elevation_m": 411, "tier": "large_city"},
    {"station_id": "IN-GWL", "name": "Gwalior",        "state": "Madhya Pradesh",    "lat": 26.2183, "lon": 78.1828, "elevation_m": 196, "tier": "large_city"},
    # ── Maharashtra ─────────────────────────────────────────────────────────
    {"station_id": "IN-MUM", "name": "Mumbai",         "state": "Maharashtra",       "lat": 19.0760, "lon": 72.8777, "elevation_m":  14, "tier": "mega_metro"},
    {"station_id": "IN-PUN", "name": "Pune",           "state": "Maharashtra",       "lat": 18.5204, "lon": 73.8567, "elevation_m": 560, "tier": "mega_metro"},
    {"station_id": "IN-NGP", "name": "Nagpur",         "state": "Maharashtra",       "lat": 21.1458, "lon": 79.0882, "elevation_m": 310, "tier": "large_city"},
    {"station_id": "IN-NSK", "name": "Nashik",         "state": "Maharashtra",       "lat": 19.9975, "lon": 73.7898, "elevation_m": 584, "tier": "large_city"},
    {"station_id": "IN-AUR", "name": "Aurangabad",     "state": "Maharashtra",       "lat": 19.8762, "lon": 75.3433, "elevation_m": 513, "tier": "large_city"},
    {"station_id": "IN-KPD", "name": "Kolhapur",       "state": "Maharashtra",       "lat": 16.7050, "lon": 74.2433, "elevation_m": 567, "tier": "medium_city"},
    # ── Manipur ─────────────────────────────────────────────────────────────
    {"station_id": "IN-IMF", "name": "Imphal",         "state": "Manipur",           "lat": 24.8170, "lon": 93.9368, "elevation_m": 786, "tier": "small_city"},
    # ── Meghalaya ───────────────────────────────────────────────────────────
    {"station_id": "IN-SHL", "name": "Shillong",       "state": "Meghalaya",         "lat": 25.5788, "lon": 91.8933, "elevation_m": 1496, "tier": "hill_city"},
    # ── Mizoram ─────────────────────────────────────────────────────────────
    {"station_id": "IN-AIZ", "name": "Aizawl",         "state": "Mizoram",           "lat": 23.7271, "lon": 92.7176, "elevation_m": 1132, "tier": "hill_city"},
    # ── Nagaland ────────────────────────────────────────────────────────────
    {"station_id": "IN-KOH", "name": "Kohima",         "state": "Nagaland",          "lat": 25.6601, "lon": 94.1101, "elevation_m": 1445, "tier": "hill_city"},
    # ── Odisha ──────────────────────────────────────────────────────────────
    {"station_id": "IN-BBS", "name": "Bhubaneswar",    "state": "Odisha",            "lat": 20.2961, "lon": 85.8245, "elevation_m":  45, "tier": "large_city"},
    {"station_id": "IN-CUT", "name": "Cuttack",        "state": "Odisha",            "lat": 20.4625, "lon": 85.8830, "elevation_m":  28, "tier": "medium_city"},
    # ── Punjab ──────────────────────────────────────────────────────────────
    {"station_id": "IN-LDH", "name": "Ludhiana",       "state": "Punjab",            "lat": 30.9010, "lon": 75.8573, "elevation_m": 244, "tier": "major_metro"},
    {"station_id": "IN-ASR", "name": "Amritsar",       "state": "Punjab",            "lat": 31.6340, "lon": 74.8723, "elevation_m": 234, "tier": "large_city"},
    {"station_id": "IN-JUL", "name": "Jalandhar",      "state": "Punjab",            "lat": 31.3260, "lon": 75.5762, "elevation_m": 228, "tier": "large_city"},
    # ── Rajasthan ───────────────────────────────────────────────────────────
    {"station_id": "IN-JAI", "name": "Jaipur",         "state": "Rajasthan",         "lat": 26.9124, "lon": 75.7873, "elevation_m": 431, "tier": "major_metro"},
    {"station_id": "IN-JDH", "name": "Jodhpur",        "state": "Rajasthan",         "lat": 26.2389, "lon": 73.0243, "elevation_m": 231, "tier": "large_city"},
    {"station_id": "IN-UDR", "name": "Udaipur",        "state": "Rajasthan",         "lat": 24.5854, "lon": 73.7125, "elevation_m": 598, "tier": "medium_city"},
    {"station_id": "IN-KOT", "name": "Kota",           "state": "Rajasthan",         "lat": 25.2138, "lon": 75.8648, "elevation_m": 271, "tier": "large_city"},
    {"station_id": "IN-AJM", "name": "Ajmer",          "state": "Rajasthan",         "lat": 26.4499, "lon": 74.6399, "elevation_m": 487, "tier": "medium_city"},
    # ── Sikkim ──────────────────────────────────────────────────────────────
    {"station_id": "IN-GTK", "name": "Gangtok",        "state": "Sikkim",            "lat": 27.3314, "lon": 88.6138, "elevation_m": 1650, "tier": "hill_city"},
    # ── Tamil Nadu ──────────────────────────────────────────────────────────
    {"station_id": "IN-CHE", "name": "Chennai",        "state": "Tamil Nadu",        "lat": 13.0827, "lon": 80.2707, "elevation_m":   7, "tier": "mega_metro"},
    {"station_id": "IN-CBE", "name": "Coimbatore",     "state": "Tamil Nadu",        "lat": 11.0168, "lon": 76.9558, "elevation_m": 411, "tier": "large_city"},
    {"station_id": "IN-MDU", "name": "Madurai",        "state": "Tamil Nadu",        "lat":  9.9252, "lon": 78.1198, "elevation_m": 101, "tier": "large_city"},
    {"station_id": "IN-SLM", "name": "Salem",          "state": "Tamil Nadu",        "lat": 11.6643, "lon": 78.1460, "elevation_m": 281, "tier": "medium_city"},
    {"station_id": "IN-TRY", "name": "Tiruchirappalli","state": "Tamil Nadu",        "lat": 10.7905, "lon": 78.7047, "elevation_m":  78, "tier": "large_city"},
    # ── Telangana ───────────────────────────────────────────────────────────
    {"station_id": "IN-HYD", "name": "Hyderabad",      "state": "Telangana",         "lat": 17.3850, "lon": 78.4867, "elevation_m": 542, "tier": "mega_metro"},
    {"station_id": "IN-WGL", "name": "Warangal",       "state": "Telangana",         "lat": 17.9784, "lon": 79.5941, "elevation_m": 269, "tier": "medium_city"},
    {"station_id": "IN-NZB", "name": "Nizamabad",      "state": "Telangana",         "lat": 18.6725, "lon": 78.0941, "elevation_m": 381, "tier": "medium_city"},
    # ── Tripura ─────────────────────────────────────────────────────────────
    {"station_id": "IN-AGX", "name": "Agartala",       "state": "Tripura",           "lat": 23.8315, "lon": 91.2868, "elevation_m":  13, "tier": "small_city"},
    # ── Uttar Pradesh ───────────────────────────────────────────────────────
    {"station_id": "IN-LKO", "name": "Lucknow",        "state": "Uttar Pradesh",     "lat": 26.8467, "lon": 80.9462, "elevation_m": 123, "tier": "major_metro"},
    {"station_id": "IN-KNP", "name": "Kanpur",         "state": "Uttar Pradesh",     "lat": 26.4499, "lon": 80.3319, "elevation_m": 126, "tier": "major_metro"},
    {"station_id": "IN-AGR", "name": "Agra",           "state": "Uttar Pradesh",     "lat": 27.1767, "lon": 78.0081, "elevation_m": 171, "tier": "large_city"},
    {"station_id": "IN-VNS", "name": "Varanasi",       "state": "Uttar Pradesh",     "lat": 25.3176, "lon": 82.9739, "elevation_m":  80, "tier": "large_city"},
    {"station_id": "IN-MRT", "name": "Meerut",         "state": "Uttar Pradesh",     "lat": 28.9845, "lon": 77.7064, "elevation_m": 219, "tier": "large_city"},
    {"station_id": "IN-PRG", "name": "Prayagraj",      "state": "Uttar Pradesh",     "lat": 25.4358, "lon": 81.8463, "elevation_m":  98, "tier": "large_city"},
    {"station_id": "IN-GZB", "name": "Ghaziabad",      "state": "Uttar Pradesh",     "lat": 28.6692, "lon": 77.4538, "elevation_m": 214, "tier": "major_metro"},
    {"station_id": "IN-GKP", "name": "Gorakhpur",      "state": "Uttar Pradesh",     "lat": 26.7606, "lon": 83.3732, "elevation_m":  82, "tier": "large_city"},
    # ── Uttarakhand ─────────────────────────────────────────────────────────
    {"station_id": "IN-DDN", "name": "Dehradun",       "state": "Uttarakhand",       "lat": 30.3165, "lon": 78.0322, "elevation_m": 640, "tier": "large_city"},
    {"station_id": "IN-HDW", "name": "Haridwar",       "state": "Uttarakhand",       "lat": 29.9457, "lon": 78.1642, "elevation_m": 249, "tier": "medium_city"},
    # ── West Bengal ─────────────────────────────────────────────────────────
    {"station_id": "IN-KOL", "name": "Kolkata",        "state": "West Bengal",       "lat": 22.5726, "lon": 88.3639, "elevation_m":   6, "tier": "mega_metro"},
    {"station_id": "IN-HWH", "name": "Howrah",         "state": "West Bengal",       "lat": 22.5958, "lon": 88.2636, "elevation_m":  12, "tier": "major_metro"},
    {"station_id": "IN-DGP", "name": "Durgapur",       "state": "West Bengal",       "lat": 23.5204, "lon": 87.3119, "elevation_m":  70, "tier": "large_city"},
    {"station_id": "IN-SLG", "name": "Siliguri",       "state": "West Bengal",       "lat": 26.7271, "lon": 88.3953, "elevation_m": 122, "tier": "large_city"},
    # ── Union Territories ───────────────────────────────────────────────────
    {"station_id": "IN-DEL", "name": "Delhi",          "state": "Delhi",             "lat": 28.6139, "lon": 77.2090, "elevation_m": 216, "tier": "mega_metro"},
    {"station_id": "IN-CHD", "name": "Chandigarh",     "state": "Chandigarh",        "lat": 30.7333, "lon": 76.7794, "elevation_m": 321, "tier": "medium_city"},
    {"station_id": "IN-PY",  "name": "Puducherry",     "state": "Puducherry",        "lat": 11.9416, "lon": 79.8083, "elevation_m":  12, "tier": "medium_city"},
    {"station_id": "IN-NOI", "name": "Noida",          "state": "Delhi NCR",         "lat": 28.5355, "lon": 77.3910, "elevation_m": 198, "tier": "major_metro"},
]


def _has_osm_cache(station_id: str) -> bool:
    """Return True if both OSM cache files (geom + count) exist for this station."""
    geom = OSM_DIR / f"{station_id}_geom_1000.json"
    count = OSM_DIR / f"{station_id}_count_3000.json"
    return geom.exists() and count.exists()


def _fallback_morphology(tier: str, station_id: str) -> dict[str, float]:
    """Return tier-based morphology estimates for a city without OSM cache."""
    base = _MORPH_TIERS.get(tier, _MORPH_TIERS["medium_city"]).copy()
    log.debug("using %s fallback morphology for %s", tier, station_id)
    return base


def _classify_by_morphology(building_count_km2_3km: float, building_plan_fraction_1km: float) -> str:
    if building_count_km2_3km >= 800 or building_plan_fraction_1km >= 0.30:
        return "urban"
    if building_count_km2_3km <= 200 or building_plan_fraction_1km <= 0.08:
        return "rural"
    return "suburban"


def build(force: bool = False) -> list[dict]:
    """Build hotspot entries for Indian cities and write india_cities.json."""
    if INDIA_HOTSPOTS_PATH.exists() and not force:
        log.info("reusing cached Indian city data → %s", INDIA_HOTSPOTS_PATH.name)
        return json.loads(INDIA_HOTSPOTS_PATH.read_text(encoding="utf-8"))

    total = len(INDIA_CITIES)
    log.info("building entries for %d Indian cities (all states + major UTs)", total)

    # Split: cities with complete OSM cache vs. those that need fallback.
    cached_ids = {c["station_id"] for c in INDIA_CITIES if _has_osm_cache(c["station_id"])}
    fallback_ids = {c["station_id"] for c in INDIA_CITIES} - cached_ids
    log.info("%d cities have OSM cache; %d will use tier-based fallback morphology",
             len(cached_ids), len(fallback_ids))

    sites_frame = pd.DataFrame(INDIA_CITIES)

    # ── OSM morphology for cached cities ────────────────────────────────────
    morph_rows = []
    if cached_ids:
        cached_df = sites_frame[sites_frame["station_id"].isin(cached_ids)].copy()
        try:
            osm_morph = osm.build_morphology_table(
                cached_df[["station_id", "lat", "lon"]], MORPH_RADII_M
            )
            if not osm_morph.empty:
                morph_rows.append(osm_morph)
                log.info("OSM morphology loaded for %d cached cities", len(osm_morph))
        except Exception as exc:
            log.warning("OSM morphology query failed (%s) — falling back for all cities", exc)
            cached_ids = set()
            fallback_ids = {c["station_id"] for c in INDIA_CITIES}

    # ── Tier-based fallback morphology ──────────────────────────────────────
    if fallback_ids:
        fallback_rows = []
        for city in INDIA_CITIES:
            if city["station_id"] not in fallback_ids:
                continue
            row = {"station_id": city["station_id"]}
            row.update(_fallback_morphology(city["tier"], city["station_id"]))
            fallback_rows.append(row)
        morph_rows.append(pd.DataFrame(fallback_rows))

    morph = pd.concat(morph_rows, ignore_index=True) if morph_rows else pd.DataFrame()

    # ── Merge morphology with city metadata ─────────────────────────────────
    sites = sites_frame.merge(morph, on="station_id", how="left")
    for col in [
        "building_plan_fraction_1km", "building_count_km2_1km", "building_count_km2_3km",
        "road_length_km_km2_1km", "green_fraction_1km", "water_fraction_1km",
        "green_count_km2_3km", "water_count_km2_3km",
    ]:
        if col not in sites.columns:
            sites[col] = 0.0
        else:
            sites[col] = sites[col].fillna(0.0)

    sites["impervious_fraction_1km"] = np.clip(
        sites["building_plan_fraction_1km"]
        + sites["road_length_km_km2_1km"] * 1000.0 * 7.0 / 1e6,
        0.0, 1.0,
    )
    sites["urban_class"] = sites.apply(
        lambda r: _classify_by_morphology(
            r["building_count_km2_3km"], r["building_plan_fraction_1km"]
        ),
        axis=1,
    )

    # ── Run model predictions ────────────────────────────────────────────────
    model_path = MODELS_DIR / "heat_model.joblib"
    predicted_uhi: dict[str, float] = {}
    predicted_temp: dict[str, float] = {}
    predicted_hi: dict[str, float] = {}
    predicted_risk: dict[str, str] = {}

    if not model_path.exists():
        log.warning("heat model not found — modelled UHI will be 0 for all cities")
    else:
        bundle = joblib.load(model_path)
        # Indian pre-monsoon / summer night reference: hot, humid, calm winds
        # (~01:00 IST = 19:30 UTC on a July night).
        reference_conditions = {
            "t_ref_c": 30.0,
            "dewpoint_ref_c": 22.0,
            "wind_speed_ms": 1.0,
            "sky_cover_oktas": 2.0,
            "slp_hpa": 1005.0,
            "precip_1h_mm": 0.0,
        }
        reference_ts = pd.Timestamp("2024-07-16 19:30", tz="UTC")
        try:
            predicted_frame = predict_sites(bundle, sites, reference_conditions, reference_ts)
            predicted_uhi  = dict(zip(predicted_frame["station_id"], predicted_frame["predicted_uhi_c"]))
            predicted_temp = dict(zip(predicted_frame["station_id"], predicted_frame["predicted_temp_c"]))
            predicted_hi   = dict(zip(predicted_frame["station_id"], predicted_frame["predicted_heat_index_c"]))
            predicted_risk = dict(zip(predicted_frame["station_id"], predicted_frame["heat_risk"]))
            log.info("model predictions complete for %d cities", len(predicted_frame))
        except Exception as exc:
            log.warning("model prediction failed (%s) — setting UHI=0", exc)
        finally:
            del bundle
            gc.collect()

    # ── Assemble output records ──────────────────────────────────────────────
    records = []
    for _, row in sites.iterrows():
        sid = row["station_id"]
        data_source = "osm" if sid in cached_ids else "estimated"
        records.append({
            "station_id": sid,
            "name": row["name"],
            "state": row["state"],
            "country": "IN",
            "lat": float(row["lat"]),
            "lon": float(row["lon"]),
            "elevation_m": float(row["elevation_m"]),
            "urban_class": row["urban_class"],
            "tier": row["tier"],
            "morphology_source": data_source,
            "morphology": {
                "building_plan_fraction_1km":  float(row["building_plan_fraction_1km"]),
                "building_count_km2_1km":      float(row["building_count_km2_1km"]),
                "building_count_km2_3km":      float(row["building_count_km2_3km"]),
                "road_length_km_km2_1km":      float(row["road_length_km_km2_1km"]),
                "green_fraction_1km":           float(row["green_fraction_1km"]),
                "water_fraction_1km":           float(row["water_fraction_1km"]),
                "impervious_fraction_1km":      float(row["impervious_fraction_1km"]),
                "green_count_km2_3km":          float(row["green_count_km2_3km"]),
                "water_count_km2_3km":          float(row["water_count_km2_3km"]),
            },
            "observed": None,
            "modelled": {
                "uhi_c":         float(predicted_uhi.get(sid, 0.0)),
                "temp_c":        float(predicted_temp.get(sid, 0.0)),
                "heat_index_c":  float(predicted_hi.get(sid, 0.0)),
                "heat_risk":     predicted_risk.get(sid, "unknown"),
            },
        })

    INDIA_HOTSPOTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    INDIA_HOTSPOTS_PATH.write_text(
        json.dumps(records, indent=2, default=str), encoding="utf-8"
    )
    log.info(
        "india_cities.json written: %d cities, %d with real OSM data, %d with estimated morphology",
        len(records), len(cached_ids), len(fallback_ids),
    )
    return records


if __name__ == "__main__":
    build(force=True)
