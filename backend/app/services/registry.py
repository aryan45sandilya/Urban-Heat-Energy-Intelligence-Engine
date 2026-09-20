"""Artifact registry — loads every trained artifact once, at process start.

The API is a thin, honest wrapper around these artifacts. If an artifact is
missing the affected endpoints return 503 with an explicit message; they never
fall back to a made-up number.
"""
from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any

import joblib
import pandas as pd

from app.core.config import get_settings
from app.core.errors import ArtifactUnavailable
from uhei.explain import LocalExplainer
from uhei.hotspots import SITE_COLUMNS

log = logging.getLogger("uhei.registry")


class Registry:
    """Process-wide singleton holding models, metadata and reference tables."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.settings = get_settings()
        self.models: dict[str, dict] = {}
        self.explainers: dict[str, LocalExplainer] = {}
        self.reports: dict[str, Any] = {}
        self.sites: pd.DataFrame | None = None
        self.zones: list[dict] = []
        self.loaded_at: str | None = None
        self.problems: list[str] = []

    # ── loading ──────────────────────────────────────────────────────────────
    def load(self) -> None:
        with self._lock:
            self.problems.clear()
            self._load_models()
            self._load_reports()
            self._load_sites()
            self._load_zones()
            self.loaded_at = pd.Timestamp.utcnow().isoformat()
            log.info("registry ready · models=%s · reports=%s · sites=%s",
                     sorted(self.models), sorted(self.reports),
                     0 if self.sites is None else len(self.sites))
            for problem in self.problems:
                log.warning("registry: %s", problem)

    def _load_models(self) -> None:
        for task in ("heat", "energy"):
            path = self.settings.models_dir / f"{task}_model.joblib"
            if not path.exists():
                self.problems.append(f"{task} model artifact not found at {path}")
                continue
            bundle = joblib.load(path)
            self.models[task] = bundle
            try:
                self.explainers[task] = LocalExplainer(
                    bundle["pipeline"], bundle["features"], task)
            except Exception as exc:  # pragma: no cover - defensive
                self.problems.append(f"SHAP explainer unavailable for {task}: {exc}")

    def _load_reports(self) -> None:
        wanted = {
            "model_metadata": self.settings.models_dir / "model_metadata.json",
            "feature_metadata": self.settings.models_dir / "feature_metadata.json",
            "model_report_heat": self.settings.reports_dir / "model_report_heat.json",
            "model_report_energy": self.settings.reports_dir / "model_report_energy.json",
            "shap_heat": self.settings.reports_dir / "shap_heat.json",
            "shap_energy": self.settings.reports_dir / "shap_energy.json",
            "eda_heat": self.settings.reports_dir / "eda_heat.json",
            "eda_energy": self.settings.reports_dir / "eda_energy.json",
            "hotspots": self.settings.reports_dir / "hotspots.json",
            "validation": self.settings.reports_dir / "data_validation.json",
        }
        for key, path in wanted.items():
            if not path.exists():
                self.problems.append(f"report '{key}' not found at {path}")
                continue
            try:
                self.reports[key] = json.loads(Path(path).read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                self.problems.append(f"report '{key}' is not valid JSON: {exc}")

    def _load_sites(self) -> None:
        hotspots = self.reports.get("hotspots")
        if not hotspots:
            return

        def _site_rows(site_list: list[dict], default_country: str = "US") -> list[dict]:
            out = []
            for site in site_list:
                row = {
                    "station_id": site["station_id"],
                    "station_name": site["name"],
                    "state": site.get("state"),
                    "country": site.get("country", default_country),
                    "lat": site["lat"],
                    "lon": site["lon"],
                    "elevation_m": site["elevation_m"],
                    "urban_class": site["urban_class"],
                }
                row.update(site["morphology"])
                out.append(row)
            return out

        rows = _site_rows(hotspots["sites"], default_country="US")

        # Merge Indian cities if the optional artifact exists.
        india_path = self.settings.reports_dir / "india_cities.json"
        if india_path.exists():
            try:
                india_sites = json.loads(Path(india_path).read_text(encoding="utf-8"))
                rows.extend(_site_rows(india_sites, default_country="IN"))
                log.info("merged %d Indian city sites into site table", len(india_sites))
            except Exception as exc:
                self.problems.append(f"india_cities.json could not be loaded: {exc}")

        frame = pd.DataFrame(rows)
        # A column missing here would not raise at prediction time — the
        # pipeline's imputer would substitute a training median and the site
        # would be scored on someone else's morphology. Fail loudly instead.
        absent = [column for column in SITE_COLUMNS if column not in frame.columns]
        if absent:
            self.problems.append(
                f"hotspots.json is missing site attributes {absent}; the heat model "
                "needs them, so site predictions are disabled. Re-run "
                "`python -m uhei.pipeline --stage hotspots`."
            )
            return
        keep = SITE_COLUMNS + ["country"]
        self.sites = frame[[c for c in keep if c in frame.columns]]

    def _load_zones(self) -> None:
        eda = self.reports.get("eda_energy")
        if not eda:
            return
        codes = (self.models.get("energy") or {}).get("zone_codes", {})
        self.zones = [
            {"zone": z["zone"], "name": z["zone_name"], "code": codes.get(z["zone"]),
             "mean_mw": z["mean_mw"], "max_mw": z["max_mw"], "hours": z["hours"]}
            for z in eda["by_zone"]
        ]

    # ── accessors ────────────────────────────────────────────────────────────
    def model(self, task: str) -> dict:
        bundle = self.models.get(task)
        if bundle is None:
            raise ArtifactUnavailable(
                f"The {task} model has not been trained yet. Run `python -m uhei.pipeline` "
                "to build the artifacts before calling this endpoint.",
                detail={"task": task, "missing_artifact": f"{task}_model.joblib"},
            )
        return bundle

    def explainer(self, task: str) -> LocalExplainer:
        explainer = self.explainers.get(task)
        if explainer is None:
            raise ArtifactUnavailable(
                f"SHAP explanations are not available for the {task} model.",
                detail={"task": task})
        return explainer

    def report(self, key: str) -> Any:
        payload = self.reports.get(key)
        if payload is None:
            raise ArtifactUnavailable(
                f"The report '{key}' has not been generated yet.",
                detail={"report": key})
        return payload

    def site_table(self) -> pd.DataFrame:
        if self.sites is None or self.sites.empty:
            raise ArtifactUnavailable(
                "The station network has not been built yet.",
                detail={"missing_artifact": "hotspots.json"})
        return self.sites

    def site(self, station_id: str) -> pd.Series:
        table = self.site_table()
        match = table[table["station_id"] == station_id]
        if match.empty:
            from app.core.errors import ResourceNotFound
            raise ResourceNotFound(f"Unknown station '{station_id}'.",
                                   detail={"station_id": station_id})
        return match.iloc[0]

    @property
    def ready(self) -> bool:
        return bool(self.models)

    def status(self) -> dict:
        metadata = self.reports.get("model_metadata", {})
        return {
            "ready": self.ready,
            "loaded_at": self.loaded_at,
            "models": sorted(self.models),
            "reports": sorted(self.reports),
            "sites": 0 if self.sites is None else int(len(self.sites)),
            "zones": len(self.zones),
            "trained_at": metadata.get("trained_at"),
            "model_version": metadata.get("version"),
            "problems": list(self.problems),
        }


registry = Registry()
