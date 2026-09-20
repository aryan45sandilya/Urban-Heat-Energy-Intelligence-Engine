"""Stage 3 — data validation and leakage auditing.

Every check returns a structured result; hard failures raise so a bad dataset
can never reach training silently. The full report is written to
`reports/data_validation.json` and is surfaced in the product's Methodology page.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from .config import DOMAIN_BBOX, REPORTS_DIR, TRAIN_END, VALID_END, UHI_PLAUSIBLE_RANGE
from .features import ENERGY_FEATURES, ENERGY_TARGET, HEAT_FEATURES, HEAT_TARGET
from .utils import get_logger

log = get_logger(__name__)

VALIDATION_REPORT_PATH = REPORTS_DIR / "data_validation.json"

# Columns that are *derived from the target* and must never be offered as
# features to the heat model. `t_site_c` is one of the two terms in ΔT.
HEAT_FORBIDDEN_FEATURES = {"t_site_c", "uhi_intensity_c"}
ENERGY_FORBIDDEN_FEATURES = {"load_mw"}

# Physical plausibility gates applied at the dataset level.
RANGE_RULES: dict[str, tuple[float, float]] = {
    "t_ref_c": (-50, 55),
    "t_site_c": (-50, 55),
    "dewpoint_ref_c": (-60, 40),
    "wind_speed_ms": (0, 75),
    "sky_cover_oktas": (0, 8),
    "slp_hpa": (900, 1085),
    "precip_1h_mm": (0, 200),
    "temp_c": (-50, 55),
    "dewpoint_c": (-60, 40),
    "load_mw": (1, 40000),
    "building_plan_fraction_1km": (0, 1),
    "green_fraction_1km": (0, 1),
    "water_fraction_1km": (0, 1),
    "impervious_fraction_1km": (0, 1),
}


@dataclass
class Check:
    name: str
    passed: bool
    severity: str            # "error" | "warning" | "info"
    detail: str
    data: dict[str, Any] = field(default_factory=dict)


def _range_checks(df: pd.DataFrame) -> list[Check]:
    checks = []
    for column, (lo, hi) in RANGE_RULES.items():
        if column not in df.columns:
            continue
        series = df[column].dropna()
        if series.empty:
            continue
        bad = int((~series.between(lo, hi)).sum())
        checks.append(Check(
            name=f"range::{column}",
            passed=bad == 0,
            severity="error" if bad else "info",
            detail=(f"{bad} value(s) outside [{lo}, {hi}]" if bad
                    else f"all {len(series)} values within [{lo}, {hi}]"),
            data={"violations": bad, "min": float(series.min()), "max": float(series.max())},
        ))
    return checks


def _missing_checks(df: pd.DataFrame, critical: list[str]) -> list[Check]:
    checks = []
    fractions = df.isna().mean().sort_values(ascending=False)
    checks.append(Check(
        name="missing::overview",
        passed=True,
        severity="info",
        detail="missing-value fraction per column",
        data={k: round(float(v), 5) for k, v in fractions.items() if v > 0},
    ))
    for column in critical:
        if column not in df.columns:
            checks.append(Check(f"missing::{column}", False, "error", "column absent"))
            continue
        frac = float(df[column].isna().mean())
        checks.append(Check(
            name=f"missing::{column}",
            passed=frac == 0.0,
            severity="error" if frac > 0 else "info",
            detail=f"{frac:.4%} missing",
            data={"fraction": frac},
        ))
    return checks


def _duplicate_check(df: pd.DataFrame, keys: list[str]) -> Check:
    dupes = int(df.duplicated(subset=keys).sum())
    return Check(
        name="duplicates::" + "+".join(keys),
        passed=dupes == 0,
        severity="error" if dupes else "info",
        detail=f"{dupes} duplicate rows on {keys}",
        data={"duplicates": dupes},
    )


def _timestamp_checks(df: pd.DataFrame) -> list[Check]:
    ts = pd.to_datetime(df["ts_utc"], utc=True)
    hours = ts.dt.floor("h")
    aligned = int((ts != hours).sum())
    return [
        Check("timestamp::timezone_aware", ts.dt.tz is not None, "error",
              f"tz={ts.dt.tz}"),
        Check("timestamp::hour_aligned", aligned == 0, "error",
              f"{aligned} timestamps not on an exact hour"),
        Check("timestamp::span", True, "info",
              f"{ts.min()} → {ts.max()}",
              {"start": str(ts.min()), "end": str(ts.max()),
               "distinct_hours": int(hours.nunique())}),
    ]


def _geographic_check(df: pd.DataFrame) -> Check:
    bbox = DOMAIN_BBOX
    inside = (df["lat"].between(bbox["lat_min"], bbox["lat_max"])
              & df["lon"].between(bbox["lon_min"], bbox["lon_max"]))
    outside = int((~inside).sum())
    return Check(
        name="geography::inside_domain",
        passed=outside == 0,
        severity="error" if outside else "info",
        detail=f"{outside} rows outside the study bounding box",
        data={"outside": outside},
    )


def _outlier_check(df: pd.DataFrame, target: str) -> Check:
    series = df[target].dropna()
    q1, q3 = series.quantile([0.25, 0.75])
    iqr = q3 - q1
    lo, hi = q1 - 3 * iqr, q3 + 3 * iqr
    extreme = int((~series.between(lo, hi)).sum())
    return Check(
        name=f"outliers::{target}",
        passed=True,
        severity="info",
        detail=f"{extreme} values beyond 3×IQR — retained (real weather is heavy-tailed)",
        data={
            "mean": float(series.mean()), "std": float(series.std()),
            "min": float(series.min()), "max": float(series.max()),
            "p01": float(series.quantile(0.01)), "p50": float(series.quantile(0.50)),
            "p99": float(series.quantile(0.99)),
            "beyond_3iqr": extreme, "skew": float(series.skew()),
        },
    )


def _leakage_checks(df: pd.DataFrame, features: list[str], target: str,
                    forbidden: set[str]) -> list[Check]:
    checks = []

    overlap = sorted(set(features) & forbidden)
    checks.append(Check(
        name="leakage::forbidden_features",
        passed=not overlap,
        severity="error",
        detail=("no target-derived column is used as a feature" if not overlap
                else f"target-derived columns present in features: {overlap}"),
        data={"overlap": overlap},
    ))

    checks.append(Check(
        name="leakage::target_not_a_feature",
        passed=target not in features,
        severity="error",
        detail=f"target '{target}' {'absent from' if target not in features else 'PRESENT IN'} features",
    ))

    present = [f for f in features if f in df.columns]
    sample = df[present + [target]].dropna()
    if len(sample) > 200_000:
        sample = sample.sample(200_000, random_state=0)
    corr = sample.corr(numeric_only=True)[target].drop(labels=[target], errors="ignore").abs()
    suspicious = corr[corr > 0.98].sort_values(ascending=False)
    checks.append(Check(
        name="leakage::near_perfect_correlation",
        passed=suspicious.empty,
        severity="error" if not suspicious.empty else "info",
        detail=("no feature correlates > 0.98 with the target" if suspicious.empty
                else f"suspiciously predictive features: {list(suspicious.index)}"),
        data={"top_correlations": {k: round(float(v), 4) for k, v in
                                   corr.sort_values(ascending=False).head(8).items()}},
    ))
    return checks


def _split_checks(df: pd.DataFrame) -> list[Check]:
    ts = pd.to_datetime(df["ts_utc"], utc=True)
    train_end = pd.Timestamp(TRAIN_END, tz="UTC") + pd.Timedelta(days=1)
    valid_end = pd.Timestamp(VALID_END, tz="UTC") + pd.Timedelta(days=1)

    train = ts < train_end
    valid = (ts >= train_end) & (ts < valid_end)
    test = ts >= valid_end

    counts = {"train": int(train.sum()), "valid": int(valid.sum()), "test": int(test.sum())}
    checks = [Check(
        name="split::sizes",
        passed=all(v > 0 for v in counts.values()),
        severity="error",
        detail=f"train/valid/test = {counts['train']}/{counts['valid']}/{counts['test']}",
        data=counts,
    )]

    if counts["train"] and counts["valid"] and counts["test"]:
        ordered = (ts[train].max() < ts[valid].min()) and (ts[valid].max() < ts[test].min())
        checks.append(Check(
            name="split::chronological_and_disjoint",
            passed=bool(ordered),
            severity="error",
            detail=("splits are strictly time-ordered with no overlap" if ordered
                    else "SPLIT OVERLAP DETECTED"),
            data={
                "train_end": str(ts[train].max()),
                "valid_start": str(ts[valid].min()), "valid_end": str(ts[valid].max()),
                "test_start": str(ts[test].min()), "test_end": str(ts[test].max()),
            },
        ))
    return checks


def validate_heat(df: pd.DataFrame) -> list[Check]:
    checks: list[Check] = [Check("dataset::rows", len(df) > 10_000, "error",
                                 f"{len(df)} rows, {df['station_id'].nunique()} sites")]
    checks += _missing_checks(df, ["uhi_intensity_c", "t_ref_c", "dewpoint_ref_c", "ts_utc"])
    checks.append(_duplicate_check(df, ["station_id", "ts_utc"]))
    checks += _timestamp_checks(df)
    checks.append(_geographic_check(df))
    checks += _range_checks(df)
    checks.append(_outlier_check(df, HEAT_TARGET))
    checks += _leakage_checks(df, HEAT_FEATURES, HEAT_TARGET, HEAT_FORBIDDEN_FEATURES)
    checks += _split_checks(df)

    lo, hi = UHI_PLAUSIBLE_RANGE
    outside = int((~df[HEAT_TARGET].between(lo, hi)).sum())
    checks.append(Check("physical::uhi_bounds", outside == 0, "error",
                        f"{outside} ΔT values outside [{lo}, {hi}] °C"))

    refs = int((df["n_reference_stations"] < 2).sum())
    checks.append(Check("physical::reference_count", refs == 0, "error",
                        f"{refs} rows built from fewer than 2 rural references"))
    return checks


def validate_energy(df: pd.DataFrame) -> list[Check]:
    checks: list[Check] = [Check("dataset::rows", len(df) > 10_000, "error",
                                 f"{len(df)} rows, {df['zone'].nunique()} zones")]
    checks += _missing_checks(df, ["load_mw", "temp_c", "dewpoint_c", "ts_utc"])
    checks.append(_duplicate_check(df, ["zone", "ts_utc"]))
    checks += _timestamp_checks(df)
    checks += _range_checks(df)
    checks.append(_outlier_check(df, ENERGY_TARGET))
    checks += _leakage_checks(df, [f for f in ENERGY_FEATURES if f != "zone_code"],
                              ENERGY_TARGET, ENERGY_FORBIDDEN_FEATURES)
    checks += _split_checks(df)
    return checks


def run(heat: pd.DataFrame, energy: pd.DataFrame | None = None,
        strict: bool = True) -> dict:
    sections = {"heat": validate_heat(heat)}
    if energy is not None and not energy.empty:
        sections["energy"] = validate_energy(energy)

    report: dict[str, Any] = {"generated_at": pd.Timestamp.utcnow().isoformat(), "sections": {}}
    failures = []
    for name, checks in sections.items():
        report["sections"][name] = [asdict(c) for c in checks]
        for check in checks:
            status = "PASS" if check.passed else check.severity.upper()
            level = log.info if check.passed or check.severity != "error" else log.error
            level("[%s] %-42s %-5s %s", name, check.name, status, check.detail)
            if not check.passed and check.severity == "error":
                failures.append(f"{name}::{check.name} — {check.detail}")

    report["passed"] = not failures
    report["failures"] = failures
    VALIDATION_REPORT_PATH.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    log.info("validation report → %s (%d hard failure(s))",
             VALIDATION_REPORT_PATH.name, len(failures))

    if failures and strict:
        raise ValueError("Data validation failed:\n  - " + "\n  - ".join(failures))
    return report
