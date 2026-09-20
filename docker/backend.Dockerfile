# ── UHEI API ────────────────────────────────────────────────────────────────
# Serves the trained artifacts. The image carries no model of its own: artifacts
# are mounted at /app/ml/models and /app/ml/reports so a retrain does not require
# a rebuild, and so an image can never ship a stale model by accident.
FROM python:3.13-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Build tooling is needed for a few scientific wheels on slim images.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential curl \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt pyproject.toml ./
RUN pip install --no-cache-dir -r requirements.txt

COPY ml/src ./ml/src
COPY backend ./backend
RUN pip install --no-cache-dir -e . --no-deps

# Non-root: the API reads artifacts and writes nothing.
RUN useradd --create-home --uid 10001 uhei \
 && mkdir -p /app/ml/models /app/ml/reports \
 && chown -R uhei:uhei /app
USER uhei

ENV UHEI_MODELS_DIR=/app/ml/models \
    UHEI_REPORTS_DIR=/app/ml/reports \
    UHEI_ENVIRONMENT=production \
    PYTHONPATH=/app/backend:/app/ml/src

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
