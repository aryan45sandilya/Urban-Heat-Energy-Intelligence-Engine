/**
 * Typed client for the UHEI API.
 *
 * Every figure rendered by this application passes through here. There is no
 * fixture data, no mock mode and no fallback constant: when the API is
 * unreachable the UI says so rather than inventing a plausible number.
 */
import type {
  BaselineHotspots, EnergyEda, EnergyPredictResponse, FeatureCatalogue, HealthResponse,
  HeatEda, HeatPredictResponse, HeatSimulateResponse, HotspotResponse, ModelMetricsResponse,
  ModelsResponse, ProjectMeta, ShapGlobal, Site, ValidationReport, Zone,
} from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8000";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string = "error",
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(
      "Cannot reach the prediction service. Start the API with `uvicorn app.main:app` in ./backend.",
      0,
      "network_unreachable",
    );
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const envelope = payload as { error?: { message?: string; code?: string; detail?: Record<string, unknown> } } | null;
    throw new ApiError(
      envelope?.error?.message ?? `Request failed with status ${response.status}.`,
      response.status,
      envelope?.error?.code ?? "error",
      envelope?.error?.detail ?? {},
    );
  }
  return payload as T;
}

const get = <T,>(path: string) => request<T>(path, { method: "GET", cache: "no-store" });
const post = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });

/** SWR fetcher — keys are plain API paths. */
export const fetcher = <T,>(path: string) => get<T>(path);

export const api = {
  health: () => get<HealthResponse>("/health"),
  meta: () => get<ProjectMeta>("/api/meta"),
  sites: () => get<{ count: number; sites: Site[] }>("/api/sites"),
  zones: () => get<{ count: number; zones: Zone[] }>("/api/zones"),
  features: (task: "heat" | "energy") => get<FeatureCatalogue>(`/api/features?task=${task}`),
  models: (task: "heat" | "energy") => get<ModelsResponse>(`/api/models?task=${task}`),
  modelMetrics: (task: "heat" | "energy") =>
    get<ModelMetricsResponse>(`/api/model-metrics?task=${task}`),
  shap: (task: "heat" | "energy") => get<ShapGlobal>(`/api/shap?task=${task}`),
  edaHeat: () => get<HeatEda>("/api/eda?task=heat"),
  edaEnergy: () => get<EnergyEda>("/api/eda?task=energy"),
  validation: () => get<ValidationReport>("/api/validation"),
  hotspotsBaseline: () => get<BaselineHotspots>("/api/hotspots"),

  predictHeat: (body: unknown) => post<HeatPredictResponse>("/api/predict/heat", body),
  predictEnergy: (body: unknown) => post<EnergyPredictResponse>("/api/predict/energy", body),
  simulateHeat: (body: unknown) => post<HeatSimulateResponse>("/api/simulate", body),
  hotspots: (body: unknown) => post<HotspotResponse>("/api/hotspots", body),
};
