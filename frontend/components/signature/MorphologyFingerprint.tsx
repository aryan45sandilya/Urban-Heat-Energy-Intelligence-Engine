"use client";

import { motion, useReducedMotion } from "motion/react";

import type { Morphology } from "@/lib/types";

/**
 * UHEI signature #2 — the morphology fingerprint.
 *
 * Five stacked hairline bars describing the physical fabric within 1 km of a
 * site: how much of the ground is built on, how much is sealed, how much is
 * vegetated, how much is water, and how dense the road network is. The same
 * five-bar shape appears on site cards, map popups and prediction headers, so a
 * reader learns to recognise "dense, sealed, treeless" at a glance.
 */
const CHANNELS = [
  { key: "building_plan_fraction_1km", label: "Built", tone: "var(--heat-5)", max: 0.30 },
  { key: "impervious_fraction_1km", label: "Sealed", tone: "var(--heat-4)", max: 0.50 },
  { key: "green_fraction_1km", label: "Green", tone: "var(--accent)", max: 0.90 },
  { key: "water_fraction_1km", label: "Water", tone: "var(--mineral)", max: 0.25 },
  { key: "road_length_km_km2_1km", label: "Roads", tone: "var(--secondary)", max: 26 },
] as const;

export function MorphologyFingerprint({
  morphology,
  showLabels = true,
  compact = false,
}: {
  morphology: Morphology;
  showLabels?: boolean;
  compact?: boolean;
}) {
  const reduce = useReducedMotion();

  return (
    <div className={compact ? "space-y-[3px]" : "space-y-1.5"}>
      {CHANNELS.map((channel, i) => {
        const raw = (morphology as unknown as Record<string, number>)[channel.key] ?? 0;
        const filled = Math.max(0, Math.min(1, raw / channel.max));
        return (
          <div key={channel.key} className="flex items-center gap-2">
            {showLabels && (
              <span className="label w-[42px] shrink-0 text-[8.5px] leading-none">
                {channel.label}
              </span>
            )}
            <div
              className={`relative flex-1 bg-[var(--surface-sunk)] ${compact ? "h-[3px]" : "h-[5px]"}`}
            >
              <motion.div
                className="absolute inset-y-0 left-0 w-full origin-left"
                style={{ background: channel.tone }}
                initial={reduce ? false : { scaleX: 0 }}
                animate={{ scaleX: filled }}
                transition={{ duration: 0.5, delay: reduce ? 0 : 0.04 * i, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
            {showLabels && (
              <span className="data w-[40px] shrink-0 text-right text-[9px] text-[var(--foreground-muted)]">
                {channel.key === "road_length_km_km2_1km"
                  ? raw.toFixed(1)
                  : `${(raw * 100).toFixed(0)}%`}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
