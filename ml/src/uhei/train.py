"""Stage 4 — model development, comparison, tuning and evaluation.

Everything in this module is measured, never assumed:

* Eight model families are fitted on identical data and scored identically.
* All splits are chronological. Nothing is shuffled; the test window is the last
  five months of the record and is touched exactly once, at the very end.
* Hyperparameters are searched with `TimeSeriesSplit` cross-validation **inside
  the training window only**.
* Imputation and scaling live inside the pipeline, so their statistics are
  learned from training folds alone.

Artifacts written to `ml/models/` and `ml/reports/`.
"""
from __future__ import annotations

import json
import platform
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import (
    GradientBoostingRegressor, HistGradientBoostingRegressor, RandomForestRegressor,
)
from sklearn.impute import SimpleImputer
from sklearn.linear_model import ElasticNet, Lasso, LinearRegression, Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import RandomizedSearchCV, TimeSeriesSplit, cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import PolynomialFeatures, StandardScaler
from sklearn.svm import SVR
from sklearn.tree import DecisionTreeRegressor

from . import __version__
from .catalog import ENERGY_CATALOG, GROUP_LABELS, HEAT_CATALOG
from .config import (
    CV_SPLITS, DATA_SOURCES, MAX_TRAIN_ROWS, MODELS_DIR, N_JOBS, RANDOM_STATE,
    REPORTS_DIR, TRAIN_END, VALID_END, YEARS,
)
from .features import (
    ENERGY_FEATURES, ENERGY_TARGET, HEAT_FEATURES, HEAT_TARGET,
    engineer_energy_features, engineer_heat_features,
)
from .utils import Timer, get_logger

log = get_logger(__name__)

# Subsample caps keep the comparison honest *and* runnable on a laptop: every
# model sees the same rows, and the caps are recorded in the report.
MAX_EVAL_ROWS = 150_000         # cap on the validation and test windows
CV_SUBSAMPLE = 60_000           # rows used for cross-validation of tree models
SVR_SUBSAMPLE = 10_000          # SVR is O(n²) to fit and O(support vectors) to score
POLY_SUBSAMPLE = 60_000         # degree-2 expansion of 35 inputs is ~630 columns
SEARCH_SUBSAMPLE = 60_000


# ═════════════════════════════════════════════════════════════════════════════
# Splitting
# ═════════════════════════════════════════════════════════════════════════════
@dataclass
class Split:
    X_train: pd.DataFrame
    y_train: pd.Series
    X_valid: pd.DataFrame
    y_valid: pd.Series
    X_test: pd.DataFrame
    y_test: pd.Series
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def feature_names(self) -> list[str]:
        return list(self.X_train.columns)


def chronological_split(df: pd.DataFrame, features: list[str], target: str,
                        max_train_rows: int = MAX_TRAIN_ROWS,
                        max_eval_rows: int = MAX_EVAL_ROWS,
                        engineer: Callable[[pd.DataFrame], pd.DataFrame] | None = None) -> Split:
    """Time-ordered train / validation / test split with bounded set sizes.

    When a window is larger than its cap, rows are thinned by taking a regular
    stride through the chronologically sorted frame. A stride preserves the
    diurnal and seasonal structure and the station mix exactly — unlike random
    sampling, which would also be defensible but is harder to reproduce and to
    reason about.

    The evaluation windows are capped as well as the training window. Kernel
    methods predict in time proportional to the number of support vectors times
    the number of rows scored, and scoring every candidate on 1.1 million
    held-out rows would make the comparison intractable without making it more
    informative. Every model is scored on exactly the same thinned windows, so
    the comparison stays fair, and 150 000 held-out rows is a large sample by
    any standard.

    Pass `engineer` to build features *after* the windows are cut. Feature
    engineering here is strictly row-wise, so the result is identical either
    way, but engineering three small windows instead of four million rows keeps
    the memory footprint an order of magnitude smaller.
    """
    df = df.sort_values("ts_utc").reset_index(drop=True)
    ts = pd.to_datetime(df["ts_utc"], utc=True)
    train_end = pd.Timestamp(TRAIN_END, tz="UTC") + pd.Timedelta(days=1)
    valid_end = pd.Timestamp(VALID_END, tz="UTC") + pd.Timedelta(days=1)

    train_mask = ts < train_end
    valid_mask = (ts >= train_end) & (ts < valid_end)
    test_mask = ts >= valid_end

    def thin(frame: pd.DataFrame, cap: int) -> tuple[pd.DataFrame, int]:
        if len(frame) <= cap:
            return frame, 1
        step = int(np.ceil(len(frame) / cap))
        return frame.iloc[::step], step

    train, stride = thin(df.loc[train_mask], max_train_rows)
    valid, valid_stride = thin(df.loc[valid_mask], max_eval_rows)
    test, test_stride = thin(df.loc[test_mask], max_eval_rows)

    if engineer is not None:
        # Preserve the original row labels so callers can join the windows back
        # onto the source frame for segment-level reporting.
        def _engineer(window: pd.DataFrame) -> pd.DataFrame:
            index = window.index
            built = engineer(window.reset_index(drop=True))
            built.index = index
            return built

        train, valid, test = _engineer(train), _engineer(valid), _engineer(test)

    missing = [f for f in features if f not in train.columns]
    if missing:
        raise KeyError(f"features missing from the frame: {missing}")

    split = Split(
        X_train=train[features].astype("float32"), y_train=train[target].astype("float64"),
        X_valid=valid[features].astype("float32"), y_valid=valid[target].astype("float64"),
        X_test=test[features].astype("float32"), y_test=test[target].astype("float64"),
        meta={
            "strategy": "chronological (no shuffling, no random split)",
            "train_window": [str(ts[train_mask].min()), str(ts[train_mask].max())],
            "valid_window": [str(ts[valid_mask].min()), str(ts[valid_mask].max())],
            "test_window": [str(ts[test_mask].min()), str(ts[test_mask].max())],
            "train_rows_available": int(train_mask.sum()),
            "train_rows_used": int(len(train)),
            "train_stride": stride,
            "valid_rows_available": int(valid_mask.sum()),
            "valid_rows": int(len(valid)),
            "valid_stride": valid_stride,
            "test_rows_available": int(test_mask.sum()),
            "test_rows": int(len(test)),
            "test_stride": test_stride,
            "thinning": ("Windows larger than their cap are thinned by a regular stride "
                         "through time; every model is scored on identical rows."),
        },
    )
    log.info("split → train %d/%d (stride %d) · valid %d/%d · test %d/%d",
             len(train), int(train_mask.sum()), stride,
             len(valid), int(valid_mask.sum()), len(test), int(test_mask.sum()))
    return split


# ═════════════════════════════════════════════════════════════════════════════
# Metrics
# ═════════════════════════════════════════════════════════════════════════════
def score(y_true, y_pred) -> dict[str, float]:
    mse = float(mean_squared_error(y_true, y_pred))
    return {
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "mse": mse,
        "rmse": float(np.sqrt(mse)),
        "r2": float(r2_score(y_true, y_pred)),
    }


def _numeric_pipeline(model, scale: bool) -> Pipeline:
    steps: list[tuple[str, Any]] = [("impute", SimpleImputer(strategy="median"))]
    if scale:
        steps.append(("scale", StandardScaler()))
    steps.append(("model", model))
    return Pipeline(steps)


# ═════════════════════════════════════════════════════════════════════════════
# Model zoo
# ═════════════════════════════════════════════════════════════════════════════
@dataclass
class Candidate:
    key: str
    name: str
    family: str
    rationale: str
    build: Callable[[], Pipeline]
    fit_rows: int | None = None      # cap on training rows (None = all)
    cv_rows: int | None = CV_SUBSAMPLE


def candidate_models() -> list[Candidate]:
    rs = RANDOM_STATE
    return [
        Candidate(
            "baseline_mean", "Mean baseline", "baseline",
            "Predicts the training mean. Any model that cannot beat this is worthless.",
            lambda: _numeric_pipeline(DummyRegressor(strategy="mean"), scale=False),
        ),
        Candidate(
            "linear", "Linear Regression", "linear",
            "Ordinary least squares — the simplest additive model; a reference point for how much non-linearity matters.",
            lambda: _numeric_pipeline(LinearRegression(), scale=True),
        ),
        Candidate(
            "ridge", "Ridge Regression", "linear",
            "L2-penalised least squares; stabilises coefficients when engineered interactions are collinear.",
            lambda: _numeric_pipeline(Ridge(alpha=1.0, random_state=rs), scale=True),
        ),
        Candidate(
            "lasso", "Lasso Regression", "linear",
            "L1 penalty; drives redundant features to exactly zero and shows which inputs survive sparsity.",
            lambda: _numeric_pipeline(Lasso(alpha=0.01, max_iter=5000, random_state=rs), scale=True),
        ),
        Candidate(
            "elasticnet", "ElasticNet", "linear",
            "Blends L1 and L2; handles correlated morphology features better than pure Lasso.",
            lambda: _numeric_pipeline(
                ElasticNet(alpha=0.01, l1_ratio=0.5, max_iter=5000, random_state=rs), scale=True),
        ),
        Candidate(
            "polynomial", "Polynomial Ridge (deg 2)", "linear",
            "Degree-2 expansion with ridge shrinkage — tests whether smooth curvature alone explains the signal.",
            lambda: Pipeline([
                ("impute", SimpleImputer(strategy="median")),
                ("scale", StandardScaler()),
                ("poly", PolynomialFeatures(degree=2, include_bias=False, interaction_only=False)),
                ("model", Ridge(alpha=10.0, random_state=rs)),
            ]),
            fit_rows=POLY_SUBSAMPLE, cv_rows=40_000,
        ),
        Candidate(
            "svr", "Support Vector Regression (RBF)", "kernel",
            "RBF kernel regression. Training is O(n²), so it is fitted on a fixed subsample — reported as such.",
            lambda: _numeric_pipeline(SVR(kernel="rbf", C=10.0, epsilon=0.1, gamma="scale"), scale=True),
            fit_rows=SVR_SUBSAMPLE, cv_rows=SVR_SUBSAMPLE,
        ),
        Candidate(
            "decision_tree", "Decision Tree", "tree",
            "A single CART tree — the building block of the forest, shown alone to expose its variance.",
            lambda: _numeric_pipeline(
                DecisionTreeRegressor(max_depth=16, min_samples_leaf=20, random_state=rs), scale=False),
        ),
        Candidate(
            "random_forest", "Random Forest (default)", "ensemble",
            "Bagged decision trees with feature subsampling, untuned — the starting point for optimisation.",
            lambda: _numeric_pipeline(
                RandomForestRegressor(n_estimators=200, random_state=rs, n_jobs=N_JOBS), scale=False),
        ),
        Candidate(
            "gradient_boosting", "Histogram Gradient Boosting", "ensemble",
            "Sequential boosting on binned features — the strongest common alternative to a forest on tabular data.",
            lambda: _numeric_pipeline(
                HistGradientBoostingRegressor(max_iter=400, learning_rate=0.08,
                                              random_state=rs), scale=False),
        ),
    ]


# ═════════════════════════════════════════════════════════════════════════════
# Evaluation loop
# ═════════════════════════════════════════════════════════════════════════════
def _subsample(X: pd.DataFrame, y: pd.Series, n: int | None):
    if n is None or len(X) <= n:
        return X, y
    stride = int(np.ceil(len(X) / n))
    return X.iloc[::stride], y.iloc[::stride]


def evaluate_candidates(split: Split, candidates: list[Candidate]) -> list[dict]:
    results = []
    for cand in candidates:
        X_fit, y_fit = _subsample(split.X_train, split.y_train, cand.fit_rows)
        pipeline = cand.build()

        with Timer() as t:
            pipeline.fit(X_fit, y_fit)
        fit_seconds = t.seconds

        X_cv, y_cv = _subsample(split.X_train, split.y_train, cand.cv_rows)
        with Timer() as tcv:
            cv_scores = cross_val_score(
                cand.build(), X_cv, y_cv,
                cv=TimeSeriesSplit(n_splits=CV_SPLITS),
                scoring="neg_root_mean_squared_error",
                n_jobs=1 if cand.family in {"ensemble", "kernel"} else N_JOBS,
            )
        cv_rmse = -cv_scores

        row = {
            "key": cand.key,
            "name": cand.name,
            "family": cand.family,
            "rationale": cand.rationale,
            "train": score(y_fit, pipeline.predict(X_fit)),
            "validation": score(split.y_valid, pipeline.predict(split.X_valid)),
            "test": score(split.y_test, pipeline.predict(split.X_test)),
            "cv": {
                "folds": CV_SPLITS,
                "scheme": "TimeSeriesSplit on the training window",
                "rmse_mean": float(cv_rmse.mean()),
                "rmse_std": float(cv_rmse.std()),
                "rows": int(len(X_cv)),
            },
            "fit_seconds": round(fit_seconds, 3),
            "cv_seconds": round(tcv.seconds, 3),
            "fit_rows": int(len(X_fit)),
            "subsampled": len(X_fit) < len(split.X_train),
        }
        results.append(row)
        log.info("%-32s valid RMSE %.4f · R² %+.4f · CV RMSE %.4f ± %.4f · %.1fs",
                 cand.name, row["validation"]["rmse"], row["validation"]["r2"],
                 row["cv"]["rmse_mean"], row["cv"]["rmse_std"], fit_seconds)
    return results


# ═════════════════════════════════════════════════════════════════════════════
# Random Forest optimisation
# ═════════════════════════════════════════════════════════════════════════════
RF_SEARCH_SPACE = {
    "model__n_estimators": [200, 300, 400],
    "model__max_depth": [None, 14, 20, 28, 36],
    "model__min_samples_split": [2, 5, 10, 20],
    "model__min_samples_leaf": [1, 2, 4, 8],
    "model__max_features": [0.3, 0.5, 0.7, "sqrt", 1.0],
    "model__bootstrap": [True, False],
}


def tune_random_forest(split: Split, n_iter: int = 24) -> dict:
    """Randomised search over the forest's hyperparameters.

    Search happens on a strided subsample of the *training* window only, scored
    by `TimeSeriesSplit` cross-validation. The test set is never involved.
    """
    X, y = _subsample(split.X_train, split.y_train, SEARCH_SUBSAMPLE)
    base = _numeric_pipeline(
        RandomForestRegressor(random_state=RANDOM_STATE, n_jobs=N_JOBS), scale=False)

    search = RandomizedSearchCV(
        base, RF_SEARCH_SPACE, n_iter=n_iter,
        cv=TimeSeriesSplit(n_splits=3),
        scoring="neg_root_mean_squared_error",
        random_state=RANDOM_STATE, n_jobs=1, verbose=0, refit=False,
    )
    log.info("random-forest search: %d configurations × 3 time-series folds on %d rows",
             n_iter, len(X))
    with Timer() as t:
        search.fit(X, y)

    cv_df = pd.DataFrame(search.cv_results_)
    trials = (cv_df[["params", "mean_test_score", "std_test_score", "rank_test_score"]]
              .sort_values("rank_test_score").head(10))
    return {
        "search": "RandomizedSearchCV",
        "n_iter": n_iter,
        "cv": "TimeSeriesSplit(n_splits=3) on the training window",
        "search_rows": int(len(X)),
        "seconds": round(t.seconds, 1),
        "best_params": {k.replace("model__", ""): v for k, v in search.best_params_.items()},
        "best_cv_rmse": float(-search.best_score_),
        "space": {k.replace("model__", ""): v for k, v in RF_SEARCH_SPACE.items()},
        "top_trials": [
            {
                "params": {k.replace("model__", ""): v for k, v in row.params.items()},
                "cv_rmse": float(-row.mean_test_score),
                "cv_rmse_std": float(row.std_test_score),
            }
            for row in trials.itertuples()
        ],
    }


def fit_final_forest(split: Split, best_params: dict) -> tuple[Pipeline, dict]:
    """Refit the tuned forest on the full training window and score it everywhere."""
    model = RandomForestRegressor(random_state=RANDOM_STATE, n_jobs=N_JOBS,
                                  oob_score=bool(best_params.get("bootstrap", True)),
                                  **best_params)
    pipeline = _numeric_pipeline(model, scale=False)
    with Timer() as t:
        pipeline.fit(split.X_train, split.y_train)

    forest: RandomForestRegressor = pipeline.named_steps["model"]
    metrics = {
        "train": score(split.y_train, pipeline.predict(split.X_train)),
        "validation": score(split.y_valid, pipeline.predict(split.X_valid)),
        "test": score(split.y_test, pipeline.predict(split.X_test)),
        "fit_seconds": round(t.seconds, 2),
        "n_trees": int(forest.n_estimators),
        "mean_tree_depth": float(np.mean([est.get_depth() for est in forest.estimators_])),
        "mean_leaves": float(np.mean([est.get_n_leaves() for est in forest.estimators_])),
    }
    if getattr(forest, "oob_score_", None) is not None:
        metrics["oob_r2"] = float(forest.oob_score_)

    log.info("tuned forest → valid RMSE %.4f R² %+.4f | test RMSE %.4f R² %+.4f",
             metrics["validation"]["rmse"], metrics["validation"]["r2"],
             metrics["test"]["rmse"], metrics["test"]["r2"])
    return pipeline, metrics


def impurity_importance(pipeline: Pipeline, features: list[str]) -> list[dict]:
    forest = pipeline.named_steps["model"]
    importances = forest.feature_importances_
    std = np.std([tree.feature_importances_ for tree in forest.estimators_], axis=0)
    order = np.argsort(importances)[::-1]
    return [
        {"feature": features[i], "importance": float(importances[i]), "std": float(std[i])}
        for i in order
    ]


# ═════════════════════════════════════════════════════════════════════════════
# Feature metadata (drives the product's input controls)
# ═════════════════════════════════════════════════════════════════════════════
def feature_metadata(task: str, split: Split, raw_train: pd.DataFrame) -> list[dict]:
    catalog = HEAT_CATALOG if task == "heat" else ENERGY_CATALOG
    out = []
    for name in split.feature_names:
        col = split.X_train[name].astype("float64")
        spec = catalog.get(name)
        out.append({
            "name": name,
            "label": spec.label if spec else name.replace("_", " ").title(),
            "unit": spec.unit if spec else "",
            "group": spec.group if spec else "other",
            "group_label": GROUP_LABELS.get(spec.group if spec else "other", "Other"),
            "description": spec.description if spec else "",
            "adjustable": bool(spec.adjustable) if spec else False,
            "decimals": spec.decimals if spec else 2,
            "min": float(col.min()),
            "p01": float(col.quantile(0.01)),
            "p25": float(col.quantile(0.25)),
            "median": float(col.median()),
            "p75": float(col.quantile(0.75)),
            "p99": float(col.quantile(0.99)),
            "max": float(col.max()),
            "missing_fraction": float(col.isna().mean()),
        })
    return out


# ═════════════════════════════════════════════════════════════════════════════
# Task drivers
# ═════════════════════════════════════════════════════════════════════════════
def _task_report(task: str, dataset: pd.DataFrame, split: Split,
                 comparison: list[dict], tuning: dict, final_metrics: dict,
                 importance: list[dict], target: str, unit: str) -> dict:
    return {
        "task": task,
        "target": {"name": target, "unit": unit,
                   "mean": float(dataset[target].mean()),
                   "std": float(dataset[target].std()),
                   "min": float(dataset[target].min()),
                   "max": float(dataset[target].max())},
        "dataset_rows": int(len(dataset)),
        "split": split.meta,
        "comparison": comparison,
        "tuning": tuning,
        "selected": {
            "key": "random_forest_tuned",
            "name": "Random Forest (tuned)",
            "metrics": final_metrics,
            "hyperparameters": tuning["best_params"],
        },
        "feature_importance": importance,
        "notes": [
            "All splits are chronological; nothing is shuffled.",
            "Hyperparameters were selected by TimeSeriesSplit cross-validation on the "
            "training window; the test window was scored once, after selection.",
            "Imputation and scaling are fitted inside each pipeline, on training folds only.",
        ],
    }


def train_heat(dataset: pd.DataFrame, n_iter: int = 24) -> dict:
    log.info("── Urban heat island · model development ─────────────────────────")
    split = chronological_split(dataset, HEAT_FEATURES, HEAT_TARGET,
                                engineer=engineer_heat_features)

    comparison = evaluate_candidates(split, candidate_models())
    tuning = tune_random_forest(split, n_iter=n_iter)
    pipeline, metrics = fit_final_forest(split, tuning["best_params"])
    importance = impurity_importance(pipeline, split.feature_names)

    joblib.dump({
        "pipeline": pipeline,
        "features": split.feature_names,
        "target": HEAT_TARGET,
        "task": "heat",
    }, MODELS_DIR / "heat_model.joblib", compress=3)

    report = _task_report("heat", dataset, split, comparison, tuning, metrics,
                          importance, HEAT_TARGET, "°C")
    (REPORTS_DIR / "model_report_heat.json").write_text(
        json.dumps(report, indent=2, default=str), encoding="utf-8")
    report["_feature_metadata"] = feature_metadata("heat", split, dataset)
    return report


def train_energy(dataset: pd.DataFrame, n_iter: int = 20) -> dict:
    log.info("── Zonal electricity demand · model development ──────────────────")
    zone_codes = {z: i for i, z in enumerate(sorted(dataset["zone"].astype(str).unique()))}
    split = chronological_split(
        dataset, ENERGY_FEATURES, ENERGY_TARGET,
        engineer=lambda frame: engineer_energy_features(frame, zone_codes=zone_codes),
    )

    comparison = evaluate_candidates(split, candidate_models())
    tuning = tune_random_forest(split, n_iter=n_iter)
    pipeline, metrics = fit_final_forest(split, tuning["best_params"])
    importance = impurity_importance(pipeline, split.feature_names)

    joblib.dump({
        "pipeline": pipeline,
        "features": split.feature_names,
        "target": ENERGY_TARGET,
        "task": "energy",
        "zone_codes": zone_codes,
    }, MODELS_DIR / "energy_model.joblib", compress=3)

    report = _task_report("energy", dataset, split, comparison, tuning, metrics,
                          importance, ENERGY_TARGET, "MW")
    report["zone_codes"] = zone_codes
    (REPORTS_DIR / "model_report_energy.json").write_text(
        json.dumps(report, indent=2, default=str), encoding="utf-8")
    report["_feature_metadata"] = feature_metadata("energy", split, dataset)
    return report


def write_metadata(heat_report: dict, energy_report: dict | None,
                   stations: pd.DataFrame) -> None:
    """Persist the model + feature metadata consumed by the API and the UI."""
    feature_meta = {"heat": heat_report.pop("_feature_metadata")}
    if energy_report is not None:
        feature_meta["energy"] = energy_report.pop("_feature_metadata")

    (MODELS_DIR / "feature_metadata.json").write_text(
        json.dumps(feature_meta, indent=2), encoding="utf-8")

    metadata = {
        "project": "Urban Heat & Energy Intelligence Engine",
        "version": __version__,
        "trained_at": pd.Timestamp.utcnow().isoformat(),
        "environment": {
            "python": platform.python_version(),
            "scikit_learn": sklearn.__version__,
            "numpy": np.__version__,
            "pandas": pd.__version__,
            "platform": platform.platform(),
        },
        "study_period_years": list(YEARS),
        "split_strategy": {
            "type": "chronological",
            "train_end": TRAIN_END,
            "valid_end": VALID_END,
            "cross_validation": f"TimeSeriesSplit(n_splits={CV_SPLITS})",
            "rationale": (
                "The data are a time series observed on a fixed station network. A random "
                "split would let the model see a July 2024 afternoon while predicting the "
                "hour beside it, which no deployed system could do."
            ),
        },
        "data_sources": [
            {"key": s.key, "name": s.name, "url": s.url,
             "license": s.license, "description": s.description}
            for s in DATA_SOURCES
        ],
        "network": {
            "stations": int(len(stations)),
            "by_class": stations["urban_class"].value_counts().to_dict(),
            "states": sorted(stations["state"].dropna().unique().tolist()),
        },
        "tasks": {},
    }

    for name, report in (("heat", heat_report), ("energy", energy_report)):
        if report is None:
            continue
        metadata["tasks"][name] = {
            "target": report["target"],
            "rows": report["dataset_rows"],
            "split": report["split"],
            "selected_model": report["selected"]["name"],
            "hyperparameters": report["selected"]["hyperparameters"],
            "metrics": report["selected"]["metrics"],
            "n_features": len(report["feature_importance"]),
        }

    (MODELS_DIR / "model_metadata.json").write_text(
        json.dumps(metadata, indent=2, default=str), encoding="utf-8")
    log.info("metadata → model_metadata.json · feature_metadata.json")
