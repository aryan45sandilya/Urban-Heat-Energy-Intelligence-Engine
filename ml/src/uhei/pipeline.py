"""End-to-end pipeline runner.

    python -m uhei.pipeline                 # full run, reusing cached downloads
    python -m uhei.pipeline --stage train   # rebuild models only
    python -m uhei.pipeline --force         # re-download and rebuild everything

Stages run in order and each one is idempotent: raw downloads, the station
network, the two datasets, validation, EDA, training, SHAP and the hotspot layer.
"""
from __future__ import annotations

import argparse
import gc
import json
import sys

import joblib
import pandas as pd

from . import (
    build_energy, build_heat, build_stations, eda, explain, finalize, hotspots, train, validate,
)
from .config import MODELS_DIR, REPORTS_DIR
from .features import HEAT_FEATURES, engineer_heat_features
from .utils import get_logger

log = get_logger("uhei.pipeline")

STAGES = ("network", "datasets", "validate", "eda", "train", "finalize", "explain", "hotspots")


def _banner(text: str) -> None:
    log.info("")
    log.info("═══ %s %s", text.upper(), "═" * max(0, 58 - len(text)))


def _feature_meta(task: str, dataset: pd.DataFrame) -> list[dict]:
    """Recompute the UI's feature catalogue against the shipped model's split."""
    import joblib

    bundle = joblib.load(MODELS_DIR / f"{task}_model.joblib")
    if task == "heat":
        split = train.chronological_split(dataset, HEAT_FEATURES, "uhi_intensity_c",
                                          engineer=engineer_heat_features)
    else:
        from .features import ENERGY_FEATURES, engineer_energy_features
        codes = bundle.get("zone_codes")
        split = train.chronological_split(
            dataset, ENERGY_FEATURES, "load_mw",
            engineer=lambda frame: engineer_energy_features(frame, zone_codes=codes),
        )
    return train.feature_metadata(task, split, dataset)


def run(stages: tuple[str, ...] = STAGES, force: bool = False,
        rf_iter: int = 24, skip_energy: bool = False,
        tasks: tuple[str, ...] = ("heat", "energy")) -> dict:
    """Run the pipeline.

    `tasks` narrows the model stages to one prediction task. Training both tasks
    in a single process holds two large frames and two forests in memory at once;
    on a memory-constrained machine, running them as separate invocations is the
    difference between finishing and being killed by the allocator.
    """
    summary: dict = {}
    do_heat = "heat" in tasks
    do_energy = "energy" in tasks and not skip_energy

    if "network" in stages:
        _banner("stage 1 · observation network")
        stations = build_stations.build(force=force)
        summary["stations"] = len(stations)
    else:
        stations = build_stations.build()

    # Datasets are loaded on demand and released as soon as a stage is done, so
    # a single-task run never pays for the other task's frame.
    cache: dict[str, pd.DataFrame | None] = {}

    def dataset(task: str) -> pd.DataFrame | None:
        if task not in cache:
            rebuild = "datasets" in stages
            if task == "heat":
                cache[task] = build_heat.build(force=force and rebuild)
            else:
                cache[task] = None if skip_energy else build_energy.build(force=force and rebuild)
        return cache[task]

    if "datasets" in stages:
        _banner("stage 2 · dataset construction")

    if do_heat:
        summary["heat_rows"] = len(dataset("heat"))
    if do_energy:
        frame = dataset("energy")
        summary["energy_rows"] = 0 if frame is None else len(frame)

    if "validate" in stages:
        _banner("stage 3 · validation & leakage audit")
        report = validate.run(dataset("heat"), dataset("energy") if do_energy else None)
        summary["validation_passed"] = report["passed"]

    if "eda" in stages:
        _banner("stage 3b · exploratory analysis")
        if do_heat:
            eda.heat_eda(dataset("heat"))
        if do_energy and dataset("energy") is not None:
            eda.energy_eda(dataset("energy"))

    if "train" in stages:
        _banner("stage 4 · model development")
        if do_heat:
            report = train.train_heat(dataset("heat"), n_iter=rf_iter)
            summary["heat_test_r2"] = report["selected"]["metrics"]["test"]["r2"]
            del report
        if do_energy and dataset("energy") is not None:
            report = train.train_energy(dataset("energy"), n_iter=max(12, rf_iter - 4))
            summary["energy_test_r2"] = report["selected"]["metrics"]["test"]["r2"]
            del report
        gc.collect()

    if "finalize" in stages:
        _banner("stage 4b · final selection & segment metrics")
        finals: dict[str, dict | None] = {}
        for task, wanted in (("heat", do_heat), ("energy", do_energy)):
            path = REPORTS_DIR / f"model_report_{task}.json"
            if wanted and path.exists():
                finals[task] = finalize.finalize(task)
                metrics = finals[task]["selected"]["metrics"]
                summary[f"{task}_test_r2"] = metrics["test"]["r2"]
                summary[f"{task}_artifact_mb"] = metrics.get("artifact_mb")
            elif path.exists():
                # Not re-selected this run; carry the existing report into metadata
                # so a single-task run does not erase the other task's entry.
                finals[task] = json.loads(path.read_text(encoding="utf-8"))
            else:
                finals[task] = None

        # Metadata must reflect the shipped models, not the pre-selection ones.
        train.write_metadata(
            {**finals["heat"], "_feature_metadata": _feature_meta("heat", dataset("heat"))}
            if finals.get("heat") else None,
            {**finals["energy"], "_feature_metadata": _feature_meta("energy", dataset("energy"))}
            if finals.get("energy") and dataset("energy") is not None else None,
            stations,
        )
        gc.collect()

    if "explain" in stages:
        _banner("stage 5 · SHAP explainability")
        if do_heat and (MODELS_DIR / "heat_model.joblib").exists():
            bundle = joblib.load(MODELS_DIR / "heat_model.joblib")
            split = train.chronological_split(
                dataset("heat"), HEAT_FEATURES, "uhi_intensity_c",
                engineer=engineer_heat_features)
            explain.write_global("heat", explain.global_explanation(
                bundle["pipeline"], bundle["features"], split.X_test, "heat"))
            del bundle, split
            gc.collect()

        energy_path = MODELS_DIR / "energy_model.joblib"
        if do_energy and dataset("energy") is not None and energy_path.exists():
            from .features import ENERGY_FEATURES, engineer_energy_features
            ebundle = joblib.load(energy_path)
            codes = ebundle.get("zone_codes")
            esplit = train.chronological_split(
                dataset("energy"), ENERGY_FEATURES, "load_mw",
                engineer=lambda frame: engineer_energy_features(frame, zone_codes=codes),
            )
            explain.write_global("energy", explain.global_explanation(
                ebundle["pipeline"], ebundle["features"], esplit.X_test, "energy"))
            del ebundle, esplit
            gc.collect()

    if "hotspots" in stages:
        _banner("stage 6 · geospatial layer")
        bundle = joblib.load(MODELS_DIR / "heat_model.joblib")
        payload = hotspots.build(bundle)
        summary["hotspot_sites"] = payload["summary"]["n_sites"]

    _banner("pipeline complete")
    (REPORTS_DIR / "pipeline_summary.json").write_text(
        json.dumps(summary, indent=2, default=str), encoding="utf-8")
    for key, value in summary.items():
        log.info("  %-22s %s", key, value)
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="UHEI machine-learning pipeline")
    parser.add_argument("--stage", nargs="*", choices=STAGES, default=list(STAGES),
                        help="stages to run (default: all)")
    parser.add_argument("--force", action="store_true",
                        help="ignore caches and rebuild from the source APIs")
    parser.add_argument("--rf-iter", type=int, default=24,
                        help="RandomizedSearchCV iterations for the forest")
    parser.add_argument("--skip-energy", action="store_true",
                        help="build and train the urban-heat task only")
    parser.add_argument("--task", nargs="*", choices=("heat", "energy"),
                        default=["heat", "energy"],
                        help="restrict the model stages to one prediction task; "
                             "running the two as separate invocations halves peak memory")
    args = parser.parse_args(argv)

    run(tuple(args.stage), force=args.force, rf_iter=args.rf_iter,
        skip_energy=args.skip_energy, tasks=tuple(args.task))
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
