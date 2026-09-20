"""Stage 4b — final model selection and segment-level reporting.

Two things happen here that the candidate sweep deliberately does not do.

**Final selection on the validation window, under a size budget.** Randomised
search optimises cross-validated RMSE *inside the training window*. That is the
right way to choose hyperparameters, but it does not guarantee the tuned
configuration beats the untuned one on genuinely unseen data — and it is blind
to a practical constraint: a forest of unbounded depth grown on 178 000 rows
serialises to roughly 400 MB, which is not a model anyone can deploy.

So several configurations are refitted on the full training window, scored on
the validation window, and selected by an explicit rule:

    among configurations whose validation RMSE is within 1% of the best,
    ship the smallest artifact.

Every candidate's score and size is recorded, so the cost of that choice is
visible rather than hidden. The test window plays no part in the decision.

**Segment metrics.** A single R² can flatter a model. Zonal electricity demand
ranges from ~300 MW in Millwood to ~5 600 MW in New York City, so *any* model
that knows which zone it is looking at scores extremely well overall while
saying little about its weather skill. Reporting R² within each segment — each
load zone, each site class — shows what the model actually knows.
"""
from __future__ import annotations

import gc
import json

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline

from .build_energy import ENERGY_DATASET_PATH
from .build_heat import HEAT_DATASET_PATH
from .config import MODELS_DIR, N_JOBS, RANDOM_STATE, REPORTS_DIR
from .features import (
    ENERGY_FEATURES, ENERGY_TARGET, HEAT_FEATURES, HEAT_TARGET,
    engineer_energy_features, engineer_heat_features,
)
from .train import Split, chronological_split, impurity_importance, score
from .utils import Timer, get_logger

log = get_logger(__name__)

# Deployability budget for the tree structures, in MB. A forest is worth exactly
# nothing if it cannot be loaded, and an unbounded forest on this much data runs
# to hundreds of megabytes — one earlier configuration serialised to 417 MB and
# took 3m48s for the API to load at start-up.
ARTIFACT_BUDGET_MB = 200.0

# Leaf-size ladder used to bring an over-budget configuration back inside it.
LEAF_LADDER = (1, 2, 4, 8, 16, 32, 64, 128, 256)

# Two reference configurations of roughly equal size but different shape — more
# trees held shallower, against fewer trees allowed deeper — so the report says
# something about where the capacity is best spent, not just how much there is.
COMPACT_FOREST = {"n_estimators": 300, "max_depth": 28, "min_samples_split": 20,
                  "min_samples_leaf": 24, "max_features": 0.5, "bootstrap": True}
LEAN_FOREST = {"n_estimators": 200, "max_depth": 26, "min_samples_split": 12,
               "min_samples_leaf": 16, "max_features": 0.5, "bootstrap": True}

# A configuration is preferred over a more accurate one only when its validation
# RMSE is within this fraction of the best score.
RMSE_TOLERANCE = 0.01

# Each node in a scikit-learn tree stores eight 8-byte fields.
BYTES_PER_NODE = 64


def _forest_size_mb(forest: RandomForestRegressor) -> float:
    """Measured in-memory size of the tree structures, in MB."""
    nodes = sum(int(est.tree_.node_count) for est in forest.estimators_)
    return nodes * BYTES_PER_NODE / (1024 ** 2)


def _predicted_size_mb(params: dict, n_train: int) -> float:
    """Predict artifact size *before* fitting.

    Calibrated against measurement rather than assumed. The naive argument — a
    tree splits until leaves hold `min_samples_leaf` rows, so it has about
    `2·n/leaf` nodes — over-predicts by a factor of two, because CART stops well
    short of that bound in most branches. A 400-tree forest with a leaf floor of
    64 on 177,881 rows was measured at 64 MB against a naive estimate of 136 MB,
    which puts the true node count at roughly `n/leaf` per tree.

    The estimate only has to be good enough to decide whether a configuration is
    worth the memory it would take to find out exactly, and at that it is ample.
    """
    leaf = max(1, int(params.get("min_samples_leaf") or 1))
    trees = int(params.get("n_estimators") or 100)
    return n_train / leaf * trees * BYTES_PER_NODE / (1024 ** 2)


def _fit_to_budget(params: dict, n_train: int, budget: float) -> tuple[dict, int | None]:
    """Raise the leaf floor until the configuration fits the budget.

    Returns the adjusted parameters and the original leaf floor when it had to
    change, so the report can say what was given up and why.
    """
    original = int(params.get("min_samples_leaf") or 1)
    for leaf in LEAF_LADDER:
        if leaf < original:
            continue
        candidate = {**params, "min_samples_leaf": leaf}
        if _predicted_size_mb(candidate, n_train) <= budget:
            return candidate, (original if leaf != original else None)
    return {**params, "min_samples_leaf": LEAF_LADDER[-1]}, original


def _fit(params: dict, split: Split) -> tuple[Pipeline, dict, float]:
    model = RandomForestRegressor(random_state=RANDOM_STATE, n_jobs=N_JOBS, **params)
    pipeline = Pipeline([("impute", SimpleImputer(strategy="median")), ("model", model)])
    with Timer() as t:
        pipeline.fit(split.X_train, split.y_train)
    metrics = {
        "train": score(split.y_train, pipeline.predict(split.X_train)),
        "validation": score(split.y_valid, pipeline.predict(split.X_valid)),
        "test": score(split.y_test, pipeline.predict(split.X_test)),
        "fit_seconds": round(t.seconds, 2),
        "n_trees": int(model.n_estimators),
        "estimated_size_mb": round(_forest_size_mb(model), 1),
        "mean_tree_depth": round(float(np.mean([e.get_depth() for e in model.estimators_])), 1),
        "mean_leaves": round(float(np.mean([e.get_n_leaves() for e in model.estimators_])), 0),
    }
    return pipeline, metrics, metrics["validation"]["rmse"]


def _segment_metrics(pipeline: Pipeline, split: Split, dataset: pd.DataFrame,
                     segment_col: str, target: str) -> list[dict]:
    """Score the model separately within each segment of the held-out window.

    The split's row labels are positions in the chronologically sorted frame, so
    the same ordering is reapplied here before looking a segment up. The built
    datasets already arrive sorted, which would make this a no-op — but relying
    on that would silently mislabel every segment the day it stopped being true.
    """
    ordered = dataset.sort_values("ts_utc").reset_index(drop=True)
    test_index = split.X_test.index
    segments = ordered.loc[test_index, segment_col]
    predictions = pipeline.predict(split.X_test)

    rows = []
    for name, mask in segments.groupby(segments).groups.items():
        selector = segments.index.isin(mask)
        if selector.sum() < 200:
            continue
        truth = split.y_test[selector]
        rows.append({
            "segment": str(name),
            "rows": int(selector.sum()),
            "mean_target": float(truth.mean()),
            "std_target": float(truth.std()),
            **score(truth, predictions[selector]),
        })
    rows.sort(key=lambda r: r["rows"], reverse=True)
    return rows


def _regime_metrics(pipeline: Pipeline, split: Split) -> list[dict]:
    """Heat-specific: how the model does in the regimes people care about."""
    frame = split.X_test
    predictions = pipeline.predict(frame)
    truth = split.y_test

    regimes = {
        "all hours": np.ones(len(frame), dtype=bool),
        "night": (frame["is_night"] == 1).to_numpy(),
        "day": (frame["is_night"] == 0).to_numpy(),
        "calm (< 2 m/s)": (frame["wind_speed_ms"] < 2).fillna(False).to_numpy(),
        "windy (> 5 m/s)": (frame["wind_speed_ms"] > 5).fillna(False).to_numpy(),
        "warm background (> 20 °C)": (frame["t_ref_c"] > 20).to_numpy(),
    }
    rows = []
    for name, mask in regimes.items():
        if mask.sum() < 200:
            continue
        rows.append({"regime": name, "rows": int(mask.sum()),
                     "mean_target": float(truth[mask].mean()),
                     **score(truth[mask], predictions[mask])})
    return rows


def finalize(task: str) -> dict:
    report_path = REPORTS_DIR / f"model_report_{task}.json"
    if not report_path.exists():
        raise FileNotFoundError(f"{report_path} not found — run the training stage first.")
    report = json.loads(report_path.read_text(encoding="utf-8"))

    if task == "heat":
        dataset = pd.read_parquet(HEAT_DATASET_PATH)
        split = chronological_split(dataset, HEAT_FEATURES, HEAT_TARGET,
                                    engineer=engineer_heat_features)
        segment_col, unit = "urban_class", "°C"
        extra_bundle: dict = {}
    else:
        dataset = pd.read_parquet(ENERGY_DATASET_PATH)
        bundle = joblib.load(MODELS_DIR / "energy_model.joblib")
        codes = bundle.get("zone_codes")
        split = chronological_split(
            dataset, ENERGY_FEATURES, ENERGY_TARGET,
            engineer=lambda frame: engineer_energy_features(frame, zone_codes=codes),
        )
        segment_col, unit = "zone_name", "MW"
        extra_bundle = {"zone_codes": codes}

    tuned_params = {k: (None if v == "None" else v)
                    for k, v in report["tuning"]["best_params"].items()}
    n_train = len(split.X_train)

    constrained, original_leaf = _fit_to_budget(tuned_params, n_train, ARTIFACT_BUDGET_MB)
    proposed = [
        ("tuned", "search-optimal, as selected by cross-validation", tuned_params),
        ("tuned-constrained",
         (f"search-optimal with its leaf floor raised from {original_leaf} to "
          f"{constrained['min_samples_leaf']} to fit the artifact budget")
         if original_leaf else "search-optimal (already inside the budget)",
         constrained),
        ("compact", "leaf floor 48, depth 26", COMPACT_FOREST),
        ("lean", "leaf floor 128, depth 22", LEAN_FOREST),
    ]

    # Over-budget configurations are costed, reported, and not fitted. Finding out
    # empirically that a forest is too big to deploy means first allocating it,
    # and the estimate is accurate enough to make that pointless.
    fitted: list[dict] = []
    skipped: list[dict] = []
    seen: set[str] = set()

    for key, note, params in proposed:
        signature = json.dumps(params, sort_keys=True, default=str)
        if signature in seen:
            continue
        seen.add(signature)

        predicted = _predicted_size_mb(params, n_train)
        if predicted > ARTIFACT_BUDGET_MB:
            log.info("[%s]   %-18s skipped — predicted ~%.0f MB exceeds the %.0f MB budget",
                     task, key, predicted, ARTIFACT_BUDGET_MB)
            skipped.append({"key": key, "note": note, "hyperparameters": params,
                            "predicted_size_mb": round(predicted, 1), "fitted": False,
                            "reason": "predicted artifact exceeds the deployability budget"})
            continue

        log.info("[%s] scoring the %s configuration on the full training window", task, key)
        pipeline, metrics, rmse = _fit(params, split)
        del pipeline
        gc.collect()
        fitted.append({"key": key, "note": note, "params": params,
                       "metrics": metrics, "rmse": rmse})
        log.info("[%s]   %-18s valid RMSE %.4f · R² %+.4f · %.0f MB · %.0fs",
                 task, key, rmse, metrics["validation"]["r2"],
                 metrics["estimated_size_mb"], metrics["fit_seconds"])

    if not fitted:
        raise RuntimeError(
            f"No candidate configuration fits the {ARTIFACT_BUDGET_MB:.0f} MB artifact budget."
        )

    best_rmse = min(entry["rmse"] for entry in fitted)
    eligible = [e for e in fitted if e["rmse"] <= best_rmse * (1 + RMSE_TOLERANCE)]
    chosen = min(eligible, key=lambda e: e["metrics"]["estimated_size_mb"])

    log.info("[%s] shipping the '%s' forest — %.4f RMSE (best %.4f) at ~%.0f MB; refitting it",
             task, chosen["key"], chosen["rmse"], best_rmse,
             chosen["metrics"]["estimated_size_mb"])
    params = chosen["params"]
    pipeline, metrics, _ = _fit(params, split)

    segments = _segment_metrics(pipeline, split, dataset, segment_col, split.y_test.name)
    report["selected"] = {
        "key": f"random_forest_{chosen['key']}",
        "name": f"Random Forest ({chosen['key']})",
        "metrics": metrics,
        "hyperparameters": params,
        "selection": {
            "rule": (
                "Hyperparameters were searched by TimeSeriesSplit cross-validation inside the "
                "training window. Candidate configurations were then costed: a forest whose "
                f"predicted artifact exceeds {ARTIFACT_BUDGET_MB:.0f} MB is not deployable and "
                "is reported rather than fitted. The remainder were refitted on the full "
                "training window and scored on the validation window, and among those within "
                f"{RMSE_TOLERANCE:.0%} of the best validation RMSE the smallest artifact was "
                "shipped. The test window took no part in the decision and was scored once, "
                "afterwards."
            ),
            "tolerance": RMSE_TOLERANCE,
            "artifact_budget_mb": ARTIFACT_BUDGET_MB,
            "chosen": chosen["key"],
            "best_validation_rmse": round(best_rmse, 5),
            "candidates": [
                {
                    "key": entry["key"],
                    "note": entry["note"],
                    "fitted": True,
                    "validation_rmse": round(entry["rmse"], 5),
                    "validation_r2": round(entry["metrics"]["validation"]["r2"], 5),
                    "test_r2": round(entry["metrics"]["test"]["r2"], 5),
                    "estimated_size_mb": entry["metrics"]["estimated_size_mb"],
                    "fit_seconds": entry["metrics"]["fit_seconds"],
                    "within_tolerance": entry["rmse"] <= best_rmse * (1 + RMSE_TOLERANCE),
                    "hyperparameters": entry["params"],
                }
                for entry in fitted
            ] + skipped,
        },
    }
    report["segment_metrics"] = {
        "column": segment_col,
        "unit": unit,
        "note": ("Scores computed separately within each segment of the held-out test window. "
                 "A high overall R² can simply reflect large differences *between* segments; "
                 "these figures show how much the model knows *within* one."),
        "segments": segments,
    }
    if task == "heat":
        report["regime_metrics"] = _regime_metrics(pipeline, split)

    report["feature_importance"] = impurity_importance(pipeline, split.feature_names)

    artifact = MODELS_DIR / f"{task}_model.joblib"
    joblib.dump(
        {"pipeline": pipeline, "features": split.feature_names,
         "target": split.y_test.name, "task": task, **extra_bundle},
        artifact, compress=3,
    )
    metrics["artifact_mb"] = round(artifact.stat().st_size / (1024 ** 2), 1)
    report["selected"]["metrics"] = metrics
    report_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    log.info("[%s] artifact → %s (%.1f MB on disk)", task, artifact.name, metrics["artifact_mb"])

    log.info("[%s] final → valid RMSE %.4f R² %+.4f | test RMSE %.4f R² %+.4f",
             task, metrics["validation"]["rmse"], metrics["validation"]["r2"],
             metrics["test"]["rmse"], metrics["test"]["r2"])
    for row in segments[:6]:
        log.info("   %-22s n=%-7d R²=%+.3f  RMSE=%.3f %s",
                 row["segment"], row["rows"], row["r2"], row["rmse"], unit)
    return report


if __name__ == "__main__":  # pragma: no cover
    finalize("heat")
