"""Structured error handling.

Clients receive a stable machine-readable shape; the stack trace stays in the
server log and never reaches the network.
"""
from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

log = logging.getLogger("uhei.api")


class UHEIError(Exception):
    """Base class for errors that are safe to describe to a client."""

    status_code = status.HTTP_400_BAD_REQUEST
    code = "bad_request"

    def __init__(self, message: str, *, detail: dict | None = None):
        super().__init__(message)
        self.message = message
        self.detail = detail or {}


class ArtifactUnavailable(UHEIError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "artifact_unavailable"


class ResourceNotFound(UHEIError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"


class InvalidInput(UHEIError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "invalid_input"


def _payload(code: str, message: str, detail: dict, request_id: str) -> dict:
    return {"error": {"code": code, "message": message, "detail": detail,
                      "request_id": request_id}}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(UHEIError)
    async def _handled(request: Request, exc: UHEIError):
        request_id = getattr(request.state, "request_id", "-")
        log.warning("%s [%s] %s", exc.code, request_id, exc.message)
        return JSONResponse(status_code=exc.status_code,
                            content=_payload(exc.code, exc.message, exc.detail, request_id))

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):
        request_id = getattr(request.state, "request_id", "-")
        fields = [
            {"field": ".".join(str(p) for p in err.get("loc", ())[1:]) or "body",
             "problem": err.get("msg", "invalid value")}
            for err in exc.errors()
        ]
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=_payload("validation_error",
                             "One or more inputs were rejected.",
                             {"fields": fields}, request_id),
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
        log.exception("unhandled error [%s] on %s", request_id, request.url.path)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=_payload("internal_error",
                             "The request could not be completed.", {}, request_id),
        )
