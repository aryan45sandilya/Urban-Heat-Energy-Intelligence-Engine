"""Unit tests for the physical and geometric helpers.

These are checked against values that can be verified independently — published
formulae, textbook constants, known distances — rather than against whatever the
implementation happened to produce.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from uhei.utils import (
    dewpoint_from_rh, haversine_km, heat_index_c, heat_risk_band,
    polygon_area_m2, polyline_length_m, relative_humidity_pct, solar_elevation_deg,
)


class TestHaversine:
    def test_known_distance(self):
        # Central Park to Philadelphia International: 0.911° of latitude (≈101 km)
        # and 1.262° of longitude at ≈40°N (≈107 km) — about 147 km great-circle.
        distance = haversine_km(40.779, -73.969, 39.868, -75.231)
        assert 143 < distance < 151

    def test_zero_distance(self):
        assert haversine_km(41.0, -74.0, 41.0, -74.0) == pytest.approx(0.0, abs=1e-9)

    def test_symmetric(self):
        forward = haversine_km(40.0, -75.0, 42.0, -73.0)
        backward = haversine_km(42.0, -73.0, 40.0, -75.0)
        assert forward == pytest.approx(backward)

    def test_vectorised(self):
        lats = np.array([40.0, 41.0, 42.0])
        lons = np.array([-74.0, -74.0, -74.0])
        distances = haversine_km(40.0, -74.0, lats, lons)
        assert distances.shape == (3,)
        assert distances[0] == pytest.approx(0.0, abs=1e-9)
        assert distances[1] < distances[2]

    def test_one_degree_latitude(self):
        # One degree of latitude is ~111 km everywhere.
        assert haversine_km(40.0, -74.0, 41.0, -74.0) == pytest.approx(111.2, abs=0.5)


class TestGeometry:
    def test_square_area(self):
        # ~0.01° of latitude ≈ 1.11 km; a square of that side ≈ 1.23 km².
        ring = [(40.0, -74.0), (40.0, -73.99), (40.01, -73.99), (40.01, -74.0)]
        area = polygon_area_m2(ring)
        assert area == pytest.approx(1.11e6 * 0.853, rel=0.1)

    def test_degenerate_polygon(self):
        assert polygon_area_m2([(40.0, -74.0), (40.1, -74.0)]) == 0.0
        assert polygon_area_m2([]) == 0.0

    def test_winding_order_does_not_matter(self):
        ring = [(40.0, -74.0), (40.0, -73.99), (40.01, -73.99), (40.01, -74.0)]
        assert polygon_area_m2(ring) == pytest.approx(polygon_area_m2(list(reversed(ring))))

    def test_polyline_length(self):
        length = polyline_length_m([(40.0, -74.0), (41.0, -74.0)])
        assert length == pytest.approx(111_200, rel=0.01)

    def test_single_point_line(self):
        assert polyline_length_m([(40.0, -74.0)]) == 0.0


class TestHumidity:
    def test_saturation(self):
        assert relative_humidity_pct(20.0, 20.0) == pytest.approx(100.0, abs=0.5)

    def test_dry_air(self):
        assert relative_humidity_pct(30.0, 0.0) < 20.0

    def test_round_trip(self):
        for temp in (-5.0, 5.0, 20.0, 35.0):
            for rh in (25.0, 50.0, 90.0):
                dewpoint = dewpoint_from_rh(temp, rh)
                assert relative_humidity_pct(temp, dewpoint) == pytest.approx(rh, abs=0.5)

    def test_dewpoint_never_exceeds_temperature(self):
        for temp in (-10.0, 0.0, 15.0, 30.0):
            assert dewpoint_from_rh(temp, 100.0) <= temp + 0.1

    def test_bounded(self):
        assert 1.0 <= float(relative_humidity_pct(40.0, -40.0)) <= 100.0


class TestHeatIndex:
    def test_matches_published_nws_value(self):
        # NWS table: 32.2 °C (90 °F) at 70% RH → 105 °F ≈ 40.6 °C.
        value = float(heat_index_c(32.2, 70.0))
        assert value == pytest.approx(40.6, abs=1.5)

    def test_cool_conditions_are_near_air_temperature(self):
        value = float(heat_index_c(18.0, 50.0))
        assert abs(value - 18.0) < 3.0

    def test_monotone_in_humidity_when_hot(self):
        dry = float(heat_index_c(35.0, 30.0))
        humid = float(heat_index_c(35.0, 80.0))
        assert humid > dry

    def test_monotone_in_temperature(self):
        assert float(heat_index_c(38.0, 60.0)) > float(heat_index_c(30.0, 60.0))

    def test_vectorised(self):
        values = heat_index_c(np.array([25.0, 35.0]), np.array([50.0, 50.0]))
        assert values.shape == (2,)
        assert values[1] > values[0]


class TestRiskBands:
    @pytest.mark.parametrize(
        "value,expected",
        [(15.0, "none"), (30.0, "caution"), (35.0, "extreme-caution"),
         (45.0, "danger"), (60.0, "extreme-danger")],
    )
    def test_bands(self, value, expected):
        band, description = heat_risk_band(value)
        assert band == expected
        assert description

    def test_bands_are_ordered(self):
        bands = [heat_risk_band(v)[0] for v in (10, 28, 34, 45, 70)]
        assert bands == ["none", "caution", "extreme-caution", "danger", "extreme-danger"]


class TestSolarGeometry:
    def test_summer_noon_is_high(self):
        # 21 June, 17:00 UTC ≈ 13:00 local solar time in New York.
        ts = pd.DatetimeIndex(["2024-06-21T17:00:00Z"])
        elevation = solar_elevation_deg(ts, np.array([40.78]), np.array([-73.97]))
        assert 65 < float(elevation[0]) < 75

    def test_midnight_is_below_horizon(self):
        ts = pd.DatetimeIndex(["2024-06-21T05:00:00Z"])   # 01:00 local
        elevation = solar_elevation_deg(ts, np.array([40.78]), np.array([-73.97]))
        assert float(elevation[0]) < 0

    def test_winter_noon_lower_than_summer_noon(self):
        summer = solar_elevation_deg(pd.DatetimeIndex(["2024-06-21T17:00:00Z"]),
                                     np.array([40.78]), np.array([-73.97]))
        winter = solar_elevation_deg(pd.DatetimeIndex(["2024-12-21T17:00:00Z"]),
                                     np.array([40.78]), np.array([-73.97]))
        assert float(winter[0]) < float(summer[0]) - 30

    def test_within_physical_bounds(self):
        ts = pd.date_range("2024-01-01", periods=500, freq="7h", tz="UTC")
        elevation = solar_elevation_deg(ts, np.full(500, 42.0), np.full(500, -75.0))
        assert elevation.min() >= -90.0
        assert elevation.max() <= 90.0
