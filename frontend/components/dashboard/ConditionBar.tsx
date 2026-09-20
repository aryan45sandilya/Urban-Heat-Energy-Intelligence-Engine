"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { Slider } from "@/components/controls/Slider";
import { DEFAULT_CONDITIONS } from "@/components/controls/ConditionPanel";
import { Button } from "@/components/ui/primitives";
import { useFeatures } from "@/hooks/useApi";
import type { HeatConditions } from "@/lib/types";

/**
 * The console's single input surface: a horizontal instrument strip rather than
 * a form. Slider bounds come from the p01–p99 range actually observed in the
 * training window, so the controls cannot be pushed into territory the model
 * has never seen.
 */
const PRESETS: Array<{ label: string; hint: string; conditions: HeatConditions }> = [
  {
    label: "Calm summer night",
    hint: "still, clear, humid — the heat island at its strongest",
    conditions: { t_ref_c: 24, relative_humidity_pct: 72, wind_speed_ms: 1.0,
      sky_cover_oktas: 0, slp_hpa: 1017, precip_1h_mm: 0 },
  },
  {
    label: "Heatwave afternoon",
    hint: "hot, dry, light breeze",
    conditions: { t_ref_c: 34, relative_humidity_pct: 42, wind_speed_ms: 3.0,
      sky_cover_oktas: 1, slp_hpa: 1012, precip_1h_mm: 0 },
  },
  {
    label: "Windy overcast",
    hint: "mixed air under full cloud — contrast suppressed",
    conditions: { t_ref_c: 21, relative_humidity_pct: 80, wind_speed_ms: 8.0,
      sky_cover_oktas: 8, slp_hpa: 1005, precip_1h_mm: 0 },
  },
  {
    label: "Winter night",
    hint: "cold, calm — waste heat dominates",
    conditions: { t_ref_c: -3, relative_humidity_pct: 70, wind_speed_ms: 1.5,
      sky_cover_oktas: 2, slp_hpa: 1022, precip_1h_mm: 0 },
  },
];

export function ConditionBar({
  value, onChange, pending,
}: {
  value: HeatConditions;
  onChange: (next: HeatConditions) => void;
  pending: boolean;
}) {
  const { data: catalogue } = useFeatures("heat");
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sliders update at 60 fps; the model runs once the user pauses.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(draft), 260);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [draft, onChange]);

  const range = (name: string, fallback: [number, number]): [number, number] => {
    const spec = catalogue?.features.find((f) => f.name === name);
    if (!spec) return fallback;
    return [Number(spec.p01.toFixed(1)), Number(spec.p99.toFixed(1))];
  };

  const set = <K extends keyof HeatConditions>(key: K, next: HeatConditions[K]) =>
    setDraft((current) => ({ ...current, [key]: next }));

  const activePreset = PRESETS.find(
    (preset) =>
      Math.abs(preset.conditions.t_ref_c - draft.t_ref_c) < 0.01 &&
      Math.abs(preset.conditions.wind_speed_ms - draft.wind_speed_ms) < 0.01 &&
      preset.conditions.sky_cover_oktas === draft.sky_cover_oktas,
  );

  return (
    <section className="border-b border-[var(--border)] py-5" aria-label="Atmospheric conditions">
      <div className="flex flex-wrap items-center gap-2 pb-4">
        <span className="label mr-1">Conditions</span>
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            title={preset.hint}
            onClick={() => setDraft(preset.conditions)}
            className={`border px-2.5 py-1.5 text-[11px] transition-colors ${
              activePreset?.label === preset.label
                ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary-deep)]"
                : "border-[var(--border)] text-[var(--foreground-muted)] hover:border-[var(--foreground)] hover:text-[var(--foreground)]"
            }`}
            style={{ borderRadius: "var(--radius-sm)" }}
          >
            {preset.label}
          </button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDraft(DEFAULT_CONDITIONS)}
          className="ml-auto"
        >
          Reset
        </Button>
        {pending && (
          <span className="label flex items-center gap-1.5 text-[var(--primary)]">
            <Loader2 size={11} className="animate-spin" />
            Scoring
          </span>
        )}
      </div>

      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Slider
          label="Background temperature" unit="°C" decimals={1} step={0.5}
          min={range("t_ref_c", [-20, 38])[0]} max={range("t_ref_c", [-20, 38])[1]}
          value={draft.t_ref_c} onChange={(v) => set("t_ref_c", v)}
        />
        <Slider
          label="Relative humidity" unit="%" decimals={0} step={1}
          min={range("rh_ref_pct", [15, 100])[0]} max={range("rh_ref_pct", [15, 100])[1]}
          value={draft.relative_humidity_pct ?? 65}
          onChange={(v) => set("relative_humidity_pct", v)}
        />
        <Slider
          label="Wind speed" unit="m/s" decimals={1} step={0.1}
          min={0} max={range("wind_speed_ms", [0, 12])[1]}
          value={draft.wind_speed_ms} onChange={(v) => set("wind_speed_ms", v)}
        />
        <Slider
          label="Cloud cover" unit="oktas" decimals={0} step={1}
          min={0} max={8}
          value={draft.sky_cover_oktas} onChange={(v) => set("sky_cover_oktas", v)}
        />
        <Slider
          label="Sea-level pressure" unit="hPa" decimals={0} step={1}
          min={range("slp_hpa", [985, 1040])[0]} max={range("slp_hpa", [985, 1040])[1]}
          value={draft.slp_hpa} onChange={(v) => set("slp_hpa", v)}
        />
      </div>
    </section>
  );
}
