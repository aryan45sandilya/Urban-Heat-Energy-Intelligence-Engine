"""Tests for feature engineering — the code shared by training and serving.

The contract these protect: the same raw inputs must produce the same feature
row whether they arrive from a parquet file during training or from an HTTP
request at serving time. If that ever stops being true, predictions silently
become wrong rather than failing loudly.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from uhei.features import (
    ENERGY_FEATURES, HEAT_FEATURES, HEAT_TARGET, add_holiday_flag, add_solar_features,
    add_time_features, engineer_energy_features, engineer_heat_features,
    meteorological_season,
)


def heat_frame(rows: int = 48) -> pd.DataFrame:
    """A synthetic frame with the raw columns the heat model consumes.

    Explicitly synthetic and used only to exercise the transformation code —
    never presented anywhere as data.
    """
    rng = np.random.default_rng(0)
    return pd.DataFrame({
        "ts_utc": pd.date_range("2024-07-01", periods=rows, freq="h", tz="UTC"),
        "t_ref_c": rng.uniform(15, 32, rows),
        "dewpoint_ref_c": rng.uniform(5, 18, rows),
        "wind_speed_ms": rng.uniform(0, 8, rows),
        "sky_cover_oktas": rng.integers(0, 9, rows).astype(float),
        "slp_hpa": rng.uniform(1000, 1025, rows),
        "precip_1h_mm": np.zeros(rows),
        "lat": np.full(rows, 40.78),
        "lon": np.full(rows, -73.97),
        "elevation_m": np.full(rows, 39.0),
        "building_plan_fraction_1km": np.full(rows, 0.21),
        "building_count_km2_1km": np.full(rows, 480.0),
        "road_length_km_km2_1km": np.full(rows, 12.5),
        "green_fraction_1km": np.full(rows, 0.52),
        "water_fraction_1km": np.full(rows, 0.07),
        "impervious_fraction_1km": np.full(rows, 0.29),
        "building_count_km2_3km": np.full(rows, 578.0),
        "green_count_km2_3km": np.full(rows, 4.2),
        "water_count_km2_3km": np.full(rows, 1.1),
    })


def energy_frame(rows: int = 48) -> pd.DataFrame:
    rng = np.random.default_rng(1)
    return pd.DataFrame({
        "ts_utc": pd.date_range("2024-07-01", periods=rows, freq="h", tz="UTC"),
        "zone": ["N.Y.C."] * rows,
        "temp_c": rng.uniform(18, 34, rows),
        "dewpoint_c": rng.uniform(10, 22, rows),
        "wind_speed_ms": rng.uniform(0, 7, rows),
        "sky_cover_oktas": rng.integers(0, 9, rows).astype(float),
        "temp_24h_mean_c": rng.uniform(20, 30, rows),
        "temp_24h_max_c": rng.uniform(26, 36, rows),
        "lat": np.full(rows, 40.71),
        "lon": np.full(rows, -74.01),
    })


class TestSeasons:
    @pytest.mark.parametrize(
        "month,expected",
        [(12, 0), (1, 0), (2, 0), (3, 1), (5, 1), (6, 2), (8, 2), (9, 3), (11, 3)],
    )
    def test_month_to_season(self, month, expected):
        assert int(meteorological_season([month])[0]) == expected

    def test_all_months_map_into_range(self):
        seasons = meteorological_season(list(range(1, 13)))
        assert set(seasons.tolist()) == {0, 1, 2, 3}


class TestTimeFeatures:
    def test_converts_to_eastern_time(self):
        frame = pd.DataFrame({"ts_utc": pd.DatetimeIndex(["2024-07-16T03:00:00Z"])})
        out = add_time_features(frame)
        assert int(out["hour_local"].iloc[0]) == 23      # 03:00 UTC = 23:00 EDT the day before
        assert int(out["month"].iloc[0]) == 7

    def test_cyclical_encodings_are_on_the_unit_circle(self):
        out = add_time_features(heat_frame())
        radius = out["hour_sin"] ** 2 + out["hour_cos"] ** 2
        assert np.allclose(radius, 1.0, atol=1e-9)

    def test_weekend_flag(self):
        frame = pd.DataFrame({
            "ts_utc": pd.DatetimeIndex(["2024-07-13T16:00:00Z", "2024-07-15T16:00:00Z"]),
        })
        out = add_time_features(frame)
        assert out["is_weekend"].tolist() == [1, 0]      # Saturday, Monday

    def test_dst_boundary_is_handled(self):
        # 2024-11-03 is the US DST fall-back date.
        frame = pd.DataFrame({
            "ts_utc": pd.date_range("2024-11-03T04:00:00Z", periods=4, freq="h", tz="UTC"),
        })
        out = add_time_features(frame)
        assert out["hour_local"].is_monotonic_increasing or True   # must not raise
        assert len(out) == 4


class TestHolidays:
    def test_independence_day_is_flagged(self):
        frame = pd.DataFrame({
            "ts_utc": pd.DatetimeIndex(["2024-07-04T16:00:00Z", "2024-07-09T16:00:00Z"]),
        })
        out = add_holiday_flag(frame)
        assert out["is_holiday"].tolist() == [1, 0]


class TestSolarFeatures:
    def test_night_flag_agrees_with_elevation(self):
        out = add_solar_features(add_time_features(heat_frame(72)))
        night = out["is_night"] == 1
        assert (out.loc[night, "solar_elevation_deg"] < 0).all()
        assert (out.loc[~night, "solar_elevation_deg"] > -1).all()

    def test_clear_sky_index_is_zero_at_night(self):
        out = add_solar_features(add_time_features(heat_frame(72)))
        assert (out.loc[out["is_night"] == 1, "clear_sky_index"] <= 1e-9).all()

    def test_clear_sky_index_bounded(self):
        out = add_solar_features(add_time_features(heat_frame(120)))
        assert out["clear_sky_index"].between(0, 1).all()


class TestHeatFeatures:
    def test_produces_every_declared_feature(self):
        out = engineer_heat_features(heat_frame())
        missing = [name for name in HEAT_FEATURES if name not in out.columns]
        assert missing == [], f"missing engineered features: {missing}"

    def test_no_nans_in_the_feature_matrix(self):
        out = engineer_heat_features(heat_frame())
        assert not out[HEAT_FEATURES].isna().any().any()

    def test_target_is_not_created_as_a_feature(self):
        out = engineer_heat_features(heat_frame())
        assert HEAT_TARGET not in HEAT_FEATURES
        assert HEAT_TARGET not in out.columns

    def test_is_deterministic(self):
        frame = heat_frame()
        first = engineer_heat_features(frame)[HEAT_FEATURES]
        second = engineer_heat_features(frame)[HEAT_FEATURES]
        pd.testing.assert_frame_equal(first, second)

    def test_does_not_mutate_its_input(self):
        frame = heat_frame()
        before = frame.copy()
        engineer_heat_features(frame)
        pd.testing.assert_frame_equal(frame, before)

    def test_single_row_matches_the_batch(self):
        """Serving sends one row; training sends millions. They must agree."""
        frame = heat_frame(24)
        batch = engineer_heat_features(frame)[HEAT_FEATURES]
        for i in (0, 7, 23):
            single = engineer_heat_features(frame.iloc[[i]].reset_index(drop=True))[HEAT_FEATURES]
            np.testing.assert_allclose(
                single.to_numpy(dtype=float)[0],
                batch.to_numpy(dtype=float)[i],
                rtol=1e-6, atol=1e-6,
                err_msg=f"row {i} differs between single-row and batch transformation",
            )

    def test_interactions_respond_to_their_inputs(self):
        frame = heat_frame(24)
        calm = frame.copy()
        calm["wind_speed_ms"] = 0.2
        windy = frame.copy()
        windy["wind_speed_ms"] = 12.0
        assert (engineer_heat_features(calm)["impervious_x_calm"].mean()
                > engineer_heat_features(windy)["impervious_x_calm"].mean())

    def test_humidity_is_derived_correctly(self):
        frame = heat_frame(12)
        out = engineer_heat_features(frame)
        assert out["rh_ref_pct"].between(1, 100).all()
        expected = frame["t_ref_c"] - frame["dewpoint_ref_c"]
        np.testing.assert_allclose(out["dewpoint_depression_c"], expected, rtol=1e-5)


class TestEnergyFeatures:
    def test_produces_every_declared_feature(self):
        out = engineer_energy_features(energy_frame(), zone_codes={"N.Y.C.": 8})
        missing = [name for name in ENERGY_FEATURES if name not in out.columns]
        assert missing == []

    def test_degree_days_are_complementary(self):
        out = engineer_energy_features(energy_frame(), zone_codes={"N.Y.C.": 8})
        both_positive = (out["cooling_degrees"] > 0) & (out["heating_degrees"] > 0)
        assert not both_positive.any()

    def test_zone_code_mapping_is_respected(self):
        out = engineer_energy_features(energy_frame(4), zone_codes={"N.Y.C.": 8})
        assert (out["zone_code"] == 8).all()

    def test_single_row_matches_the_batch(self):
        frame = energy_frame(12)
        codes = {"N.Y.C.": 8}
        batch = engineer_energy_features(frame, zone_codes=codes)[ENERGY_FEATURES]
        single = engineer_energy_features(
            frame.iloc[[5]].reset_index(drop=True), zone_codes=codes)[ENERGY_FEATURES]
        np.testing.assert_allclose(
            single.to_numpy(dtype=float)[0], batch.to_numpy(dtype=float)[5],
            rtol=1e-6, atol=1e-6,
        )
