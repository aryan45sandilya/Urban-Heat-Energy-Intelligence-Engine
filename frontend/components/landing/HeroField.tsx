"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";

import { useHotspots } from "@/hooks/useApi";
import { HEAT_RAMP } from "@/lib/format";

/**
 * The hero visual: a transect of the real station network.
 *
 * Each column is one measured site, ordered by how built-up its surroundings
 * are; its height and colour are that site's *observed* mean summer-night
 * anomaly. It is a chart of the data, not decoration — which is the point the
 * landing page needs to make in its first second.
 */
export function HeroField() {
  const reduce = useReducedMotion();
  const { data, error } = useHotspots();

  const columns = useMemo(() => {
    if (!data?.sites?.length) return [];
    return [...data.sites]
      .sort(
        (a, b) =>
          a.morphology.building_count_km2_3km - b.morphology.building_count_km2_3km,
      )
      .map((site) => ({
        id: site.station_id,
        value: site.observed.summer_night_mean_uhi_c,
        name: site.name,
        density: site.morphology.building_count_km2_3km,
      }));
  }, [data]);

  if (error || !columns.length) {
    // No invented placeholder bars — the grid alone until real values arrive.
    return <div className="h-full w-full" aria-hidden />;
  }

  const values = columns.map((c) => c.value);
  const min = Math.min(...values, -0.5);
  const max = Math.max(...values, 1);
  const span = max - min || 1;

  return (
    <div
      className="flex h-full w-full items-end gap-[2px] overflow-hidden"
      role="img"
      aria-label={`Observed mean summer-night urban heat island intensity at ${columns.length} weather stations, ordered by surrounding building density`}
    >
      {columns.map((column, i) => {
        const t = (column.value - min) / span;
        const stop = HEAT_RAMP[Math.min(6, Math.max(0, Math.round(t * 6)))];
        return (
          <motion.span
            key={column.id}
            className="min-w-[2px] flex-1 origin-bottom"
            style={{ background: stop, height: `${8 + t * 92}%` }}
            initial={reduce ? false : { scaleY: 0, opacity: 0 }}
            animate={{ scaleY: 1, opacity: 1 }}
            transition={{
              duration: 0.5,
              delay: reduce ? 0 : Math.min(1.2, i * 0.006),
              ease: [0.16, 1, 0.3, 1],
            }}
            title={`${column.name} · ${column.value >= 0 ? "+" : ""}${column.value.toFixed(2)} °C`}
          />
        );
      })}
    </div>
  );
}
