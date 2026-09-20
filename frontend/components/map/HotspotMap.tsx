"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Loader2, Thermometer, X } from "lucide-react";

import { MapLegend } from "./MapLegend";
import { MapSitePanel } from "./MapSitePanel";
import { MapControls, LAYERS, type LayerKey } from "./MapControls";
import { DEFAULT_CONDITIONS } from "@/components/controls/ConditionPanel";
import { ErrorState } from "@/components/ui/primitives";
import { useHotspots } from "@/hooks/useApi";
import { useTheme } from "@/components/shell/ThemeProvider";
import { api, ApiError } from "@/lib/api";
import { HEAT_RAMP_HEX_DARK, HEAT_RAMP_HEX_LIGHT, fixed } from "@/lib/format";
import type { BaselineHotspots, HeatConditions, HotspotResponse } from "@/lib/types";

const TIMESTAMP = "2024-07-16T03:00:00Z";
const SOURCE_ID = "uhei-sites";

interface Feature {
  station_id: string;
  name: string;
  state: string | null;
  lat: number;
  lon: number;
  urban_class: string;
  modelled: number;
  observed: number | null;
  heat_index: number;
  heat_risk: string;
  density: number;
  green: number;
  impervious: number;
}

export function HotspotMap() {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const { resolved } = useTheme();

  const { data: baseline, error: baselineError } = useHotspots();
  const [conditions, setConditions] = useState<HeatConditions>(DEFAULT_CONDITIONS);
  const [live, setLive] = useState<HotspotResponse | null>(null);
  const [layer, setLayer] = useState<LayerKey>("modelled");
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  /* ── Data ──────────────────────────────────────────────────────────── */
  const features = useMemo<Feature[]>(() => {
    if (!baseline) return [];
    const liveById = new Map(live?.sites.map((s) => [s.station_id, s]) ?? []);
    return baseline.sites.map((site) => {
      const current = liveById.get(site.station_id);
      return {
        station_id: site.station_id,
        name: site.name,
        state: site.state,
        lat: site.lat,
        lon: site.lon,
        urban_class: site.urban_class,
        modelled: current?.uhi_c ?? site.modelled.uhi_c,
        observed: site.observed.summer_night_mean_uhi_c,
        heat_index: current?.heat_index_c ?? site.modelled.heat_index_c,
        heat_risk: current?.heat_risk ?? site.modelled.heat_risk,
        density: site.morphology.building_count_km2_3km,
        green: site.morphology.green_fraction_1km,
        impervious: site.morphology.impervious_fraction_1km,
      };
    });
  }, [baseline, live]);

  const metric = LAYERS[layer];
  const values = useMemo(
    () => features.map((f) => metric.accessor(f)).filter((v): v is number => v !== null),
    [features, metric],
  );
  const domain = useMemo((): [number, number] => {
    if (!values.length) return [0, 1];
    const sorted = [...values].sort((a, b) => a - b);
    return [sorted[0], sorted[sorted.length - 1]];
  }, [values]);

  const selectedSite = useMemo(
    () => baseline?.sites.find((s) => s.station_id === selected) ?? null,
    [baseline, selected],
  );
  const selectedLive = useMemo(
    () => live?.sites.find((s) => s.station_id === selected) ?? null,
    [live, selected],
  );

  /* ── Scoring under user conditions ─────────────────────────────────── */
  const run = useCallback(async (next: HeatConditions) => {
    const id = ++requestId.current;
    setPending(true);
    try {
      const response = await api.hotspots({ timestamp: TIMESTAMP, conditions: next });
      if (id !== requestId.current) return;
      setLive(response);
      setError(null);
    } catch (exc) {
      if (id !== requestId.current) return;
      setError(exc instanceof ApiError ? exc.message : "Unexpected failure.");
    } finally {
      if (id === requestId.current) setPending(false);
    }
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => void run(conditions), 60);
    return () => clearTimeout(handle);
  }, [conditions, run]);

  /* ── Map lifecycle ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (!container.current || map.current) return;

    const instance = new maplibregl.Map({
      container: container.current,
      style: basemapStyle(resolved),
      center: [-74.6, 41.6],
      zoom: 6.1,
      minZoom: 4,
      maxZoom: 13,
      attributionControl: false,
    });
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    instance.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: "© OpenStreetMap contributors · © CARTO · NOAA ISD",
      }),
      "bottom-right",
    );
    // Readiness is driven entirely by MapLibre's own events, so a theme swap
    // needs no state change of its own — `setStyle` fires these on our behalf.
    instance.on("load", () => setReady(true));
    instance.on("styledataloading", () => setReady(false));
    instance.on("styledata", () => setReady(true));

    // Interaction handlers are registered once. MapLibre accepts a layer id that
    // does not exist yet, which matters because a style swap removes our layers
    // and the paint effect adds them back.
    instance.on("click", "site-point", (event) => {
      const id = event.features?.[0]?.properties?.station_id;
      if (typeof id === "string") setSelected(id);
    });
    instance.on("mouseenter", "site-point", () => {
      instance.getCanvas().style.cursor = "pointer";
    });
    instance.on("mouseleave", "site-point", () => {
      instance.getCanvas().style.cursor = "";
    });

    map.current = instance;

    return () => {
      instance.remove();
      map.current = null;
      setReady(false);
    };
    // The basemap is swapped separately when the theme changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap the basemap when the theme changes. The `styledataloading` /
  // `styledata` subscriptions above take the layer down and bring it back.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    instance.setStyle(basemapStyle(resolved));
  }, [resolved]);

  // Paint the site layer.
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready || !features.length) return;

    const ramp = resolved === "dark" ? HEAT_RAMP_HEX_DARK : HEAT_RAMP_HEX_LIGHT;
    const [lo, hi] = domain;
    const stops = ramp.flatMap((colour, i) => [lo + ((hi - lo) * i) / (ramp.length - 1), colour]);

    const collection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: features
        .filter((f) => metric.accessor(f) !== null)
        .map((f) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [f.lon, f.lat] },
          properties: {
            station_id: f.station_id,
            name: f.name,
            value: metric.accessor(f),
            urban_class: f.urban_class,
          },
        })),
    };

    const existing = instance.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (existing) {
      existing.setData(collection);
    } else {
      instance.addSource(SOURCE_ID, { type: "geojson", data: collection });
      instance.addLayer({
        id: "site-halo",
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 6, 8, 13, 12, 22],
          "circle-color": ["interpolate", ["linear"], ["get", "value"], ...stops],
          "circle-opacity": 0.18,
          "circle-blur": 0.6,
        },
      });
      instance.addLayer({
        id: "site-point",
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3.2, 8, 6.5, 12, 11],
          "circle-color": ["interpolate", ["linear"], ["get", "value"], ...stops],
          "circle-stroke-width": 1,
          "circle-stroke-color": resolved === "dark" ? "#16130f" : "#fdfbf7",
        },
      });
    }

    if (instance.getLayer("site-point")) {
      instance.setPaintProperty("site-point", "circle-color", [
        "interpolate", ["linear"], ["get", "value"], ...stops,
      ]);
      instance.setPaintProperty(
        "site-point", "circle-stroke-color",
        resolved === "dark" ? "#16130f" : "#fdfbf7",
      );
      instance.setPaintProperty("site-halo", "circle-color", [
        "interpolate", ["linear"], ["get", "value"], ...stops,
      ]);
    }
  }, [ready, features, metric, domain, resolved]);

  // Highlight the selected point.
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready || !instance.getLayer("site-point")) return;
    instance.setPaintProperty("site-point", "circle-stroke-width", [
      "case", ["==", ["get", "station_id"], selected ?? ""], 3, 1,
    ]);
  }, [selected, ready]);

  if (baselineError) {
    return (
      <div className="p-[var(--gutter)]">
        <ErrorState
          title="The map layer is not available"
          message={baselineError.message}
        />
      </div>
    );
  }

  return (
    <div className="relative h-[calc(100dvh-57px)] lg:h-[calc(100dvh-61px)]">
      <div
        ref={container}
        className="absolute inset-0"
        style={{ filter: resolved === "dark" ? "none" : "sepia(0.16) saturate(0.9)" }}
        aria-label="Map of measured weather stations coloured by predicted urban heat island intensity"
        role="application"
      />

      {/* ── Header overlay ────────────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 p-3 sm:p-4">
        <div className="pointer-events-auto flex flex-wrap items-start gap-3">
          <div
            className="max-w-[22rem] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_94%,transparent)] p-3.5 shadow-[var(--shadow)]"
            style={{ borderRadius: "var(--radius)" }}
          >
            <p className="label flex items-center gap-1.5">
              <Thermometer size={11} />
              Hotspot map
            </p>
            <h1 className="mt-1.5 text-[1.05rem] leading-snug">
              {features.length} measured stations, one shared atmosphere
            </h1>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--foreground-muted)]">
              {baseline?.baseline_description ??
                "Every site is scored by the same model under identical weather."}
            </p>
            {pending && (
              <p className="label mt-2 flex items-center gap-1.5 text-[var(--primary)]">
                <Loader2 size={10} className="animate-spin" />
                Rescoring the network
              </p>
            )}
            {error && (
              <p className="mt-2 text-[11px] text-[var(--danger)]">{error}</p>
            )}
          </div>

          <MapControls
            layer={layer}
            onLayerChange={setLayer}
            conditions={conditions}
            onConditionsChange={setConditions}
          />
        </div>
      </div>

      {/* ── Legend ────────────────────────────────────────────────────── */}
      <div className="pointer-events-none absolute bottom-0 left-0 z-10 p-3 sm:p-4">
        <div className="pointer-events-auto">
          <MapLegend
            label={metric.label}
            unit={metric.unit}
            min={domain[0]}
            max={domain[1]}
            format={metric.format}
          />
        </div>
      </div>

      {/* ── Selected site ─────────────────────────────────────────────── */}
      {selectedSite && (
        <div
          className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 max-h-[62dvh] overflow-y-auto
                     border-t border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)]
                     sm:inset-x-auto sm:bottom-4 sm:right-4 sm:top-auto sm:max-h-[calc(100%-9rem)]
                     sm:w-[21rem] sm:border scroll-thin"
          style={{ borderRadius: "var(--radius)" }}
        >
          <button
            type="button"
            onClick={() => setSelected(null)}
            aria-label="Close site detail"
            className="absolute right-2 top-2 z-10 p-1.5 text-[var(--foreground-muted)]
                       transition-colors hover:text-[var(--foreground)]"
          >
            <X size={14} />
          </button>
          <MapSitePanel site={selectedSite} live={selectedLive} />
        </div>
      )}

      {!selectedSite && features.length > 0 && (
        <p
          className="pointer-events-none absolute bottom-4 right-4 z-10 hidden border border-[var(--border)]
                     bg-[color-mix(in_srgb,var(--surface)_90%,transparent)] px-2.5 py-1.5 text-[11px]
                     text-[var(--foreground-muted)] sm:block"
          style={{ borderRadius: "var(--radius-sm)" }}
        >
          Select a station for its measurements
        </p>
      )}

      {live && (
        <p className="sr-only" aria-live="polite">
          Network rescored. Range {fixed(live.scale.min, 2)} to {fixed(live.scale.max, 2)} degrees.
        </p>
      )}
    </div>
  );
}

/** Neutral raster basemap, warmed by a CSS filter to sit inside the palette. */
function basemapStyle(theme: "light" | "dark"): StyleSpecification {
  const variant = theme === "dark" ? "dark_all" : "light_all";
  return {
    version: 8,
    sources: {
      carto: {
        type: "raster",
        tiles: [
          `https://a.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}@2x.png`,
          `https://b.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}@2x.png`,
          `https://c.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}@2x.png`,
        ],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors © CARTO",
      },
    },
    layers: [{ id: "carto", type: "raster", source: "carto" }],
  };
}

export type { Feature as MapFeature, BaselineHotspots };
