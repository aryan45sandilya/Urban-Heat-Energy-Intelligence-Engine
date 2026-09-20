"""Request/response models for the electricity-demand task."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import Explanation, ModelStamp


class ZoneConditions(BaseModel):
    temp_c: float = Field(..., ge=-45, le=50, description="Zone-average air temperature (°C)")
    relative_humidity_pct: float | None = Field(None, ge=1, le=100)
    dewpoint_c: float | None = Field(None, ge=-55, le=40)
    wind_speed_ms: float = Field(3.0, ge=0, le=60)
    sky_cover_oktas: float = Field(3.0, ge=0, le=8)
    temp_24h_mean_c: float | None = Field(
        None, ge=-45, le=50,
        description="Mean temperature over the trailing 24 h. Defaults to temp_c.")
    temp_24h_max_c: float | None = Field(
        None, ge=-45, le=50,
        description="Maximum temperature over the trailing 24 h. Defaults to temp_c.")

    @model_validator(mode="after")
    def _need_a_humidity(self):
        if self.dewpoint_c is None and self.relative_humidity_pct is None:
            raise ValueError("provide either relative_humidity_pct or dewpoint_c")
        if self.dewpoint_c is not None and self.dewpoint_c > self.temp_c + 0.5:
            raise ValueError("dew point cannot exceed air temperature")
        if (self.temp_24h_max_c is not None and self.temp_24h_mean_c is not None
                and self.temp_24h_max_c < self.temp_24h_mean_c):
            raise ValueError("trailing-24 h maximum cannot be below the trailing-24 h mean")
        return self


class EnergyPredictRequest(BaseModel):
    zone: str = Field(..., description="NYISO load zone from GET /api/zones")
    timestamp: datetime | None = None
    conditions: ZoneConditions
    explain: bool = True


class EnergyPrediction(BaseModel):
    load_mw: float
    zone: str
    zone_name: str
    heat_index_c: float
    relative_humidity_pct: float
    cooling_degrees: float
    heating_degrees: float


class ZoneContext(BaseModel):
    zone: str
    name: str
    observed_mean_mw: float | None = None
    observed_max_mw: float | None = None
    share_of_observed_peak: float | None = None


class EnergyPredictResponse(BaseModel):
    prediction: EnergyPrediction
    context: ZoneContext
    conditions: dict[str, float]
    timestamp_utc: str
    timestamp_local: str
    explanation: Explanation | None = None
    model: ModelStamp
    disclaimer: str


class EnergyScenario(BaseModel):
    name: str = Field(..., max_length=80)
    description: str | None = Field(None, max_length=240)
    conditions: ZoneConditions


class EnergySimulateRequest(BaseModel):
    zone: str
    timestamp: datetime | None = None
    baseline: ZoneConditions
    scenarios: list[EnergyScenario] = Field(..., min_length=1, max_length=8)
    explain: bool = True


class EnergyScenarioResult(BaseModel):
    name: str
    description: str | None = None
    prediction: EnergyPrediction
    delta_mw: float
    percent_change: float | None = None
    changes: list[dict]
    explanation: Explanation | None = None


class EnergySimulateResponse(BaseModel):
    zone: str
    zone_name: str
    timestamp_utc: str
    timestamp_local: str
    baseline: EnergyPredictResponse
    scenarios: list[EnergyScenarioResult]
    method: str
    disclaimer: str
