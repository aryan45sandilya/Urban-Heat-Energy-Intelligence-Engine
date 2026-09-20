"""Stage 3b — exploratory data analysis.

Produces two things from the *real* processed datasets:

* `reports/eda_heat.json` / `reports/eda_energy.json` — the numbers behind every
  chart the product renders. The frontend plots these arrays directly, so a chart
  in the UI is the same computation as a chart in the repository.
* `reports/figures/*.png` — static figures for the written report.

Only analyses that answer a question are included. There is no chart here that
exists to fill space.
"""
from __future__ import annotations

import json

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from .config import FIGURES_DIR, REPORTS_DIR
from .features import (
    ENERGY_FEATURES, ENERGY_TARGET, HEAT_FEATURES, HEAT_TARGET,
    add_time_features, engineer_heat_features,
)
from .utils import get_logger

log = get_logger(__name__)

INK = "#1c1a17"
EMBER = "#c2410c"
COPPER = "#b45309"
SAGE = "#4d7c5f"
SLATE = "#6b7280"


def _style():
    plt.rcParams.update({
        "figure.facecolor": "white", "axes.facecolor": "white",
        "axes.edgecolor": "#d6d0c7", "axes.labelcolor": INK,
        "text.color": INK, "xtick.color": SLATE, "ytick.color": SLATE,
        "axes.grid": True, "grid.color": "#ece7df", "grid.linewidth": 0.8,
        "axes.spines.top": False, "axes.spines.right": False,
        "font.size": 9, "axes.titlesize": 11, "figure.dpi": 130,
    })


def _histogram(series: pd.Series, bins: int = 60) -> list[dict]:
    values = series.dropna().to_numpy()
    counts, edges = np.histogram(values, bins=bins)
    return [
        {"low": float(edges[i]), "high": float(edges[i + 1]),
         "mid": float((edges[i] + edges[i + 1]) / 2), "count": int(counts[i])}
        for i in range(len(counts))
    ]


def _binned_relationship(df: pd.DataFrame, x: str, y: str, bins: int = 20) -> list[dict]:
    """Mean of `y` within quantile bins of `x` — an honest smoothing of a scatter."""
    sub = df[[x, y]].dropna()
    if sub.empty:
        return []
    edges = np.unique(np.quantile(sub[x], np.linspace(0, 1, bins + 1)))
    if len(edges) < 3:
        return []
    idx = np.clip(np.digitize(sub[x].to_numpy(), edges[1:-1]), 0, len(edges) - 2)
    out = []
    for b in range(len(edges) - 1):
        mask = idx == b
        if mask.sum() < 20:
            continue
        slice_ = sub.iloc[mask]
        out.append({
            "x": float(slice_[x].mean()),
            "x_low": float(edges[b]), "x_high": float(edges[b + 1]),
            "y": float(slice_[y].mean()),
            "y_p25": float(slice_[y].quantile(0.25)),
            "y_p75": float(slice_[y].quantile(0.75)),
            "count": int(mask.sum()),
        })
    return out


# ═════════════════════════════════════════════════════════════════════════════
# Heat EDA
# ═════════════════════════════════════════════════════════════════════════════
def heat_eda(dataset: pd.DataFrame, max_rows: int = 800_000) -> dict:
    # EDA reads the full record for coverage and target statistics, but the
    # engineered frame — 35 float columns over four million rows — is thinned by
    # a regular stride so it fits comfortably in memory. A stride preserves the
    # diurnal and seasonal structure these charts are about.
    stride = max(1, len(dataset) // max_rows)
    df = engineer_heat_features(dataset.iloc[::stride].reset_index(drop=True))

    diurnal = []
    for urban_class in ("urban", "suburban", "rural"):
        sub = df[df["urban_class"] == urban_class]
        if sub.empty:
            continue
        grouped = sub.groupby("hour_local")[HEAT_TARGET].agg(["mean", "std", "count"])
        diurnal.append({
            "class": urban_class,
            "points": [{"hour": int(h), "mean": float(r["mean"]),
                        "std": float(r["std"]), "count": int(r["count"])}
                       for h, r in grouped.iterrows()],
        })

    monthly = df.groupby("month")[HEAT_TARGET].agg(["mean", "std", "count"])
    seasonal = [{"month": int(m), "mean": float(r["mean"]), "std": float(r["std"]),
                 "count": int(r["count"])} for m, r in monthly.iterrows()]

    summer_night = df[(df["season"] == 2) & (df["is_night"] == 1)]

    correlations = (df[HEAT_FEATURES + [HEAT_TARGET]]
                    .sample(min(len(df), 200_000), random_state=0)
                    .corr(numeric_only=True)[HEAT_TARGET]
                    .drop(HEAT_TARGET).dropna()
                    .sort_values(key=np.abs, ascending=False))

    station_means = (df.groupby(["station_id", "station_name", "urban_class",
                                 "lat", "lon", "building_count_km2_3km",
                                 "impervious_fraction_1km", "green_fraction_1km"],
                                observed=True)[HEAT_TARGET]
                       .agg(["mean", "count"]).reset_index())
    station_means = station_means[station_means["count"] >= 500]

    # Coverage and the target distribution are reported over the complete
    # record, not the thinned analysis frame.
    periods = pd.to_datetime(dataset["ts_utc"], utc=True).dt.to_period("M").astype(str)
    coverage = periods.value_counts().sort_index().reset_index()
    coverage.columns = ["period", "rows"]

    payload = {
        "task": "heat",
        "rows": int(len(dataset)),
        "analysis_rows": int(len(df)),
        "analysis_stride": int(stride),
        "sites": int(dataset["station_id"].nunique()),
        "period": {"start": str(dataset["ts_utc"].min()), "end": str(dataset["ts_utc"].max())},
        "target": {
            "name": HEAT_TARGET, "unit": "°C",
            "mean": float(dataset[HEAT_TARGET].mean()), "std": float(dataset[HEAT_TARGET].std()),
            "p01": float(dataset[HEAT_TARGET].quantile(0.01)),
            "p50": float(dataset[HEAT_TARGET].quantile(0.50)),
            "p99": float(dataset[HEAT_TARGET].quantile(0.99)),
            "skew": float(dataset[HEAT_TARGET].skew()),
        },
        "distribution": _histogram(dataset[HEAT_TARGET]),
        "diurnal_by_class": diurnal,
        "seasonal": seasonal,
        "summer_night": {
            "rows": int(len(summer_night)),
            "by_class": {
                k: {"mean": float(v["mean"]), "count": int(v["count"])}
                for k, v in summer_night.groupby("urban_class")[HEAT_TARGET]
                                        .agg(["mean", "count"]).iterrows()
            },
        },
        "relationships": {
            "building_density_3km": _binned_relationship(summer_night, "building_count_km2_3km", HEAT_TARGET),
            "impervious_fraction_1km": _binned_relationship(summer_night, "impervious_fraction_1km", HEAT_TARGET),
            "green_fraction_1km": _binned_relationship(summer_night, "green_fraction_1km", HEAT_TARGET),
            "wind_speed_ms": _binned_relationship(df, "wind_speed_ms", HEAT_TARGET),
            "sky_cover_oktas": _binned_relationship(df, "sky_cover_oktas", HEAT_TARGET),
            "t_ref_c": _binned_relationship(df, "t_ref_c", HEAT_TARGET),
        },
        "correlations": [{"feature": k, "corr": float(v)} for k, v in correlations.head(20).items()],
        "station_means": station_means.rename(columns={"mean": "mean_uhi_c", "count": "hours"})
                                      .to_dict(orient="records"),
        "coverage_by_month": coverage.to_dict(orient="records"),
        "missingness": {k: round(float(v), 5) for k, v in
                        dataset.isna().mean().items() if v > 0},
    }

    _plot_heat(df, payload)
    (REPORTS_DIR / "eda_heat.json").write_text(json.dumps(payload, indent=2, default=str),
                                               encoding="utf-8")
    log.info("heat EDA → eda_heat.json · mean ΔT %.2f °C · summer-night urban %.2f °C",
             payload["target"]["mean"],
             payload["summer_night"]["by_class"].get("urban", {}).get("mean", float("nan")))
    return payload


def _plot_heat(df: pd.DataFrame, payload: dict) -> None:
    _style()

    fig, ax = plt.subplots(figsize=(6.4, 3.4))
    ax.hist(df[HEAT_TARGET], bins=80, color=EMBER, alpha=0.85, edgecolor="none")
    ax.axvline(0, color=INK, lw=1, ls="--")
    ax.set_xlabel("Urban heat island intensity ΔT (°C)")
    ax.set_ylabel("Site-hours")
    ax.set_title("Distribution of hourly urban–rural temperature anomaly")
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "heat_target_distribution.png")
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(6.4, 3.4))
    for entry, colour in zip(payload["diurnal_by_class"], (EMBER, COPPER, SAGE)):
        hours = [p["hour"] for p in entry["points"]]
        means = [p["mean"] for p in entry["points"]]
        ax.plot(hours, means, color=colour, lw=2, label=entry["class"])
    ax.axhline(0, color=SLATE, lw=0.8)
    ax.set_xlabel("Hour of day (US Eastern)")
    ax.set_ylabel("Mean ΔT (°C)")
    ax.set_title("Diurnal cycle of the heat island, by site class")
    ax.legend(frameon=False)
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "heat_diurnal_cycle.png")
    plt.close(fig)

    rel = payload["relationships"]["building_density_3km"]
    if rel:
        fig, ax = plt.subplots(figsize=(6.4, 3.4))
        ax.plot([p["x"] for p in rel], [p["y"] for p in rel], "o-", color=EMBER, lw=2, ms=4)
        ax.fill_between([p["x"] for p in rel], [p["y_p25"] for p in rel],
                        [p["y_p75"] for p in rel], color=EMBER, alpha=0.15)
        ax.set_xlabel("Building density within 3 km (buildings/km²)")
        ax.set_ylabel("Mean ΔT on summer nights (°C)")
        ax.set_title("Built-up density against night-time heat island")
        fig.tight_layout()
        fig.savefig(FIGURES_DIR / "heat_density_relationship.png")
        plt.close(fig)

    fig, ax = plt.subplots(figsize=(6.4, 3.6))
    corr = payload["correlations"][:14][::-1]
    ax.barh([c["feature"] for c in corr], [c["corr"] for c in corr],
            color=[EMBER if c["corr"] > 0 else SAGE for c in corr])
    ax.axvline(0, color=INK, lw=0.8)
    ax.set_xlabel("Pearson correlation with ΔT")
    ax.set_title("Linear association of each feature with the target")
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "heat_correlations.png")
    plt.close(fig)


# ═════════════════════════════════════════════════════════════════════════════
# Energy EDA
# ═════════════════════════════════════════════════════════════════════════════
def energy_eda(dataset: pd.DataFrame) -> dict:
    df = add_time_features(dataset)

    hourly = df.groupby(["season", "hour_local"])[ENERGY_TARGET].mean().reset_index()
    zone_stats = (df.groupby(["zone", "zone_name"])[ENERGY_TARGET]
                    .agg(mean_mw="mean", max_mw="max", min_mw="min", hours="count")
                    .reset_index())
    monthly = (df.groupby("month")[ENERGY_TARGET]
                 .agg(mean_mw="mean", max_mw="max").reset_index())

    payload = {
        "task": "energy",
        "rows": int(len(df)),
        "zones": int(df["zone"].nunique()),
        "period": {"start": str(df["ts_utc"].min()), "end": str(df["ts_utc"].max())},
        "target": {
            "name": ENERGY_TARGET, "unit": "MW",
            "mean": float(df[ENERGY_TARGET].mean()), "std": float(df[ENERGY_TARGET].std()),
            "min": float(df[ENERGY_TARGET].min()), "max": float(df[ENERGY_TARGET].max()),
        },
        "distribution": _histogram(df[ENERGY_TARGET], bins=50),
        "load_vs_temperature": _binned_relationship(df, "temp_c", ENERGY_TARGET, bins=28),
        "diurnal_by_season": [
            {"season": int(s),
             "points": [{"hour": int(r.hour_local), "mean": float(r.load_mw)}
                        for r in hourly[hourly["season"] == s].itertuples()]}
            for s in sorted(hourly["season"].unique())
        ],
        "monthly": [{"month": int(r.month), "mean": float(r.mean_mw), "max": float(r.max_mw)}
                    for r in monthly.itertuples()],
        "by_zone": [
            {"zone": r.zone, "zone_name": r.zone_name, "mean_mw": float(r.mean_mw),
             "max_mw": float(r.max_mw), "min_mw": float(r.min_mw), "hours": int(r.hours)}
            for r in zone_stats.itertuples()
        ],
        "weekend_effect": {
            "weekday_mean_mw": float(df[df["is_weekend"] == 0][ENERGY_TARGET].mean()),
            "weekend_mean_mw": float(df[df["is_weekend"] == 1][ENERGY_TARGET].mean()),
        },
        "missingness": {k: round(float(v), 5) for k, v in dataset.isna().mean().items() if v > 0},
    }

    _style()
    rel = payload["load_vs_temperature"]
    fig, ax = plt.subplots(figsize=(6.4, 3.4))
    ax.plot([p["x"] for p in rel], [p["y"] for p in rel], "o-", color=COPPER, lw=2, ms=4)
    ax.set_xlabel("Air temperature (°C)")
    ax.set_ylabel("Mean zonal load (MW)")
    ax.set_title("Electricity demand against temperature")
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "energy_temperature_response.png")
    plt.close(fig)

    (REPORTS_DIR / "eda_energy.json").write_text(json.dumps(payload, indent=2, default=str),
                                                 encoding="utf-8")
    log.info("energy EDA → eda_energy.json · %d rows · %d zones", payload["rows"], payload["zones"])
    return payload
