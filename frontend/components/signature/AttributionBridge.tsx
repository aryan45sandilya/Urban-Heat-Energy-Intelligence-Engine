"use client";

import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/cn";
import { signed } from "@/lib/format";
import type { Explanation } from "@/lib/types";

/**
 * UHEI signature #3 — the attribution bridge.
 *
 * SHAP values read as a span between two piers: the model's average output on
 * the left, this prediction on the right, and one girder per input showing how
 * far it pushed the value and in which direction. Warm girders push the
 * anomaly up, cool girders pull it down, and the deck is drawn to scale so the
 * eye can compare magnitudes without reading a single number.
 */
export function AttributionBridge({
  explanation,
  unit = "°C",
  decimals = 2,
  max = 8,
  className,
}: {
  explanation: Explanation;
  unit?: string;
  decimals?: number;
  max?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const items = explanation.contributions.slice(0, max);
  const widest = Math.max(...items.map((c) => Math.abs(c.contribution)), 1e-6);

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-end justify-between gap-4 border-b border-[var(--border)] pb-2.5">
        <div>
          <p className="label text-[8.5px]">Model average</p>
          <p className="readout mt-1 text-[17px] text-[var(--foreground-muted)]">
            {explanation.base_value.toFixed(decimals)}
            <span className="data ml-1 text-[9px]">{unit}</span>
          </p>
        </div>
        <div className="mb-1 h-px flex-1 bg-[var(--border-strong)]" aria-hidden />
        <div className="text-right">
          <p className="label text-[8.5px]">This prediction</p>
          <p className="readout mt-1 text-[17px] text-[var(--primary)]">
            {explanation.prediction.toFixed(decimals)}
            <span className="data ml-1 text-[9px]">{unit}</span>
          </p>
        </div>
      </div>

      <ul className="mt-3 space-y-[7px]">
        {items.map((item, i) => {
          const positive = item.contribution > 0;
          const width = (Math.abs(item.contribution) / widest) * 50;
          return (
            <li key={item.feature} className="group grid grid-cols-[1fr_auto] items-center gap-3">
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[12px] text-[var(--foreground)]">
                    {item.label}
                  </span>
                  <span className="data shrink-0 text-[10px] text-[var(--foreground-faint)]">
                    {formatValue(item.value)}
                    {item.unit ? ` ${item.unit}` : ""}
                  </span>
                </div>

                <div className="relative mt-[3px] h-[7px]">
                  <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--border-strong)]" aria-hidden />
                  <motion.span
                    className="absolute inset-y-0"
                    style={{
                      background: positive ? "var(--heat-5)" : "var(--mineral)",
                      left: positive ? "50%" : undefined,
                      right: positive ? undefined : "50%",
                    }}
                    initial={reduce ? false : { width: 0 }}
                    animate={{ width: `${width}%` }}
                    transition={{
                      duration: 0.44,
                      delay: reduce ? 0 : 0.05 + i * 0.045,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  />
                </div>
              </div>

              <span
                className="data w-[62px] shrink-0 text-right text-[12px] font-medium"
                style={{ color: positive ? "var(--heat-5)" : "var(--mineral)" }}
              >
                {signed(item.contribution, decimals)}
              </span>
            </li>
          );
        })}
      </ul>

      {Math.abs(explanation.other_features_contribution) > 0.005 && (
        <p className="mt-3 border-t border-dashed border-[var(--border)] pt-2 text-[11px] text-[var(--foreground-faint)]">
          All remaining inputs together:{" "}
          <span className="data">{signed(explanation.other_features_contribution, decimals)} {unit}</span>
        </p>
      )}
    </div>
  );
}

function formatValue(value: number): string {
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  if (Math.abs(value) >= 1) return value.toFixed(2);
  return value.toFixed(3);
}
