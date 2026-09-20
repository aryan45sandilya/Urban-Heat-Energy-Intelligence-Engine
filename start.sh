#!/bin/sh
export PYTHONPATH="/app/ml/src:${PYTHONPATH:-}"
cd /app/backend
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --workers 1
