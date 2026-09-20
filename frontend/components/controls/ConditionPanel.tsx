"use client";

import { RotateCcw } from "lucide-react";

import { Slider } from "./Slider";
import { Button } from "@/components/ui/primitives";
import type { HeatConditions } from "@/lib/types";

export interface ConditionLimits {
  t_ref_c: [number, number];
  relative_humidity_pct: [number, number];
  wind_speed_ms: [number, number];
  sky_cover_oktas: [number, number];
  slp_hpa: [number, number];
  precip_1h_mm: [number, number];
}

/** Fallback limits — replaced by the observed p01/p99 range as soon as
 *  `/api/features` resolves, so the controls always reflect real training data. */
export const DEFAULT_LIMITS: ConditionLimits = {
  t_ref_c: [-20, 38],
  relative_humidity_pct: [10, 100],
  wind_speed_ms: [0, 14],
  sky_cover_oktas: [0, 8],
  slp_hpa: [985, 1040],
  precip_1h_mm: [0, 12],
};

export const DEFAULT_CONDITIONS: HeatConditions = {
  t_ref_c: 24,
  relative_humidity_pct: 68,
  wind_speed_ms: 1.5,
  sky_cover_oktas: 0,
  slp_hpa: 1016,
  precip_1h_mm: 0,
};

export function ConditionPanel({
  conditions, onChange, limits = DEFAULT_LIMITS, baseline, onReset, disabled,
}: {
  conditions: HeatConditions;
  onChange: (next: HeatConditions) => void;
  limits?: ConditionLimits;
  baseline?: HeatConditions;
  onReset?: () => void;
  disabled?: boolean;
}) {
  const set = <K extends keyof HeatConditions>(key: K, value: HeatConditions[K]) =>
    onChange({ ...conditions, [key]: value });

  return (
    <div>
      <div className="flex items-center justify-between gap-3 pb-3">
        <h3 className="label-strong">Background atmosphere</h3>
        {onReset && (
          <Button variant="ghost" size="sm" onClick={onReset} disabled={disabled}>
            <RotateCcw size={11} />
            Reset
          </Button>
        )}
      </div>

      <div className="space-y-4">
        <Slider
          label="Background air temperature"
          unit="°C"
          decimals={1}
          step={0.5}
          min={limits.t_ref_c[0]}
          max={limits.t_ref_c[1]}
          value={conditions.t_ref_c}
          baseline={baseline?.t_ref_c}
          onChange={(value) => set("t_ref_c", value)}
          disabled={disabled}
          description="Temperature of the rural landscape around the site. The model predicts how far above or below this the site itself sits."
        />
        <Slider
          label="Relative humidity"
          unit="%"
          decimals={0}
          step={1}
          min={limits.relative_humidity_pct[0]}
          max={limits.relative_humidity_pct[1]}
          value={conditions.relative_humidity_pct ?? 65}
          baseline={baseline?.relative_humidity_pct}
          onChange={(value) => set("relative_humidity_pct", value)}
          disabled={disabled}
          description="Humidity of the background air. Also used to convert the predicted temperature into a heat index."
        />
        <Slider
          label="Wind speed"
          unit="m/s"
          decimals={1}
          step={0.1}
          min={limits.wind_speed_ms[0]}
          max={limits.wind_speed_ms[1]}
          value={conditions.wind_speed_ms}
          baseline={baseline?.wind_speed_ms}
          onChange={(value) => set("wind_speed_ms", value)}
          disabled={disabled}
          description="Wind mixes urban air with rural air. Still nights are when the heat island is at its strongest."
        />
        <Slider
          label="Cloud cover"
          unit="oktas"
          decimals={0}
          step={1}
          min={limits.sky_cover_oktas[0]}
          max={limits.sky_cover_oktas[1]}
          value={conditions.sky_cover_oktas}
          baseline={baseline?.sky_cover_oktas}
          onChange={(value) => set("sky_cover_oktas", value)}
          disabled={disabled}
          description="Sky cover in eighths. Cloud traps outgoing radiation over city and countryside alike, flattening the contrast."
        />
        <Slider
          label="Sea-level pressure"
          unit="hPa"
          decimals={0}
          step={1}
          min={limits.slp_hpa[0]}
          max={limits.slp_hpa[1]}
          value={conditions.slp_hpa}
          baseline={baseline?.slp_hpa}
          onChange={(value) => set("slp_hpa", value)}
          disabled={disabled}
          description="Synoptic pressure. High pressure usually brings the calm, clear air that favours a strong heat island."
        />
        <Slider
          label="Rainfall, past hour"
          unit="mm"
          decimals={1}
          step={0.1}
          min={limits.precip_1h_mm[0]}
          max={limits.precip_1h_mm[1]}
          value={conditions.precip_1h_mm}
          baseline={baseline?.precip_1h_mm}
          onChange={(value) => set("precip_1h_mm", value)}
          disabled={disabled}
          description="Wet surfaces evaporate and cool, which narrows the gap between city and countryside."
        />
      </div>
    </div>
  );
}
