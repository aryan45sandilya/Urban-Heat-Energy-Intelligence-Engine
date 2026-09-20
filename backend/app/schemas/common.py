"""Shared response fragments."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ModelStamp(BaseModel):
    """Which artifact produced a result — attached to every prediction."""

    task: str
    name: str = Field(description="Selected model family")
    version: str
    trained_at: str | None = None
    test_r2: float | None = None
    test_rmse: float | None = None
    target: str
    unit: str


class Contribution(BaseModel):
    feature: str
    label: str
    unit: str
    group: str
    value: float
    contribution: float = Field(description="SHAP attribution in target units")
    direction: str


class Explanation(BaseModel):
    base_value: float = Field(description="Model's average output over the training data")
    prediction: float
    contributions: list[Contribution]
    other_features_contribution: float
    interpretation: str


class ErrorDetail(BaseModel):
    code: str
    message: str
    detail: dict[str, Any] = {}
    request_id: str


class ErrorResponse(BaseModel):
    error: ErrorDetail
