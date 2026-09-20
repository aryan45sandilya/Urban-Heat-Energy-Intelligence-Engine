"use client";

import useSWR from "swr";

import { fetcher } from "@/lib/api";
import type {
  BaselineHotspots, EnergyEda, FeatureCatalogue, HealthResponse, HeatEda,
  ModelMetricsResponse, ModelsResponse, ProjectMeta, ShapGlobal, Site,
  ValidationReport, Zone,
} from "@/lib/types";

/** Reference data changes only when the pipeline is re-run, so it is cached hard. */
const STATIC = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  dedupingInterval: 300_000,
  shouldRetryOnError: false,
} as const;

export const useHealth = () =>
  useSWR<HealthResponse>("/health", fetcher, { ...STATIC, refreshInterval: 60_000 });

export const useMeta = () => useSWR<ProjectMeta>("/api/meta", fetcher, STATIC);

export const useSites = () =>
  useSWR<{ count: number; sites: Site[] }>("/api/sites", fetcher, STATIC);

export const useZones = () =>
  useSWR<{ count: number; zones: Zone[] }>("/api/zones", fetcher, STATIC);

export const useFeatures = (task: "heat" | "energy") =>
  useSWR<FeatureCatalogue>(`/api/features?task=${task}`, fetcher, STATIC);

export const useModels = (task: "heat" | "energy") =>
  useSWR<ModelsResponse>(`/api/models?task=${task}`, fetcher, STATIC);

export const useModelMetrics = (task: "heat" | "energy") =>
  useSWR<ModelMetricsResponse>(`/api/model-metrics?task=${task}`, fetcher, STATIC);

export const useShap = (task: "heat" | "energy") =>
  useSWR<ShapGlobal>(`/api/shap?task=${task}`, fetcher, STATIC);

export const useHeatEda = () => useSWR<HeatEda>("/api/eda?task=heat", fetcher, STATIC);

export const useEnergyEda = () => useSWR<EnergyEda>("/api/eda?task=energy", fetcher, STATIC);

export const useValidation = () =>
  useSWR<ValidationReport>("/api/validation", fetcher, STATIC);

export const useHotspots = () =>
  useSWR<BaselineHotspots>("/api/hotspots", fetcher, STATIC);
