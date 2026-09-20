"use client";

import { useId } from "react";

import { cn } from "@/lib/cn";
import { InfoTip } from "@/components/ui/primitives";

/**
 * A measurement control rather than a form field: the observed range is printed
 * along the track, so the reader can see where their chosen value sits relative
 * to what the model was actually trained on.
 */
export function Slider({
  label, unit, value, min, max, step, decimals = 2, onChange,
  description, baseline, disabled, className,
}: {
  label: string;
  unit?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimals?: number;
  onChange: (value: number) => void;
  description?: string;
  baseline?: number;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const changed = baseline !== undefined && Math.abs(baseline - value) > step / 2;
  const position = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const basePosition =
    baseline !== undefined && max > min ? ((baseline - min) / (max - min)) * 100 : null;

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="flex items-center gap-1.5 text-[12px] text-[var(--foreground)]">
          {label}
          {description && <InfoTip text={description} />}
        </label>
        <span className="flex shrink-0 items-baseline gap-1">
          <span
            className={cn(
              "data text-[13px] font-medium tabular-nums",
              changed ? "text-[var(--primary)]" : "text-[var(--foreground)]",
            )}
          >
            {value.toFixed(decimals)}
          </span>
          {unit && <span className="data text-[9px] text-[var(--foreground-faint)]">{unit}</span>}
        </span>
      </div>

      <div className="relative mt-1.5">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-valuetext={`${value.toFixed(decimals)}${unit ? ` ${unit}` : ""}`}
          className="relative z-10"
        />
        <span
          className="pointer-events-none absolute left-0 top-[9.5px] h-[3px] bg-[var(--primary)]"
          style={{ width: `${Math.min(100, Math.max(0, position))}%`, borderRadius: "99px" }}
          aria-hidden
        />
        {basePosition !== null && changed && (
          <span
            className="pointer-events-none absolute top-[5px] h-[11px] w-px bg-[var(--foreground-muted)]"
            style={{ left: `${Math.min(100, Math.max(0, basePosition))}%` }}
            aria-hidden
            title="Baseline"
          />
        )}
      </div>

      <div className="mt-0.5 flex justify-between">
        <span className="data text-[9px] text-[var(--foreground-faint)]">{min.toFixed(decimals)}</span>
        <span className="data text-[9px] text-[var(--foreground-faint)]">{max.toFixed(decimals)}</span>
      </div>
    </div>
  );
}
