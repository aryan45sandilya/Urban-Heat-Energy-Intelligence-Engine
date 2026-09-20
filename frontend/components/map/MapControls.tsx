"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Layers } from "lucide-react";

import { Slider } from "@/components/controls/Slider";
import type { HeatConditions } from "@/lib/types";
import type { MapFeature } from "./HotspotMap";

export const LAYERS = {
  modelled: {
    label: "Modelled anomaly",
    unit: "°C",
    accessor: (f: MapFeature) => f.modelled,
    format: (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`,
    note: "The model's prediction under the conditions set here, identical for every site.",
  },
  observed: {
    label: "Observed anomaly",
    unit: "°C",
    accessor: (f: MapFeature) => f.observed,
    format: (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`,
    note: "Measured mean over summer nights, 2022–2024. Real thermometers, real weather.",
  },
  heat_index: {
    label: "Heat index",
    unit: "°C",
    accessor: (f: MapFeature) => f.heat_index,
    format: (v: number) => v.toFixed(1),
    note: "Apparent temperature derived from the predicted site temperature and humidity.",
  },
  density: {
    label: "Building density",
    unit: "/km²",
    accessor: (f: MapFeature) => f.density,
    format: (v: number) => v.toFixed(0),
    note: "Buildings per square kilometre within 3 km, measured from OpenStreetMap.",
  },
  green: {
    label: "Green cover",
    unit: "%",
    accessor: (f: MapFeature) => f.green * 100,
    format: (v: number) => `${v.toFixed(0)}%`,
    note: "Share of ground within 1 km that is vegetated, sampled on a 20 m lattice.",
  },
  impervious: {
    label: "Sealed surface",
    unit: "%",
    accessor: (f: MapFeature) => f.impervious * 100,
    format: (v: number) => `${v.toFixed(0)}%`,
    note: "Building footprint plus road carriageway within 1 km.",
  },
} as const;

export type LayerKey = keyof typeof LAYERS;

export function MapControls({
  layer, onLayerChange, conditions, onConditionsChange,
}: {
  layer: LayerKey;
  onLayerChange: (layer: LayerKey) => void;
  conditions: HeatConditions;
  onConditionsChange: (conditions: HeatConditions) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(conditions);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onConditionsChange(draft), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [draft, onConditionsChange]);

  const set = <K extends keyof HeatConditions>(key: K, value: HeatConditions[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const weatherDriven = layer === "modelled" || layer === "heat_index";

  return (
    <div
      className="w-[15.5rem] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_94%,transparent)]
                 shadow-[var(--shadow)]"
      style={{ borderRadius: "var(--radius)" }}
    >
      <div className="p-3">
        <p className="label mb-2 flex items-center gap-1.5">
          <Layers size={11} />
          Layer
        </p>
        <div className="grid gap-1">
          {(Object.keys(LAYERS) as LayerKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onLayerChange(key)}
              className={`px-2 py-1.5 text-left text-[11.5px] transition-colors ${
                layer === key
                  ? "bg-[var(--foreground)] text-[var(--surface-elevated)]"
                  : "text-[var(--foreground-muted)] hover:bg-[var(--surface-sunk)] hover:text-[var(--foreground)]"
              }`}
              style={{ borderRadius: "1px" }}
            >
              {LAYERS[key].label}
            </button>
          ))}
        </div>
        <p className="mt-2.5 text-[10.5px] leading-snug text-[var(--foreground-faint)]">
          {LAYERS[layer].note}
        </p>
      </div>

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        disabled={!weatherDriven}
        className="flex w-full items-center justify-between gap-2 border-t border-[var(--border)]
                   px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-sunk)]
                   disabled:cursor-not-allowed disabled:opacity-45"
      >
        <span className="label">Conditions</span>
        <ChevronDown
          size={13}
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && weatherDriven && (
        <div className="space-y-3.5 border-t border-[var(--border)] p-3">
          <Slider
            label="Background temp" unit="°C" decimals={1} step={0.5} min={-15} max={38}
            value={draft.t_ref_c} onChange={(v) => set("t_ref_c", v)}
          />
          <Slider
            label="Humidity" unit="%" decimals={0} step={1} min={15} max={100}
            value={draft.relative_humidity_pct ?? 68}
            onChange={(v) => set("relative_humidity_pct", v)}
          />
          <Slider
            label="Wind" unit="m/s" decimals={1} step={0.1} min={0} max={12}
            value={draft.wind_speed_ms} onChange={(v) => set("wind_speed_ms", v)}
          />
          <Slider
            label="Cloud" unit="oktas" decimals={0} step={1} min={0} max={8}
            value={draft.sky_cover_oktas} onChange={(v) => set("sky_cover_oktas", v)}
          />
        </div>
      )}

      {!weatherDriven && (
        <p className="border-t border-[var(--border)] px-3 py-2.5 text-[10.5px] leading-snug text-[var(--foreground-faint)]">
          This layer shows measurements, so the weather controls do not apply to it.
        </p>
      )}
    </div>
  );
}
