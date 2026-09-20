# Architecture

How the pieces fit, and why they are arranged this way.

## Shape of the system

Three layers with one direction of flow:

```
public data sources  →  ML pipeline  →  versioned artifacts  →  API  →  web client
```

Artifacts are the only interface between training and serving. The API never
trains; the pipeline never serves. That separation is what lets a retrain happen
without touching the running service, and what makes a stale model impossible to
ship by accident — the container mounts `ml/models` read-only rather than baking
it in.

## Repository layout

```
ml/
  src/uhei/
    config.py          study domain, split boundaries, all tunable constants
    utils.py           geodesy, solar geometry, humidity and heat indices, HTTP
    features.py        feature engineering — imported by training AND serving
    catalog.py         human-facing descriptions driving the UI's controls
    sources/
      isd.py           NOAA ISD-Lite: inventory, download, parse, physical gates
      osm.py           Overpass: morphology by 20 m areal sampling
      nyiso.py         NYISO: monthly load archives, DST-correct parsing
    build_stations.py  stage 1 — network assembly and urban classification
    build_heat.py      stage 2a — ΔT construction with lapse correction
    build_energy.py    stage 2b — zone ↔ weather join
    validate.py        stage 3 — 50 checks including the leakage audit
    eda.py             stage 3b — figures and the numbers behind every chart
    train.py           stage 4 — ten model families, comparison, RF search
    finalize.py        stage 4b — final selection, segment and regime metrics
    explain.py         stage 5 — global and local SHAP
    hotspots.py        stage 6 — the geospatial layer
    pipeline.py        stage runner / CLI
  data/{raw,interim,processed}   cached downloads and built datasets (gitignored)
  models/                        joblib bundles + metadata JSON
  reports/                       every JSON the product reads, plus figures
  tests/

backend/app/
  main.py            app factory, middleware, lifespan
  core/config.py     pydantic-settings, environment-driven
  core/errors.py     structured errors, no stack traces on the wire
  services/registry.py   loads artifacts once; raises 503 when one is absent
  services/heat_service.py     predict / simulate / map layer
  services/energy_service.py   predict / simulate
  schemas/           request and response contracts
  api/routes.py      the HTTP surface
  tests/

frontend/
  app/               App Router pages, one per product surface
  components/
    shell/           navigation, theme, chrome
    ui/              primitives — Page, Block, Panel, Button, Tabs, states
    signature/       ThermalLadder, MorphologyFingerprint, AttributionBridge
    charts/          shared chart language + heat charts
    landing|dashboard|predict|simulate|map|lab|method/
  hooks/useApi.ts    SWR wrappers, one per endpoint
  lib/               typed client, formatting, thermal ramp, types

docker/              two Dockerfiles
docs/                this file and the pipeline walkthrough
```

## Design decisions worth stating

### Features live in one module, imported by both sides

`ml/src/uhei/features.py` is imported by `train.py` *and* by
`backend/app/services/heat_service.py`. A prediction made through the API is
therefore transformed by literally the same code that produced the training
matrix. The alternative — reimplementing the transformation in the serving layer —
is the most common source of silent production error in ML systems, because the
two copies drift and nothing fails loudly.

The module contains **no fitted state**. Everything learned from data
(imputation medians, scaling) lives inside the scikit-learn `Pipeline`, which is
fitted on training folds only and travels inside the artifact.

`ml/tests/test_features.py` asserts that transforming one row alone gives
element-for-element the same result as transforming it inside a batch. That test
exists because an earlier version violated it: interactions filled missing wind
and cloud from a batch median, so training absorbed a statistic partly computed
from the test window, and a single-row API request took the median of itself.

### The registry loads once and refuses cleanly

`Registry.load()` runs in the FastAPI lifespan. It loads both model bundles,
constructs the SHAP explainers, and reads every report JSON. Anything missing is
recorded in `problems` and surfaced by `/health`; the endpoints that need it
raise `ArtifactUnavailable` → **503 with an explicit message naming the missing
artifact and the command that produces it**.

There is deliberately no fallback path. A prediction service that substitutes a
plausible number when its model is absent is worse than one that fails.

### Splitting happens before feature engineering

`chronological_split(df, features, target, engineer=...)` cuts the time windows
first and builds features on each window separately. Feature engineering is
strictly row-wise, so the result is identical either way — but engineering three
thinned windows instead of four million rows keeps the memory footprint an order
of magnitude smaller, which matters on a four-core laptop.

### Evaluation windows are thinned, and everything is scored on the same rows

Kernel methods predict in time proportional to support vectors × rows scored.
Scoring ten candidates on 1.1M held-out rows would make the comparison
intractable without making it more informative. Both evaluation windows are
thinned to 150,000 rows by a regular stride through time, which preserves diurnal
and seasonal structure and the station mix exactly. Every model sees identical
rows, so the comparison stays fair, and the strides are recorded in the split
metadata shown in the Model Lab.

### Final model selection is a two-step decision

Step one is hyperparameter search: `RandomizedSearchCV` over `TimeSeriesSplit`
folds *inside the training window*. Step two is selection: four configurations
refitted on the full training window, scored on the **validation** window, and
chosen by

> among configurations within 1% of the best validation RMSE, ship the smallest
> artifact.

The second step exists because search is blind to deployability. The
search-optimal forest serialised to 417 MB and took 3m48s to load. All four
candidates' scores *and* sizes are recorded and displayed, so the trade is
visible rather than hidden.

The test window takes no part in either step and is scored exactly once.

### No database

Saved scenarios, prediction history and user preferences are the three things a
database would enable here, and none of them is part of what this product does.
Adding PostgreSQL would add a migration story, a connection pool, a backup story
and a second failure mode in exchange for nothing. The one piece of client state
that benefits from persistence — the theme choice — lives in `localStorage`,
wrapped in try/catch because private browsing throws.

### No authentication

Everything the system exposes is derived from public data and is read-only. An
auth layer would turn a prediction engine into a CRUD application, which is
precisely what this project set out not to be.

## Failure modes and how they are handled

| Failure | Handling |
|---|---|
| Model artifact missing | 503 with the artifact name and the command that builds it; `/health` lists it under `problems` |
| SHAP explainer unavailable | Prediction still returned; `explanation` is null and the UI says so |
| Unknown station or zone | 404 with the identifier echoed back |
| Input outside physical bounds | 422 from Pydantic with per-field messages |
| Unhandled server exception | 500 with a request ID; the traceback goes to the log, never the wire |
| API unreachable from the browser | The client raises a typed `ApiError` and the UI renders an error state with a retry — never a placeholder number |
| Overpass mirror rate-limiting | Two passes across three mirrors with short back-off; responses cached on disk so a re-run costs nothing |
| A station's channel never reports | Pivots are reindexed onto the temperature grid so a missing channel becomes NaN in the right cell rather than shifting alignment |

## Reproducibility

- Every constant that governs what data is pulled and how the study is framed
  lives in `config.py`.
- `RANDOM_STATE = 42` throughout; nothing is shuffled.
- Raw downloads, parsed frames and built datasets are cached, so re-runs are
  incremental and a rebuild costs only what changed.
- `model_metadata.json` records Python, scikit-learn, NumPy and pandas versions,
  the platform, the split strategy, the data sources and the selected
  hyperparameters alongside the metrics.
