/** Contracts mirroring the FastAPI response models. */

export interface ModelStamp {
  task: string;
  name: string;
  version: string;
  trained_at: string | null;
  test_r2: number | null;
  test_rmse: number | null;
  target: string;
  unit: string;
}

export interface Contribution {
  feature: string;
  label: string;
  unit: string;
  group: string;
  value: number;
  contribution: number;
  direction: "increases" | "decreases";
}

export interface Explanation {
  base_value: number;
  prediction: number;
  contributions: Contribution[];
  other_features_contribution: number;
  interpretation: string;
}

export interface Morphology {
  building_plan_fraction_1km: number;
  building_count_km2_1km: number;
  building_count_km2_3km: number;
  road_length_km_km2_1km: number;
  green_fraction_1km: number;
  water_fraction_1km: number;
  impervious_fraction_1km: number;
  green_count_km2_3km?: number;
  water_count_km2_3km?: number;
}

export interface ObservedStats {
  summer_night_mean_uhi_c: number;
  summer_night_p90_uhi_c: number;
  summer_night_mean_temp_c: number;
  summer_night_hours: number;
  annual_mean_uhi_c: number;
  annual_hours: number;
}

export interface Site {
  station_id: string;
  name: string;
  state: string | null;
  country?: string;
  lat: number;
  lon: number;
  elevation_m: number;
  urban_class: "urban" | "suburban" | "rural";
  morphology: Morphology;
  observed?: ObservedStats | null;
}

export interface HeatConditions {
  t_ref_c: number;
  relative_humidity_pct?: number;
  dewpoint_ref_c?: number;
  wind_speed_ms: number;
  sky_cover_oktas: number;
  slp_hpa: number;
  precip_1h_mm: number;
}

export interface HeatPrediction {
  uhi_intensity_c: number;
  site_temperature_c: number;
  background_temperature_c: number;
  relative_humidity_pct: number;
  heat_index_c: number;
}

export interface RiskAssessment {
  band: string;
  description: string;
  heat_index_c: number;
  basis: string;
}

export interface HeatPredictResponse {
  prediction: HeatPrediction;
  risk: RiskAssessment;
  site: Site & { overridden: Record<string, number> };
  conditions: Record<string, number>;
  timestamp_utc: string;
  timestamp_local: string;
  explanation: Explanation | null;
  model: ModelStamp;
  disclaimer: string;
}

export interface ScenarioChange {
  field: string;
  label: string;
  unit: string;
  baseline_value: number;
  scenario_value: number;
  delta: number;
}

export interface ScenarioResult {
  name: string;
  description: string | null;
  prediction: HeatPrediction;
  risk: RiskAssessment;
  delta_uhi_c: number;
  delta_temperature_c: number;
  delta_heat_index_c: number;
  percent_change_uhi: number | null;
  changes: ScenarioChange[];
  explanation: Explanation | null;
}

export interface SimulateRequestBody {
  station_id: string;
  timestamp?: string;
  baseline: HeatConditions;
  scenarios: Array<{
    name: string;
    description?: string | null;
    conditions?: HeatConditions;
    overrides?: Partial<Morphology>;
  }>;
  explain?: boolean;
  explain_scenarios?: boolean;
}

export interface HeatSimulateResponse {
  site: Site & { overridden: Record<string, number> };
  timestamp_utc: string;
  timestamp_local: string;
  baseline: HeatPredictResponse;
  scenarios: ScenarioResult[];
  method: string;
  disclaimer: string;
}

export interface HotspotSite {
  station_id: string;
  name: string;
  state: string | null;
  lat: number;
  lon: number;
  urban_class: string;
  uhi_c: number;
  temp_c: number;
  heat_index_c: number;
  heat_risk: string;
  building_count_km2_3km: number;
  impervious_fraction_1km: number;
  green_fraction_1km: number;
}

export interface HotspotResponse {
  timestamp_utc: string;
  timestamp_local: string;
  conditions: Record<string, number>;
  overrides: Record<string, number>;
  sites: HotspotSite[];
  scale: { min: number; max: number; mean: number; p10: number; p90: number };
  model: ModelStamp;
  disclaimer: string;
  note: string;
}

export interface BaselineHotspots {
  generated_at: string;
  reference_time_utc: string;
  reference_time_local: string;
  baseline_conditions: Record<string, number>;
  baseline_description: string;
  sites: Array<{
    station_id: string;
    name: string;
    state: string;
    lat: number;
    lon: number;
    elevation_m: number;
    urban_class: string;
    morphology: Morphology;
    observed: ObservedStats;
    modelled: { uhi_c: number; temp_c: number; heat_index_c: number; heat_risk: string };
  }>;
  summary: {
    n_sites: number;
    modelled_uhi_range_c: [number, number];
    observed_uhi_range_c: [number, number];
    by_class: Record<string, { n: number; mean_observed_uhi_c: number; mean_modelled_uhi_c: number }>;
  };
  caveats: string[];
}

export interface FeatureSpec {
  name: string;
  label: string;
  unit: string;
  group: string;
  group_label: string;
  description: string;
  adjustable: boolean;
  decimals: number;
  min: number;
  p01: number;
  p25: number;
  median: number;
  p75: number;
  p99: number;
  max: number;
  missing_fraction: number;
}

export interface FeatureCatalogue {
  task: string;
  count: number;
  features: FeatureSpec[];
  groups: Array<{ label: string; features: FeatureSpec[] }>;
  adjustable: FeatureSpec[];
}

export interface Metrics {
  mae: number;
  mse: number;
  rmse: number;
  r2: number;
}

export interface CandidateResult {
  key: string;
  name: string;
  family: string;
  rationale: string;
  train: Metrics;
  validation: Metrics;
  test: Metrics;
  cv: { folds: number; scheme: string; rmse_mean: number; rmse_std: number; rows: number };
  fit_seconds: number;
  cv_seconds: number;
  fit_rows: number;
  subsampled: boolean;
}

export interface SelectionRecord {
  rule: string;
  tolerance?: number;
  chosen: string;
  artifact_budget_mb?: number;
  best_validation_rmse?: number;
  candidates?: Array<{
    key: string;
    note: string;
    /** False for configurations costed and rejected without being fitted. */
    fitted?: boolean;
    reason?: string;
    validation_rmse?: number;
    validation_r2?: number;
    test_r2?: number;
    estimated_size_mb?: number;
    predicted_size_mb?: number;
    fit_seconds?: number;
    within_tolerance?: boolean;
    hyperparameters: Record<string, unknown>;
  }>;
}

export interface SelectedModel {
  key: string;
  name: string;
  metrics: Record<string, Metrics | number>;
  hyperparameters: Record<string, unknown>;
  selection?: SelectionRecord;
}

export interface SegmentMetrics {
  column: string;
  unit: string;
  note: string;
  segments: Array<{
    segment: string;
    rows: number;
    mean_target: number;
    std_target: number;
    r2: number;
    rmse: number;
    mae: number;
  }>;
}

export interface RegimeMetric {
  regime: string;
  rows: number;
  mean_target: number;
  r2: number;
  rmse: number;
  mae: number;
}

export interface ModelsResponse {
  task: string;
  target: { name: string; unit: string; mean: number; std: number; min: number; max: number };
  split: Record<string, unknown>;
  candidates: CandidateResult[];
  selected: SelectedModel;
  tuning: {
    search: string;
    n_iter: number;
    cv: string;
    search_rows: number;
    seconds: number;
    best_params: Record<string, unknown>;
    best_cv_rmse: number;
    space: Record<string, unknown[]>;
    top_trials: Array<{ params: Record<string, unknown>; cv_rmse: number; cv_rmse_std: number }>;
  };
  notes: string[];
  segment_metrics?: SegmentMetrics;
  regime_metrics?: RegimeMetric[];
}

export interface ModelMetricsResponse {
  task: string;
  target: { name: string; unit: string; mean: number; std: number; min: number; max: number };
  selected: SelectedModel;
  split: Record<string, unknown>;
  feature_importance: Array<{ feature: string; importance: number; std: number }>;
  cross_validation: { folds: number; rmse_mean: number; rmse_std: number; rows: number } | null;
}

export interface ShapGlobal {
  task: string;
  n_samples: number;
  sample_window: string;
  base_value: number;
  ranking: Array<{
    feature: string;
    label: string;
    unit: string;
    group: string;
    mean_abs_shap: number;
    mean_shap: number;
  }>;
  summary: Array<{ feature: string; label: string; points: Array<{ value: number; shap: number }> }>;
  dependence: Array<{
    feature: string;
    label: string;
    unit: string;
    bins: Array<{ bin_low: number; bin_high: number; value: number; mean_shap: number; count: number }>;
  }>;
  method: string;
}

export interface BinnedPoint {
  x: number;
  x_low: number;
  x_high: number;
  y: number;
  y_p25: number;
  y_p75: number;
  count: number;
}

export interface HeatEda {
  task: string;
  rows: number;
  sites: number;
  period: { start: string; end: string };
  target: {
    name: string; unit: string; mean: number; std: number;
    p01: number; p50: number; p99: number; skew: number;
  };
  distribution: Array<{ low: number; high: number; mid: number; count: number }>;
  diurnal_by_class: Array<{
    class: string;
    points: Array<{ hour: number; mean: number; std: number; count: number }>;
  }>;
  seasonal: Array<{ month: number; mean: number; std: number; count: number }>;
  summer_night: {
    rows: number;
    by_class: Record<string, { mean: number; count: number }>;
  };
  relationships: Record<string, BinnedPoint[]>;
  correlations: Array<{ feature: string; corr: number }>;
  station_means: Array<Record<string, number | string>>;
  coverage_by_month: Array<{ period: string; rows: number }>;
  missingness: Record<string, number>;
}

export interface EnergyEda {
  task: string;
  rows: number;
  zones: number;
  period: { start: string; end: string };
  target: { name: string; unit: string; mean: number; std: number; min: number; max: number };
  distribution: Array<{ low: number; high: number; mid: number; count: number }>;
  load_vs_temperature: BinnedPoint[];
  diurnal_by_season: Array<{ season: number; points: Array<{ hour: number; mean: number }> }>;
  monthly: Array<{ month: number; mean: number; max: number }>;
  by_zone: Array<{
    zone: string; zone_name: string; mean_mw: number;
    max_mw: number; min_mw: number; hours: number;
  }>;
  weekend_effect: { weekday_mean_mw: number; weekend_mean_mw: number };
  missingness: Record<string, number>;
}

export interface Zone {
  zone: string;
  name: string;
  code: number | null;
  mean_mw: number;
  max_mw: number;
  hours: number;
}

export interface EnergyPredictResponse {
  prediction: {
    load_mw: number;
    zone: string;
    zone_name: string;
    heat_index_c: number;
    relative_humidity_pct: number;
    cooling_degrees: number;
    heating_degrees: number;
  };
  context: {
    zone: string; name: string;
    observed_mean_mw: number | null;
    observed_max_mw: number | null;
    share_of_observed_peak: number | null;
  };
  conditions: Record<string, number>;
  timestamp_utc: string;
  timestamp_local: string;
  explanation: Explanation | null;
  model: ModelStamp;
  disclaimer: string;
}

export interface ProjectMeta {
  app: string;
  version: string;
  environment: string;
  project: string;
  trained_at: string;
  environment_info?: Record<string, string>;
  study_period_years: number[];
  split_strategy: {
    type: string;
    train_end: string;
    valid_end: string;
    cross_validation: string;
    rationale: string;
  };
  data_sources: Array<{
    key: string; name: string; url: string; license: string; description: string;
  }>;
  network: { stations: number; by_class: Record<string, number>; states: string[] };
  tasks: Record<string, {
    target: { name: string; unit: string; mean: number; std: number; min: number; max: number };
    rows: number;
    split: Record<string, unknown>;
    selected_model: string;
    hyperparameters: Record<string, unknown>;
    metrics: Record<string, Metrics | number>;
    n_features: number;
  }>;
}

export interface ValidationCheck {
  name: string;
  passed: boolean;
  severity: string;
  detail: string;
  data: Record<string, unknown>;
}

export interface ValidationReport {
  generated_at: string;
  sections: Record<string, ValidationCheck[]>;
  passed: boolean;
  failures: string[];
}

export interface HealthResponse {
  status: string;
  ready: boolean;
  loaded_at: string | null;
  models: string[];
  reports: string[];
  sites: number;
  zones: number;
  trained_at: string | null;
  model_version: string | null;
  problems: string[];
}
