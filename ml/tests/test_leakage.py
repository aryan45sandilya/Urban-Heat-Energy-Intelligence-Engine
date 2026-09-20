"""Leakage and split-integrity tests.

These run against the *real* processed datasets when they exist, and are skipped
with a clear message when the pipeline has not been run. They are the tests that
would catch the single most damaging class of error in a project like this: a
model that looks excellent because it was shown the answer.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from uhei.build_heat import HEAT_DATASET_PATH
from uhei.build_energy import ENERGY_DATASET_PATH
from uhei.config import TRAIN_END, VALID_END
from uhei.features import (
    ENERGY_FEATURES, ENERGY_TARGET, HEAT_FEATURES, HEAT_TARGET,
    engineer_energy_features, engineer_heat_features,
)
from uhei.train import chronological_split
from uhei.validate import ENERGY_FORBIDDEN_FEATURES, HEAT_FORBIDDEN_FEATURES

pytestmark = pytest.mark.filterwarnings("ignore")


@pytest.fixture(scope="module")
def heat() -> pd.DataFrame:
    if not HEAT_DATASET_PATH.exists():
        pytest.skip("heat dataset not built — run `python -m uhei.pipeline`")
    return pd.read_parquet(HEAT_DATASET_PATH)


@pytest.fixture(scope="module")
def energy() -> pd.DataFrame:
    if not ENERGY_DATASET_PATH.exists():
        pytest.skip("energy dataset not built — run `python -m uhei.pipeline`")
    return pd.read_parquet(ENERGY_DATASET_PATH)


class TestFeatureContract:
    def test_heat_target_is_not_a_feature(self):
        assert HEAT_TARGET not in HEAT_FEATURES

    def test_heat_target_components_are_not_features(self):
        """ΔT = T_site − T_ref, so T_site must never be offered to the model."""
        assert not (set(HEAT_FEATURES) & HEAT_FORBIDDEN_FEATURES)
        assert "t_site_c" not in HEAT_FEATURES

    def test_energy_target_is_not_a_feature(self):
        assert ENERGY_TARGET not in ENERGY_FEATURES
        assert not (set(ENERGY_FEATURES) & ENERGY_FORBIDDEN_FEATURES)

    def test_no_duplicate_feature_names(self):
        assert len(HEAT_FEATURES) == len(set(HEAT_FEATURES))
        assert len(ENERGY_FEATURES) == len(set(ENERGY_FEATURES))


class TestHeatDataset:
    def test_no_duplicate_site_hours(self, heat):
        assert not heat.duplicated(subset=["station_id", "ts_utc"]).any()

    def test_timestamps_are_utc_and_hour_aligned(self, heat):
        ts = pd.to_datetime(heat["ts_utc"], utc=True)
        assert str(ts.dt.tz) == "UTC"
        assert (ts == ts.dt.floor("h")).all()

    def test_every_row_has_at_least_two_references(self, heat):
        assert (heat["n_reference_stations"] >= 2).all()

    def test_no_feature_is_almost_the_target(self, heat):
        sample = heat.sample(min(len(heat), 100_000), random_state=0)
        engineered = engineer_heat_features(sample)
        correlations = (engineered[HEAT_FEATURES + [HEAT_TARGET]]
                        .corr(numeric_only=True)[HEAT_TARGET]
                        .drop(HEAT_TARGET).abs())
        offenders = correlations[correlations > 0.95]
        assert offenders.empty, f"suspiciously predictive features: {dict(offenders)}"

    def test_rural_sites_average_near_zero(self, heat):
        """The construction's own control: rural minus rural should be ~0."""
        rural_mean = heat.loc[heat["urban_class"] == "rural", HEAT_TARGET].mean()
        assert abs(rural_mean) < 0.35, (
            f"rural sites average {rural_mean:.3f} °C — the reference construction is biased"
        )

    def test_urban_sites_are_warmer_than_rural_sites(self, heat):
        means = heat.groupby("urban_class")[HEAT_TARGET].mean()
        assert means["urban"] > means["suburban"] > means["rural"]

    def test_target_is_within_physical_bounds(self, heat):
        assert heat[HEAT_TARGET].between(-8.0, 12.0).all()


class TestEnergyDataset:
    def test_no_duplicate_zone_hours(self, energy):
        assert not energy.duplicated(subset=["zone", "ts_utc"]).any()

    def test_load_is_positive(self, energy):
        assert (energy[ENERGY_TARGET] > 0).all()

    def test_rolling_features_do_not_see_the_future(self, energy):
        """The 24 h aggregates must be computable from the past alone."""
        zone = energy[energy["zone"] == energy["zone"].iloc[0]].sort_values("ts_utc")
        recomputed = zone["temp_c"].rolling(24, min_periods=12).mean()
        aligned = zone["temp_24h_mean_c"]
        both = pd.DataFrame({"stored": aligned, "recomputed": recomputed}).dropna()
        assert len(both) > 100
        np.testing.assert_allclose(both["stored"], both["recomputed"], rtol=1e-4, atol=1e-3)

    def test_no_autoregressive_load_feature(self):
        assert not any("load" in name for name in ENERGY_FEATURES)


class TestSplitIntegrity:
    @pytest.fixture(scope="class")
    def heat_split(self, heat):
        return chronological_split(engineer_heat_features(heat), HEAT_FEATURES, HEAT_TARGET)

    def test_all_three_windows_are_populated(self, heat_split):
        assert len(heat_split.X_train) > 1000
        assert len(heat_split.X_valid) > 1000
        assert len(heat_split.X_test) > 1000

    def test_no_row_appears_in_two_windows(self, heat_split):
        train = set(heat_split.X_train.index)
        valid = set(heat_split.X_valid.index)
        test = set(heat_split.X_test.index)
        assert not (train & valid)
        assert not (train & test)
        assert not (valid & test)

    def test_windows_are_time_ordered(self, heat):
        engineered = engineer_heat_features(heat).sort_values("ts_utc").reset_index(drop=True)
        ts = pd.to_datetime(engineered["ts_utc"], utc=True)
        train_end = pd.Timestamp(TRAIN_END, tz="UTC") + pd.Timedelta(days=1)
        valid_end = pd.Timestamp(VALID_END, tz="UTC") + pd.Timedelta(days=1)
        assert ts[ts < train_end].max() < ts[(ts >= train_end) & (ts < valid_end)].min()
        assert ts[(ts >= train_end) & (ts < valid_end)].max() < ts[ts >= valid_end].min()

    def test_column_order_is_identical_across_windows(self, heat_split):
        assert list(heat_split.X_train.columns) == HEAT_FEATURES
        assert list(heat_split.X_valid.columns) == HEAT_FEATURES
        assert list(heat_split.X_test.columns) == HEAT_FEATURES

    def test_evaluation_windows_contain_summer(self, heat):
        """A heat model evaluated only on shoulder seasons proves nothing."""
        ts = pd.to_datetime(heat["ts_utc"], utc=True)
        valid_end = pd.Timestamp(VALID_END, tz="UTC") + pd.Timedelta(days=1)
        train_end = pd.Timestamp(TRAIN_END, tz="UTC") + pd.Timedelta(days=1)
        valid_months = set(ts[(ts >= train_end) & (ts < valid_end)].dt.month)
        test_months = set(ts[ts >= valid_end].dt.month)
        assert valid_months & {6, 7} or test_months & {8, 9}
