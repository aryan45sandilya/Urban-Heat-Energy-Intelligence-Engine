"""Stage 5 — SHAP explainability.

Two products:

*Global* — how the model uses each input across held-out data: mean |SHAP|,
a summary-plot point cloud, and partial dependence of SHAP on feature value.
Computed once at training time on a sample of the **test** window.

*Local* — why one particular prediction came out the way it did. Computed live
by the API through `LocalExplainer`.

Language discipline
-------------------
SHAP measures the model's internal attribution. It says how the model's output
changes as an input changes, given the rest of the input. It does **not**
establish that changing the world would change the temperature. Every string
produced here is phrased as "the model attributes / associates", never "causes".
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
import shap
from sklearn.pipeline import Pipeline

from .catalog import ENERGY_CATALOG, HEAT_CATALOG
from .config import RANDOM_STATE, REPORTS_DIR
from .utils import get_logger

log = get_logger(__name__)

# Exact tree SHAP costs roughly O(trees × leaves × depth²) per row, which on the
# shipped forest measures at 1–2 seconds. A few hundred held-out rows is ample
# for a stable mean-|SHAP| ranking, and the sample size is reported alongside the
# result so the reader can judge it.
GLOBAL_SAMPLE = 400        # rows drawn from the test window for global SHAP
SUMMARY_POINTS = 240       # points per feature retained for the summary plot
DEPENDENCE_BINS = 18
TOP_FEATURES = 14


def _transform(pipeline: Pipeline, X: pd.DataFrame) -> np.ndarray:
    """Apply every pipeline step except the estimator."""
    transformer = Pipeline(pipeline.steps[:-1])
    return transformer.transform(X)


class LocalExplainer:
    """Per-prediction SHAP attribution for a fitted tree pipeline."""

    def __init__(self, pipeline: Pipeline, features: list[str], task: str):
        self.pipeline = pipeline
        self.features = features
        self.task = task
        self.catalog = HEAT_CATALOG if task == "heat" else ENERGY_CATALOG
        self._explainer = shap.TreeExplainer(
            pipeline.named_steps["model"], feature_perturbation="tree_path_dependent"
        )
        base = self._explainer.expected_value
        self.base_value = float(np.asarray(base).ravel()[0])

    def shap_values(self, X: pd.DataFrame) -> np.ndarray:
        values = self._explainer.shap_values(_transform(self.pipeline, X), check_additivity=False)
        return np.asarray(values)

    def explain_row(self, X: pd.DataFrame, top_k: int = 8) -> dict:
        """Explain a single-row frame. Returns contributions in target units."""
        values = self.shap_values(X)[0]
        prediction = float(self.pipeline.predict(X)[0])
        order = np.argsort(np.abs(values))[::-1]

        contributions = []
        for idx in order[:top_k]:
            name = self.features[idx]
            spec = self.catalog.get(name)
            contributions.append({
                "feature": name,
                "label": spec.label if spec else name.replace("_", " ").title(),
                "unit": spec.unit if spec else "",
                "group": spec.group if spec else "other",
                "value": float(X.iloc[0][name]),
                "contribution": float(values[idx]),
                "direction": "increases" if values[idx] > 0 else "decreases",
            })

        covered = float(np.sum([c["contribution"] for c in contributions]))
        return {
            "base_value": self.base_value,
            "prediction": prediction,
            "contributions": contributions,
            "other_features_contribution": float(values.sum() - covered),
            "interpretation": (
                "Values are SHAP attributions in the model's output units. They describe how "
                "this model distributes its prediction across the inputs it was given — an "
                "association learned from historical observations, not a causal effect."
            ),
        }


def global_explanation(pipeline: Pipeline, features: list[str], X: pd.DataFrame,
                       task: str, sample: int = GLOBAL_SAMPLE) -> dict:
    """Compute global SHAP structure on held-out rows."""
    catalog = HEAT_CATALOG if task == "heat" else ENERGY_CATALOG
    rng = np.random.default_rng(RANDOM_STATE)
    if len(X) > sample:
        idx = rng.choice(len(X), size=sample, replace=False)
        X = X.iloc[np.sort(idx)]

    log.info("computing global SHAP for '%s' on %d held-out rows …", task, len(X))
    explainer = shap.TreeExplainer(pipeline.named_steps["model"],
                                   feature_perturbation="tree_path_dependent")
    transformed = _transform(pipeline, X)
    values = np.asarray(explainer.shap_values(transformed, check_additivity=False))
    base_value = float(np.asarray(explainer.expected_value).ravel()[0])

    mean_abs = np.abs(values).mean(axis=0)
    order = np.argsort(mean_abs)[::-1]

    ranking = [
        {
            "feature": features[i],
            "label": (catalog[features[i]].label if features[i] in catalog
                      else features[i].replace("_", " ").title()),
            "unit": catalog[features[i]].unit if features[i] in catalog else "",
            "group": catalog[features[i]].group if features[i] in catalog else "other",
            "mean_abs_shap": float(mean_abs[i]),
            "mean_shap": float(values[:, i].mean()),
        }
        for i in order
    ]

    raw = X.to_numpy(dtype="float64")
    summary, dependence = [], []
    for i in order[:TOP_FEATURES]:
        feature_values = raw[:, i]
        shap_col = values[:, i]

        step = max(1, len(feature_values) // SUMMARY_POINTS)
        summary.append({
            "feature": features[i],
            "label": ranking[list(order).index(i)]["label"],
            "points": [
                {"value": float(v), "shap": float(s)}
                for v, s in zip(feature_values[::step], shap_col[::step])
            ],
        })

        finite = np.isfinite(feature_values)
        if finite.sum() < DEPENDENCE_BINS * 2:
            continue
        quantiles = np.unique(np.nanquantile(feature_values[finite],
                                             np.linspace(0, 1, DEPENDENCE_BINS + 1)))
        if len(quantiles) < 3:
            continue
        bins = np.clip(np.digitize(feature_values, quantiles[1:-1]), 0, len(quantiles) - 2)
        rows = []
        for b in range(len(quantiles) - 1):
            mask = bins == b
            if mask.sum() < 5:
                continue
            rows.append({
                "bin_low": float(quantiles[b]),
                "bin_high": float(quantiles[b + 1]),
                "value": float(np.nanmean(feature_values[mask])),
                "mean_shap": float(np.mean(shap_col[mask])),
                "count": int(mask.sum()),
            })
        dependence.append({
            "feature": features[i],
            "label": ranking[list(order).index(i)]["label"],
            "unit": catalog[features[i]].unit if features[i] in catalog else "",
            "bins": rows,
        })

    return {
        "task": task,
        "n_samples": int(len(X)),
        "sample_window": "test split (held out from training and tuning)",
        "base_value": base_value,
        "ranking": ranking,
        "summary": summary,
        "dependence": dependence,
        "method": "shap.TreeExplainer (tree_path_dependent) on the tuned Random Forest",
    }


def write_global(task: str, payload: dict) -> None:
    path = REPORTS_DIR / f"shap_{task}.json"
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    log.info("global SHAP → %s (top: %s)", path.name,
             ", ".join(r["feature"] for r in payload["ranking"][:5]))
