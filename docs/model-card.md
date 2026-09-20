# Model cards

Two models ship in this system. Both are Random Forest regressors, both are
fitted on real public observations, and both have limits that matter.

The live figures in these cards come from `ml/models/model_metadata.json` and are
also served at `GET /api/meta`. Where a number appears below it is the value from
the training run in this repository; re-running the pipeline regenerates it.

---

## 1 · Urban heat island model

### Overview

| | |
|---|---|
| **Name** | `heat_model.joblib` |
| **Type** | Random Forest regressor inside a scikit-learn `Pipeline` (median imputation → forest) |
| **Target** | `uhi_intensity_c` — hourly air-temperature anomaly of a site relative to its rural surroundings, in °C |
| **Features** | 35 — background atmosphere, solar geometry, calendar, geography, urban morphology, engineered interactions |
| **Training data** | 4,158,374 site-hours across 166 sites, US Northeast and Mid-Atlantic, 2022–2024 |
| **Selection** | `RandomizedSearchCV` over `TimeSeriesSplit` folds inside the training window; final configuration chosen on the validation window under an artifact-size budget |

### Intended use

Exploratory analysis of where and when urban heat concentrates; planning
conversations that would otherwise proceed without evidence; teaching the
mechanics of an explainable regression system on real data.

### Out of scope

Emergency response. Regulatory decisions. Individual health guidance. Any
setting where a wrong number costs someone something.

### Evaluation

Chronologically held out — August to December 2024 — and scored exactly once,
after the model was chosen. Segment and regime breakdowns are reported in the
Model Lab rather than a single headline figure, because a single R² hides where
a model is useful and where it is not.

The comparison against baselines is the argument for the forest:

| Model | Test R² |
|---|---|
| Mean baseline | ≈ 0.00 |
| Linear / Ridge / Lasso / ElasticNet | ≈ 0.13 |
| Polynomial Ridge (degree 2) | ≈ 0.23 |
| Support Vector Regression (RBF) | ≈ 0.24 |
| Decision Tree | ≈ 0.33 |
| Histogram Gradient Boosting | ≈ 0.42 |
| **Random Forest** | **≈ 0.43** |

**An R² around 0.43 on hourly ΔT is realistic, not disappointing.** Station
thermometers carry roughly ±0.5 °C of measurement noise against a signal of a few
degrees, and hourly anomalies are genuinely noisy. What the product is for is the
structure — where, when, and driven by what.

### Ethical and practical considerations

The sites this model scores hottest are, in general, the denser and more sealed
ones. Those correlate with lower-income neighbourhoods in this region. Presenting
model output as fact in a planning or funding dispute — without the limitations
below — could misdirect resources away from places the network simply does not
measure. The interface therefore carries the disclaimer on every prediction, and
the Methodology page is one click from every screen.

### Known failure modes

- **Silent extrapolation.** Asked about a sealed fraction higher than anything in
  training, the forest returns the value at the edge of what it saw, with no
  warning. Slider bounds in the interface are set to the observed p01–p99 range
  specifically to make this hard to trigger accidentally.
- **No calibrated uncertainty.** A single number, not an interval. Quantile
  regression forests or conformal prediction would fix this; it is the first item
  of future work.
- **Weak where the anomaly is weak.** At midday in high wind the heat island is
  near zero and the model has little to say. The regime table reports this
  explicitly rather than hiding it in the average.
- **Imputed cloud cover.** ISD-Lite reports sky cover for ~60% of hours. The
  remainder use the pipeline's training-fold median for a variable that
  physically matters a great deal on clear nights.
- **Airport bias.** The hourly network is mostly aerodromes on the edges of the
  places they serve. The hottest street canyons are under-represented, so the
  measured anomalies are conservative.
- **Not a physical model.** It has learned an association between conditions and
  measured temperature differences. It contains no energy balance, no radiation
  scheme, and no knowledge of why any of this happens.

### Fairness and representativeness

The network covers eleven US states in one climate region over three years.
It is not representative of desert, tropical, or southern-hemisphere cities, nor
of a different decade. Within the region, station density is higher near
airports and population centres, so rural coverage is thinner than urban.

---

## 2 · Electricity demand model

### Overview

| | |
|---|---|
| **Name** | `energy_model.joblib` |
| **Type** | Random Forest regressor inside a scikit-learn `Pipeline` |
| **Target** | `load_mw` — hourly metered load for a NYISO zone |
| **Features** | 23 — temperature and derived comfort indices, degree days, trailing-24 h thermal memory, solar geometry, calendar, holiday flag, zone identity |
| **Training data** | 289,082 zone-hours across 11 NYISO zones, 2022–2024 |

### Intended use

Understanding how electricity demand responds to weather — in particular the
upper arm of the demand-temperature curve, where urban heat and the grid meet.

### Out of scope

Dispatch. Trading. Reliability planning. Anything where being wrong costs money
or power.

### The headline number is misleading, and the product says so

This model reaches a very high overall R². **That number flatters it.** Zonal
load ranges from roughly 300 MW in Millwood to 5,600 MW in New York City, so any
model that knows which zone it is looking at captures most of the variance
immediately.

**Within-zone R² is the honest figure.** It is computed per zone on the held-out
window, stored in `segment_metrics`, and displayed in the Model Lab beside the
headline. Reporting only the overall number would be the single most misleading
thing this project could do, which is exactly why the segment breakdown exists.

### Known failure modes

- **No autoregressive term.** The model is deliberately weather-and-calendar
  driven, which makes it a demand-*response* model and useless for predicting
  tomorrow's peak — that depends on the grid's own current state.
- **Blind to the grid.** Outages, price response, demand-side programmes,
  behind-the-meter solar and generation mix are all invisible to it.
- **Coarse weather.** A zone is an area; three airports are a thin proxy for it.
- **Fixed zone geography.** Zone boundaries and load composition changed little
  over 2022–2024, but the model has no way to notice if they change later.

---

## Responsible use, both models

- Report predictions as predictions. State the conditions they assume.
- Never present a scenario difference as the expected result of an intervention.
  It is the model's sensitivity to a change in its inputs — a narrower and weaker
  claim than a causal effect, and the interface phrases it that way throughout.
- Prefer "the model associates…" to "X causes Y". SHAP measures the model's
  internal attribution, not the behaviour of the world.
- Where a decision would affect people's safety, treat this as a source of
  questions, not answers.

## Maintenance

- **Retraining.** `python -m uhei.pipeline --force` rebuilds from source. The
  station network, OSM morphology and both models are all reproducible from a
  clean clone with no credentials.
- **Drift.** There is no automated drift monitor. The most likely sources are OSM
  edits changing a site's measured morphology, and station closures or moves.
  `data_validation.json` would catch a gross change in coverage or distribution
  on the next run.
- **Versioning.** `model_metadata.json` records the training timestamp, the
  library versions, the platform, the split boundaries, the selected
  hyperparameters and the metrics for every shipped model.
