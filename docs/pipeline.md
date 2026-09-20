# Pipeline walkthrough

What each stage does, what it writes, and roughly what it costs. Every stage is
idempotent: downloads, parsed frames and built datasets are cached on disk, so a
re-run costs only what actually changed.

```bash
python -m uhei.pipeline                                  # everything
python -m uhei.pipeline --stage train finalize           # selected stages
python -m uhei.pipeline --stage train --task heat        # one prediction task
python -m uhei.pipeline --force                          # re-download from source
```

| Flag | Effect |
|---|---|
| `--stage ...` | `network`, `datasets`, `validate`, `eda`, `train`, `finalize`, `explain`, `hotspots` |
| `--task heat\|energy` | Restrict the model stages to one task — halves peak memory |
| `--force` | Ignore caches and re-download from the source APIs |
| `--rf-iter N` | RandomizedSearchCV iterations (default 24) |
| `--skip-energy` | Build and train the urban-heat task only |

---

## Stage 1 · `network` — the observation network

`build_stations.py`

1. Download the NOAA ISD station inventory and filter to the study bounding box
   and state list → **549 candidates**.
2. Keep stations whose period of record spans the whole window → **210**.
3. Download ISD-Lite for every candidate station-year (630 files, parallel, with
   retries) and parse to a tidy hourly frame, applying physical plausibility
   gates — a dew point above air temperature is an instrument fault, not weather,
   and is dropped rather than imputed with an invented number.
4. Keep stations reporting at least 70% of hours → **185 stations, 4.75M
   observations**.
5. Query Overpass for each station: every building, road, green polygon and water
   body within 1 km with geometry, plus feature counts within 3 km.
6. Measure surface cover by **areal sampling on a 20 m lattice** inside the disc
   (see below).
7. Classify urban / suburban / rural from the observed terciles of 3 km building
   density, clamped by absolute floors.

**Writes** `data/interim/isd_hourly.parquet`, `data/interim/stations.parquet`
**Cost** ~5 min for downloads, ~35 min for Overpass on a cold cache

### Why sampling, not polygon-area summation

Summing polygon areas is wrong twice over. A park or lake whose polygon extends
beyond the sampling radius contributes its area *in full* — an early version of
this pipeline reported Central Park's station as 100% green, because the park
polygon dwarfs a 1 km disc. And overlapping polygons get double-counted.

Sampling fixes both. Each of ~7,850 lattice points is tested against each
feature's geometry (with a bounding-box prefilter, so most buildings touch only a
handful of points), every point counts once, and only the part of a feature
actually inside the radius is measured.

```python
cover["green"] &= ~cover["building"]    # a roof is not a green surface
green_fraction = cover["green"].mean()
```

Road length is clipped segment-by-segment: a segment fully inside counts in full,
one straddling the boundary counts for half.

---

## Stage 2a · `datasets` — urban heat island

`build_heat.py`

For each of the 185 stations, find its three nearest qualifying rural references:
≥ 15 km and ≤ 150 km away, within 300 m of elevation, ≤ 0.35 water fraction, and
with at least some mapped road within 1 km (a land mask — a lighthouse is
governed by the sea, not the countryside).

Observations are pivoted onto a shared station × hour grid. Sparse channels are
reindexed onto the temperature grid so a missing channel becomes NaN in the right
cell rather than silently shifting the alignment. Then:

```
T_ref(s,t) = mean_r [ T_obs(r,t) − Γ·(z_s − z_r) ]      Γ = 6.5 °C/km
ΔT(s,t)    = T_obs(s,t) − T_ref(s,t)
```

Rows are kept only where at least two references reported. Values outside
[−8, +12] °C are dropped as data artefacts (0.10% of rows).

**Writes** `data/processed/heat_dataset.parquet` — 4,158,374 rows, 166 sites
**Cost** ~2 min

## Stage 2b · `datasets` — electricity demand

`build_energy.py`

NYISO monthly ZIP archives → daily CSVs → 5-minute metered load. Timestamps carry
an explicit `Time Zone` column, so DST transitions are resolved from the data
rather than guessed. Averaged to the hour, keeping only hours where at least 8 of
12 intervals reported. Each zone is represented by the three nearest ISD stations
within 90 km; trailing-24 h temperature aggregates are strictly backward-looking.

**Writes** `data/processed/energy_dataset.parquet` — 289,082 rows, 11 zones
**Cost** ~1 min (plus ~1 min for 36 archive downloads on a cold cache)

---

## Stage 3 · `validate` — validation and leakage audit

`validate.py` runs 50 checks and raises on any hard failure.

The check that matters most is `leakage::forbidden_features`: ΔT is
`T_site − T_ref`, so `t_site_c` is a *component of the target* and must never be
offered as a feature. A `near_perfect_correlation` check catches any feature
above |r| = 0.98 with the target, and `split::chronological_and_disjoint`
verifies the three windows are strictly ordered with no shared rows.

**Writes** `reports/data_validation.json`
**Cost** ~1 min

---

## Stage 3b · `eda` — exploratory analysis

`eda.py` writes both the figures for the written report and **the numbers behind
every chart the product renders**, so a chart in the UI is the same computation
as a chart in the repository.

The engineered frame is thinned by a regular stride to keep 35 float columns over
four million rows inside memory; coverage and target statistics are still
computed over the complete record.

**Writes** `reports/eda_heat.json`, `reports/eda_energy.json`, `reports/figures/*.png`
**Cost** ~2 min

---

## Stage 4 · `train` — model development

`train.py` fits ten families on identical data with identical scoring, then
searches the forest's hyperparameters.

Splitting happens **before** feature engineering. Feature engineering is strictly
row-wise so the result is identical, but engineering three thinned windows
instead of four million rows keeps the memory footprint an order of magnitude
smaller.

Subsample caps are recorded in the report and displayed in the UI:

| Cap | Value | Why |
|---|---|---|
| `MAX_TRAIN_ROWS` | 180,000 | Tractable tuning on four cores |
| `MAX_EVAL_ROWS` | 150,000 | Kernel methods score in time ∝ support vectors × rows |
| `SVR_SUBSAMPLE` | 10,000 | SVR fits in O(n²) |
| `POLY_SUBSAMPLE` | 60,000 | Degree-2 expansion of 35 inputs is ~630 columns |

**Writes** `models/{task}_model.joblib`, `reports/model_report_{task}.json`
**Cost** ~65 min per task on four cores

---

## Stage 4b · `finalize` — selection and segment metrics

`finalize.py` exists because search optimises accuracy and is blind to
deployability. The search-optimal forest serialised to **417 MB** and took 3m48s
to load.

Four configurations — search-optimal, library defaults, and two leaf-constrained
variants — are scored on the validation window, then:

> among configurations within **1%** of the best validation RMSE, ship the
> **smallest artifact**.

Candidates are fitted one at a time and released before the next, so peak memory
holds a single forest; the winner is refitted at the end. Every candidate's score
*and* size is recorded in `selection.candidates` and displayed in the Model Lab.

This stage also computes **segment metrics** (per site class, per load zone) and
**regime metrics** (night, day, calm, windy, warm background). A single R² can
flatter a model: zonal load spans 300 MW to 5,600 MW, so any model that knows
which zone it is looking at scores well. Within-zone R² is the honest figure.

**Writes** updated `models/{task}_model.joblib`, `models/model_metadata.json`,
`models/feature_metadata.json`, updated `reports/model_report_{task}.json`
**Cost** ~20 min per task

---

## Stage 5 · `explain` — SHAP

`explain.py` computes global SHAP structure on a sample of the **test** window:
mean |SHAP| per feature, a summary point cloud, and binned dependence of SHAP on
feature value.

**Writes** `reports/shap_heat.json`, `reports/shap_energy.json`
**Cost** ~8 min per task

---

## Stage 6 · `hotspots` — the geospatial layer

`hotspots.py` scores every site under **one shared atmosphere** — the median
observed conditions on summer nights, applied identically everywhere — so the
differences between sites come only from geography and urban fabric. It also
carries each site's observed statistics alongside.

**Writes** `reports/hotspots.json`
**Cost** ~1 min

---

## Cold-run total

Roughly **3½ hours** on a four-core laptop, dominated by Overpass and the model
comparison. Subsequent runs reuse every cache, so re-running a single stage costs
only that stage.

Downloads are polite: three Overpass mirrors in rotation with short back-off, a
courtesy delay between queries, a descriptive user agent, and every response
cached on disk. Please put a real contact address in `UHEI_USER_AGENT` before a
large rebuild.
