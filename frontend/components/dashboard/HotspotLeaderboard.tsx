"use client";

import { motion, useReducedMotion } from "motion/react";

import { CLASS_TONE, RISK_LABELS, fixed, heatColor } from "@/lib/format";
import type { HotspotResponse } from "@/lib/types";

export function HotspotLeaderboard({
  layer, limit = 10,
}: {
  layer: HotspotResponse;
  limit?: number;
}) {
  const reduce = useReducedMotion();
  const rows = layer.sites.slice(0, limit);
  const { min, max } = layer.scale;

  return (
    <div>
      <div
        className="grid items-center gap-3 border-b border-[var(--border)] pb-1.5
                   [grid-template-columns:1.4rem_minmax(0,1fr)_5rem_4.5rem]
                   sm:[grid-template-columns:1.6rem_minmax(0,1fr)_7rem_5rem_5.5rem]"
      >
        <span className="label text-[8px]">#</span>
        <span className="label text-[8px]">Site</span>
        <span className="label hidden text-[8px] sm:block">Anomaly</span>
        <span className="label text-right text-[8px] sm:text-left">ΔT °C</span>
        <span className="label text-right text-[8px]">Feels like</span>
      </div>

      <ul className="divide-y divide-[var(--border)]">
        {rows.map((site, i) => {
          const risk = RISK_LABELS[site.heat_risk];
          const width = max > min ? ((site.uhi_c - min) / (max - min)) * 100 : 0;
          return (
            <li
              key={site.station_id}
              className="grid items-center gap-3 py-2.5
                         [grid-template-columns:1.4rem_minmax(0,1fr)_5rem_4.5rem]
                         sm:[grid-template-columns:1.6rem_minmax(0,1fr)_7rem_5rem_5.5rem]"
            >
              <span className="data text-[10px] text-[var(--foreground-faint)]">
                {String(i + 1).padStart(2, "0")}
              </span>

              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-[6px] w-[6px] shrink-0"
                    style={{ background: CLASS_TONE[site.urban_class] }}
                    aria-hidden
                  />
                  <span className="truncate text-[12.5px]">{site.name}</span>
                </span>
                <span className="label mt-0.5 block text-[8px]">
                  {site.state} · {site.building_count_km2_3km.toFixed(0)} bldg/km² ·{" "}
                  {(site.green_fraction_1km * 100).toFixed(0)}% green
                </span>
              </span>

              <span className="hidden h-[6px] bg-[var(--surface-sunk)] sm:block">
                <motion.span
                  className="block h-full"
                  style={{ background: heatColor(site.uhi_c, min, max) }}
                  initial={reduce ? false : { width: 0 }}
                  animate={{ width: `${Math.max(2, width)}%` }}
                  transition={{ duration: 0.4, delay: reduce ? 0 : i * 0.025, ease: [0.16, 1, 0.3, 1] }}
                />
              </span>

              <span className="data text-right text-[13px] font-medium sm:text-left">
                {site.uhi_c > 0 ? "+" : ""}
                {fixed(site.uhi_c, 2)}
              </span>

              <span className="text-right">
                <span className="data block text-[12px]">{fixed(site.heat_index_c, 1)}</span>
                {risk && (
                  <span className="label block text-[7.5px]" style={{ color: risk.tone }}>
                    {risk.label}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
