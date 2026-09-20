"""Human-facing descriptions of every model input.

The product's Prediction Studio and What-If Simulator are generated from this
catalogue plus the *empirical* ranges measured on the training split, so the
interface can never offer a control the model was not trained to handle.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FeatureSpec:
    name: str
    label: str
    unit: str
    group: str
    description: str
    adjustable: bool = False     # exposed as a what-if control
    decimals: int = 2


_HEAT_SPECS = (
    # ── Background atmosphere ────────────────────────────────────────────────
    FeatureSpec("t_ref_c", "Background air temperature", "°C", "atmosphere",
                "Rural reference temperature — the temperature the surrounding countryside is at.",
                adjustable=True, decimals=1),
    FeatureSpec("rh_ref_pct", "Relative humidity", "%", "atmosphere",
                "Derived from background temperature and dew point (Magnus-Tetens).",
                adjustable=True, decimals=0),
    FeatureSpec("dewpoint_depression_c", "Dew-point depression", "°C", "atmosphere",
                "Temperature minus dew point. Large values mean dry air and strong radiative cooling."),
    FeatureSpec("wind_speed_ms", "Wind speed", "m/s", "atmosphere",
                "Background wind. Wind mixes the urban canopy with rural air and suppresses the heat island.",
                adjustable=True, decimals=1),
    FeatureSpec("sky_cover_oktas", "Cloud cover", "oktas", "atmosphere",
                "Sky cover in eighths. Cloud traps outgoing longwave radiation and flattens the urban-rural contrast.",
                adjustable=True, decimals=0),
    FeatureSpec("slp_hpa", "Sea-level pressure", "hPa", "atmosphere",
                "Synoptic pressure; high pressure accompanies calm, clear conditions.", decimals=0),
    FeatureSpec("precip_1h_mm", "Precipitation", "mm/h", "atmosphere",
                "Rainfall in the past hour. Wet surfaces evaporate and cool.", decimals=1),
    FeatureSpec("is_precipitating", "Precipitation flag", "0/1", "atmosphere",
                "Whether measurable rain fell in the past hour.", decimals=0),

    # ── Solar & temporal ─────────────────────────────────────────────────────
    FeatureSpec("solar_elevation_deg", "Solar elevation", "°", "time",
                "Sun angle above the horizon, computed astronomically from time and position.",
                decimals=1),
    FeatureSpec("clear_sky_index", "Solar geometry index", "0-1", "time",
                "Sine of solar elevation — the geometric part of incoming shortwave radiation."),
    FeatureSpec("is_night", "Night", "0/1", "time",
                "Sun below the horizon. The urban heat island peaks a few hours after sunset.",
                decimals=0),
    FeatureSpec("hour_sin", "Hour (sine)", "", "time", "Cyclical encoding of local hour."),
    FeatureSpec("hour_cos", "Hour (cosine)", "", "time", "Cyclical encoding of local hour."),
    FeatureSpec("doy_sin", "Day of year (sine)", "", "time", "Cyclical encoding of the annual cycle."),
    FeatureSpec("doy_cos", "Day of year (cosine)", "", "time", "Cyclical encoding of the annual cycle."),
    FeatureSpec("season", "Season", "0-3", "time",
                "Meteorological season: 0 winter, 1 spring, 2 summer, 3 autumn.", decimals=0),
    FeatureSpec("is_weekend", "Weekend", "0/1", "time",
                "Weekend flag — a proxy for reduced traffic and commercial waste heat.", decimals=0),

    # ── Geography ────────────────────────────────────────────────────────────
    FeatureSpec("lat", "Latitude", "°N", "geography", "Site latitude.", decimals=3),
    FeatureSpec("lon", "Longitude", "°E", "geography", "Site longitude.", decimals=3),
    FeatureSpec("elevation_m", "Elevation", "m", "geography",
                "Station elevation above sea level.", decimals=0),

    # ── Urban morphology ─────────────────────────────────────────────────────
    FeatureSpec("building_plan_fraction_1km", "Building plan fraction (1 km)", "0-1", "morphology",
                "Share of ground within 1 km covered by building footprints, measured from OpenStreetMap.",
                adjustable=True, decimals=3),
    FeatureSpec("building_count_km2_1km", "Building density (1 km)", "/km²", "morphology",
                "Buildings per square kilometre within 1 km.", decimals=0),
    FeatureSpec("road_length_km_km2_1km", "Road density (1 km)", "km/km²", "morphology",
                "Length of road carriageway per square kilometre within 1 km.",
                adjustable=True, decimals=2),
    FeatureSpec("green_fraction_1km", "Green cover (1 km)", "0-1", "morphology",
                "Share of ground within 1 km tagged as park, forest, grass or other vegetation.",
                adjustable=True, decimals=3),
    FeatureSpec("water_fraction_1km", "Water cover (1 km)", "0-1", "morphology",
                "Share of ground within 1 km covered by water bodies.", adjustable=True, decimals=3),
    FeatureSpec("impervious_fraction_1km", "Impervious surface (1 km)", "0-1", "morphology",
                "Sealed ground: building footprints plus carriageway (7 m assumed width).",
                adjustable=True, decimals=3),
    FeatureSpec("building_count_km2_3km", "Building density (3 km)", "/km²", "morphology",
                "Neighbourhood-scale built-up density — the urban context a site sits in.",
                adjustable=True, decimals=0),
    FeatureSpec("green_count_km2_3km", "Green features (3 km)", "/km²", "morphology",
                "Density of mapped green spaces in the surrounding 3 km.", decimals=2),
    FeatureSpec("water_count_km2_3km", "Water features (3 km)", "/km²", "morphology",
                "Density of mapped water bodies in the surrounding 3 km.", decimals=2),

    # ── Interactions ─────────────────────────────────────────────────────────
    FeatureSpec("impervious_x_calm", "Impervious × calm air", "", "interaction",
                "Sealed surface weighted by wind stillness — the classic heat-island amplifier."),
    FeatureSpec("impervious_x_night", "Impervious × night", "", "interaction",
                "Sealed surface active only after dark, when stored daytime heat is released."),
    FeatureSpec("green_x_clearsky", "Green cover × sun", "", "interaction",
                "Vegetation weighted by solar geometry — evapotranspirative cooling under sun."),
    FeatureSpec("building3k_x_calm", "Built-up density × calm air", "", "interaction",
                "Neighbourhood density weighted by wind stillness."),
    FeatureSpec("cloud_x_night", "Cloud × night", "", "interaction",
                "Nocturnal cloud cover — suppresses radiative cooling in both city and country."),
    FeatureSpec("water_x_summer", "Water × summer", "", "interaction",
                "Water bodies active in summer, when their thermal inertia matters most."),
)

_ENERGY_SPECS = (
    FeatureSpec("temp_c", "Air temperature", "°C", "atmosphere",
                "Zone-average air temperature from the attached weather stations.",
                adjustable=True, decimals=1),
    FeatureSpec("rh_pct", "Relative humidity", "%", "atmosphere",
                "Zone-average relative humidity.", adjustable=True, decimals=0),
    FeatureSpec("heat_index_c", "Heat index", "°C", "atmosphere",
                "NWS apparent temperature — what the air feels like to a person.", decimals=1),
    FeatureSpec("wind_speed_ms", "Wind speed", "m/s", "atmosphere",
                "Zone-average wind speed.", adjustable=True, decimals=1),
    FeatureSpec("sky_cover_oktas", "Cloud cover", "oktas", "atmosphere",
                "Zone-average sky cover in eighths.", adjustable=True, decimals=0),
    FeatureSpec("cooling_degrees", "Cooling degrees", "°C", "atmosphere",
                "Degrees above the 18.3 °C (65 °F) balance point — air-conditioning demand."),
    FeatureSpec("heating_degrees", "Heating degrees", "°C", "atmosphere",
                "Degrees below the 18.3 °C balance point — electric heating demand."),
    FeatureSpec("temp_24h_mean_c", "24 h mean temperature", "°C", "atmosphere",
                "Mean temperature over the current hour and the 23 before it — thermal memory of the building stock.",
                adjustable=True, decimals=1),
    FeatureSpec("temp_24h_max_c", "24 h maximum temperature", "°C", "atmosphere",
                "Hottest hour in the trailing day.", adjustable=True, decimals=1),
    FeatureSpec("temp_24h_cdd", "24 h cooling degrees", "°C", "atmosphere",
                "Trailing-day cooling degrees — accumulated air-conditioning load."),
    FeatureSpec("solar_elevation_deg", "Solar elevation", "°", "time",
                "Sun angle above the horizon.", decimals=1),
    FeatureSpec("clear_sky_index", "Solar geometry index", "0-1", "time",
                "Sine of solar elevation — drives daylight and solar gain."),
    FeatureSpec("hour_sin", "Hour (sine)", "", "time", "Cyclical encoding of local hour."),
    FeatureSpec("hour_cos", "Hour (cosine)", "", "time", "Cyclical encoding of local hour."),
    FeatureSpec("doy_sin", "Day of year (sine)", "", "time", "Cyclical encoding of the annual cycle."),
    FeatureSpec("doy_cos", "Day of year (cosine)", "", "time", "Cyclical encoding of the annual cycle."),
    FeatureSpec("hour_local", "Local hour", "h", "time",
                "Hour of day in US Eastern Time.", adjustable=True, decimals=0),
    FeatureSpec("day_of_week", "Day of week", "0-6", "time",
                "Monday = 0. Commercial demand collapses at the weekend.", decimals=0),
    FeatureSpec("month", "Month", "1-12", "time", "Calendar month.", decimals=0),
    FeatureSpec("season", "Season", "0-3", "time",
                "0 winter, 1 spring, 2 summer, 3 autumn.", decimals=0),
    FeatureSpec("is_weekend", "Weekend", "0/1", "time", "Weekend flag.", decimals=0),
    FeatureSpec("is_holiday", "US federal holiday", "0/1", "time",
                "Published US federal holiday calendar.", decimals=0),
    FeatureSpec("zone_code", "Load zone", "id", "geography",
                "Which of the 11 NYISO load zones this demand belongs to.", decimals=0),
)

HEAT_CATALOG: dict[str, FeatureSpec] = {s.name: s for s in _HEAT_SPECS}
ENERGY_CATALOG: dict[str, FeatureSpec] = {s.name: s for s in _ENERGY_SPECS}

GROUP_LABELS = {
    "atmosphere": "Atmospheric conditions",
    "time": "Time & solar geometry",
    "geography": "Geography",
    "morphology": "Urban morphology",
    "interaction": "Engineered interactions",
}


def describe(task: str, name: str) -> FeatureSpec:
    catalog = HEAT_CATALOG if task == "heat" else ENERGY_CATALOG
    return catalog.get(name, FeatureSpec(name, name.replace("_", " ").title(), "", "other", ""))
