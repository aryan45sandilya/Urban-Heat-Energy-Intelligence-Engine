"use client";

import { motion, useReducedMotion } from "motion/react";

import { HEAT_RAMP } from "@/lib/format";

/**
 * UHEI signature #1 — the thermal ladder.
 *
 * A surveyor's scale rather than a gauge: the ramp is drawn as discrete rungs
 * with tick marks, the network's observed range is printed along it, and a
 * single needle marks the current prediction. It is the one element that tells
 * the reader "this number sits *here* among everything we have measured".
 */
export function ThermalLadder({
  value,
  min,
  max,
  unit = "°C",
  markers = [],
  height = 168,
  label,
}: {
  value: number;
  min: number;
  max: number;
  unit?: string;
  markers?: Array<{ value: number; label: string }>;
  height?: number;
  label?: string;
}) {
  const reduce = useReducedMotion();
  const span = max - min || 1;
  const clamp = (v: number) => Math.min(1, Math.max(0, (v - min) / span));
  const position = clamp(value);
  const rungs = 24;

  return (
    <figure className="flex gap-3" style={{ height }}>
      <div className="relative flex w-[26px] shrink-0 flex-col-reverse gap-[2px]">
        {Array.from({ length: rungs }).map((_, i) => {
          const t = i / (rungs - 1);
          const stop = HEAT_RAMP[Math.min(HEAT_RAMP.length - 1, Math.round(t * (HEAT_RAMP.length - 1)))];
          const lit = t <= position + 1e-9;
          return (
            <motion.span
              key={i}
              className="flex-1"
              style={{ background: stop }}
              initial={reduce ? false : { opacity: 0.14, scaleX: 0.6 }}
              animate={{ opacity: lit ? 1 : 0.14, scaleX: lit ? 1 : 0.6 }}
              transition={{ duration: 0.32, delay: reduce ? 0 : i * 0.012, ease: [0.16, 1, 0.3, 1] }}
            />
          );
        })}

        <motion.div
          className="pointer-events-none absolute left-0 right-[-8px] flex items-center"
          initial={false}
          animate={{ bottom: `calc(${position * 100}% - 1px)` }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
        >
          <span className="h-[2px] w-full bg-[var(--foreground)]" />
          <span className="h-[7px] w-[7px] shrink-0 rotate-45 border-r-2 border-t-2 border-[var(--foreground)]" />
        </motion.div>
      </div>

      <div className="relative flex min-w-0 flex-1 flex-col justify-between py-[1px]">
        <div className="flex items-start justify-between gap-2">
          <span className="data text-[10px] text-[var(--foreground-faint)]">
            {max.toFixed(1)}
          </span>
        </div>

        <motion.div
          className="absolute left-0 right-0"
          initial={false}
          animate={{ bottom: `calc(${position * 100}% - 11px)` }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
        >
          <div className="flex items-baseline gap-1">
            <span className="readout text-[22px] text-[var(--foreground)]">
              {value > 0 ? "+" : ""}
              {value.toFixed(2)}
            </span>
            <span className="data text-[10px] text-[var(--foreground-muted)]">{unit}</span>
          </div>
          {label && (
            <p className="label mt-0.5 text-[8.5px] leading-tight">{label}</p>
          )}
        </motion.div>

        {markers.map((marker) => (
          <div
            key={marker.label}
            className="pointer-events-none absolute left-0 right-0 flex items-center gap-1.5"
            style={{ bottom: `calc(${clamp(marker.value) * 100}% - 4px)` }}
          >
            <span className="h-px w-3 bg-[var(--border-strong)]" />
            <span className="data text-[9px] text-[var(--foreground-faint)]">
              {marker.label} {marker.value.toFixed(1)}
            </span>
          </div>
        ))}

        <span className="data text-[10px] text-[var(--foreground-faint)]">
          {min.toFixed(1)}
        </span>
      </div>
    </figure>
  );
}
