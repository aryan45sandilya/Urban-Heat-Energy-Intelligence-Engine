"use client";

import { useMemo, useState } from "react";

import { CLASS_TONE, fixed, heatColor } from "@/lib/format";
import type { HotspotResponse } from "@/lib/types";

/**
 * The whole network as one strip: 166 measured sites ordered from coolest to
 * hottest, each a single column coloured by the model's prediction. It gives
 * the shape of the distribution and the position of any one site in a single
 * glance — far denser than another row of summary cards, and it is the same
 * ramp used by the map and the ladder.
 */
export function NetworkBand({ layer }: { layer: HotspotResponse }) {
  const [hover, setHover] = useState<number | null>(null);
  const sorted = useMemo(
    () => [...layer.sites].sort((a, b) => a.uhi_c - b.uhi_c),
    [layer],
  );
  const { min, max } = layer.scale;
  const active = hover !== null ? sorted[hover] : null;

  return (
    <section className="py-6" aria-label="Network-wide predicted anomaly">
      <div className="flex flex-wrap items-baseline justify-between gap-3 pb-3">
        <h2 className="label-strong">Every measured site, coolest to hottest</h2>
        <p className="data text-[10px] text-[var(--foreground-faint)]">
          {sorted.length} sites · {fixed(min, 2)} °C → {fixed(max, 2)} °C
        </p>
      </div>

      <div
        className="flex h-[68px] items-end gap-[1px] sm:h-[86px]"
        onMouseLeave={() => setHover(null)}
      >
        {sorted.map((site, i) => {
          const t = max > min ? (site.uhi_c - min) / (max - min) : 0.5;
          return (
            <button
              key={site.station_id}
              type="button"
              className="min-w-[2px] flex-1 origin-bottom transition-[opacity,transform] duration-150
                         focus-visible:outline-none"
              style={{
                background: heatColor(site.uhi_c, min, max),
                height: `${14 + t * 86}%`,
                opacity: hover === null || hover === i ? 1 : 0.4,
                transform: hover === i ? "scaleX(2)" : undefined,
              }}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              aria-label={`${site.name}: ${site.uhi_c.toFixed(2)} degrees Celsius`}
            />
          );
        })}
      </div>

      <div className="mt-2.5 flex min-h-[34px] items-start justify-between gap-4 border-t border-[var(--border)] pt-2.5">
        {active ? (
          <p className="flex min-w-0 items-baseline gap-2">
            <span
              className="h-[7px] w-[7px] shrink-0 translate-y-[-1px]"
              style={{ background: CLASS_TONE[active.urban_class] }}
              aria-hidden
            />
            <span className="truncate text-[12.5px] font-medium">{active.name}</span>
            <span className="label shrink-0 text-[8.5px]">{active.urban_class}</span>
            <span className="data shrink-0 text-[12.5px] text-[var(--primary)]">
              {active.uhi_c > 0 ? "+" : ""}
              {fixed(active.uhi_c, 2)} °C
            </span>
          </p>
        ) : (
          <p className="text-[11.5px] text-[var(--foreground-muted)]">
            Hover or tab through a column to identify a site.
          </p>
        )}
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="label text-[8px]">cooler</span>
          <span className="flex h-[7px] w-24">
            {[0, 1, 2, 3, 4, 5, 6].map((stop) => (
              <span key={stop} className="flex-1" style={{ background: `var(--heat-${stop})` }} />
            ))}
          </span>
          <span className="label text-[8px]">hotter</span>
        </div>
      </div>
    </section>
  );
}
