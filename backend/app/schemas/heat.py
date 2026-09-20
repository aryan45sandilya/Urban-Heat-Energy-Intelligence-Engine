"""Request/response models for the urban-heat task."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import Explanation, ModelStamp


class AtmosphericConditions(BaseModel):
    """Background (rural) atmospheric state. Ranges are physical, not stylistic."""

    t_ref_c: float = Field(..., ge=-45, le=50,
                           description="Background air temperature in the surrounding countryside (°C)")
    relative_humidity_pct: float | None = Field(
        None, ge=1, le=100,
        description="Background relative humidity (%). Supply this or dewpoint_ref_c.")
    dewpoint_ref_c: float | None = Field(
        None, ge=-55, le=40, description="Background dew point (°C)")
    wind_speed_ms: float = Field(2.0, ge=0, le=60, description="Background wind speed (m/s)")
    sky_cover_oktas: float = Field(2.0, ge=0, le=8, description="Cloud cover in eighths")
    slp_hpa: float = Field(1015.0, ge=940, le=1070, description="Sea-level pressure (hPa)")
    precip_1h_mm: float = Field(0.0, ge=0, le=150, description="Rainfall in the past hour (mm)")

    @model_validator(mode="after")
    def _need_a_humidity(self):
        if self.dewpoint_ref_c is None and self.relative_humidity_pct is None:
            raise ValueError("provide either relative_humidity_pct or dewpoint_ref_c")
        if self.dewpoint_ref_c is not None and self.dewpoint_ref_c > self.t_ref_c + 0.5:
            raise ValueError("dew point cannot exceed air temperature")
        return self


class SiteOverrides(BaseModel):
    """Urban-morphology adjustments — the levers of the what-if simulator."""

    building_plan_fraction_1km: float | None = Field(None, ge=0, le=1)
    building_count_km2_1km: float | None = Field(None, ge=0, le=20000)
    building_count_km2_3km: float | None = Field(None, ge=0, le=20000)
    road_length_km_km2_1km: float | None = Field(None, ge=0, le=80)
    green_fraction_1km: float | None = Field(None, ge=0, le=1)
    water_fraction_1km: float | None = Field(None, ge=0, le=1)
    impervious_fraction_1km: float | None = Field(None, ge=0, le=1)

    def as_dict(self) -> dict[str, float]:
        return {k: v for k, v in self.model_dump().items() if v is not None}


class HeatPredictRequest(BaseModel):
    station_id: str = Field(..., description="Site identifier from GET /api/sites")
    timestamp: datetime | None = Field(
        None, description="Moment to predict for (ISO 8601). Defaults to a mid-July night.")
    conditions: AtmosphericConditions
    overrides: SiteOverrides = Field(default_factory=SiteOverrides)
    explain: bool = Field(True, description="Attach the SHAP attribution for this prediction")


class RiskAssessment(BaseModel):
    band: str
    description: str
    heat_index_c: float
    basis: str


class HeatPrediction(BaseModel):
    uhi_intensity_c: float = Field(description="Predicted urban–rural temperature anomaly (°C)")
    site_temperature_c: float = Field(description="Background temperature plus the predicted anomaly")
    background_temperature_c: float
    relative_humidity_pct: float
    heat_index_c: float


class SiteSummary(BaseModel):
    station_id: str
    name: str
    state: str | None = None
    country: str = "US"
    lat: float
    lon: float
    elevation_m: float
    urban_class: str
    morphology: dict[str, float]
    overridden: dict[str, float] = {}


class HeatPredictResponse(BaseModel):
    prediction: HeatPrediction
    risk: RiskAssessment
    site: SiteSummary
    conditions: dict[str, float]
    timestamp_utc: str
    timestamp_local: str
    explanation: Explanation | None = None
    model: ModelStamp
    disclaimer: str


class Scenario(BaseModel):
    name: str = Field(..., max_length=80)
    description: str | None = Field(None, max_length=240)
    conditions: AtmosphericConditions | None = None
    overrides: SiteOverrides = Field(default_factory=SiteOverrides)


class HeatSimulateRequest(BaseModel):
    station_id: str
    timestamp: datetime | None = None
    baseline: AtmosphericConditions
    scenarios: list[Scenario] = Field(..., min_length=1, max_length=8)
    explain: bool = Field(True, description="Attach the SHAP attribution for the baseline")
    explain_scenarios: bool = Field(
        False,
        description=(
            "Attach SHAP attributions for every scenario as well. Exact tree SHAP costs "
            "1–2 seconds per explanation on this model, so scenario attributions are off "
            "by default and fetched individually when a reader opens one."
        ),
    )


class ScenarioChange(BaseModel):
    field: str
    label: str
    unit: str
    baseline_value: float
    scenario_value: float
    delta: float


class ScenarioResult(BaseModel):
    name: str
    description: str | None = None
    prediction: HeatPrediction
    risk: RiskAssessment
    delta_uhi_c: float
    delta_temperature_c: float
    delta_heat_index_c: float
    percent_change_uhi: float | None = None
    changes: list[ScenarioChange]
    explanation: Explanation | None = None


class HeatSimulateResponse(BaseModel):
    site: SiteSummary
    timestamp_utc: str
    timestamp_local: str
    baseline: HeatPredictResponse
    scenarios: list[ScenarioResult]
    method: str
    disclaimer: str


class HotspotRequest(BaseModel):
    timestamp: datetime | None = None
    conditions: AtmosphericConditions
    overrides: SiteOverrides = Field(default_factory=SiteOverrides)
    limit: int | None = Field(None, ge=1, le=500)
