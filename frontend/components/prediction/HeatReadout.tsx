"use client";

import { motion, useReducedMotion } from "motion/react";

import { ThermalLadder } from "@/components/signature/ThermalLadder";
import { RISK_LABELS, fixed } from "@/lib/format";
import type { HeatPredictResponse } from "@/lib/types";

/**
 * The prediction is the page. It gets the largest type in the product, its own
 * scale beside it, and the two derived quantities a reader immediately wants:
 * what the thermometer would read, and what it would feel like.
 */
export function HeatReadout({
  result, networkRange, pending,
}: {
  result: HeatPredictResponse;
  networkRange?: [number, number];
  pending?: boolean;
}) {
  const reduce = useReducedMotion();
  const { prediction, risk } = result;
  const risky = RISK_LABELS[risk.band] ?? { label: risk.band, tone: "var(--foreground)" };
  const [min, max] = networkRange ?? [-2, 6];

  return (
    <div className={pending ? "opacity-55 transition-opacity" : "transition-opacity"}>
      <div className="grid gap-6 sm:grid-cols-[1fr_auto] sm:gap-8">
        <div className="min-w-0">
          <p className="label">Predicted urban heat island intensity</p>

          <motion.div
            key={prediction.uhi_intensity_c}
            className="mt-2 flex items-baseline gap-2"
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="readout text-[clamp(3rem,11vw,5.5rem)] text-[var(--primary)]">
              {prediction.uhi_intensity_c > 0 ? "+" : ""}
              {fixed(prediction.uhi_intensity_c, 2)}
            </span>
            <span className="data text-[15px] text-[var(--foreground-muted)]">°C</span>
          </motion.div>

          <p className="mt-1 max-w-md text-[13px] leading-relaxed text-[var(--foreground-muted)]">
            above the rural landscape around it, under these conditions.
          </p>

          <dl className="mt-6 grid grid-cols-2 gap-px border border-[var(--border)] bg-[var(--border)] sm:grid-cols-3">
            <Cell
              label="Site temperature"
              value={fixed(prediction.site_temperature_c, 1)}
              unit="°C"
              note={`background ${fixed(prediction.background_temperature_c, 1)} °C`}
            />
            <Cell
              label="Feels like"
              value={fixed(prediction.heat_index_c, 1)}
              unit="°C"
              note={`at ${fixed(prediction.relative_humidity_pct, 0)}% humidity`}
            />
            <Cell
              label="Heat stress"
              value={risky.label}
              tone={risky.tone}
              note="NWS category"
              small
            />
          </dl>

          <p className="mt-3 text-[11px] leading-relaxed text-[var(--foreground-faint)]">
            {risk.description} {risk.basis}
          </p>
        </div>

        <div className="shrink-0 border-l border-[var(--border)] pl-5 sm:pl-6">
          <p className="label mb-3 text-[8.5px]">Against the network</p>
          <ThermalLadder
            value={prediction.uhi_intensity_c}
            min={min}
            max={max}
            height={200}
            label="this prediction"
          />
        </div>
      </div>
    </div>
  );
}

function Cell({
  label, value, unit, note, tone, small,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  tone?: string;
  small?: boolean;
}) {
  return (
    <div className="bg-[var(--surface)] px-3.5 py-3">
      <dt className="label text-[8.5px]">{label}</dt>
      <dd className="mt-1.5 flex items-baseline gap-1">
        <span
          className={small ? "text-[14px] font-semibold leading-tight" : "readout text-[21px]"}
          style={tone ? { color: tone } : undefined}
        >
          {value}
        </span>
        {unit && <span className="data text-[10px] text-[var(--foreground-muted)]">{unit}</span>}
      </dd>
      {note && <p className="mt-1 text-[10.5px] text-[var(--foreground-faint)]">{note}</p>}
    </div>
  );
}
