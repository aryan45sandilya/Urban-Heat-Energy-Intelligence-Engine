"use client";

import { useHeatEda, useMeta } from "@/hooks/useApi";
import { Page, Skeleton } from "@/components/ui/primitives";
import { compact, fixed } from "@/lib/format";

/**
 * A band of measured facts, not a row of identical metric cards: each cell has
 * its own unit, its own scale and its own caption, separated by hairlines.
 */
export function NetworkStats() {
  const { data: meta } = useMeta();
  const { data: eda } = useHeatEda();

  const heat = meta?.tasks?.heat;
  const testMetrics = heat?.metrics?.test as { r2?: number; mae?: number } | undefined;

  const cells = [
    {
      value: meta ? String(meta.network.stations) : null,
      unit: "stations",
      caption: "Physical weather stations in the observation network",
    },
    {
      value: eda ? compact(eda.rows) : null,
      unit: "site-hours",
      caption: `Hourly observations behind the heat model, ${eda?.period.start.slice(0, 4) ?? "—"}–${eda?.period.end.slice(0, 4) ?? "—"}`,
    },
    {
      value: eda ? fixed(eda.target.p99, 2) : null,
      unit: "°C",
      caption: "99th-percentile measured urban–rural anomaly",
    },
    {
      value: testMetrics?.r2 !== undefined ? fixed(testMetrics.r2, 3) : null,
      unit: "R² (test)",
      caption: "Held-out accuracy of the tuned Random Forest",
    },
    {
      value: testMetrics?.mae !== undefined ? fixed(testMetrics.mae, 3) : null,
      unit: "°C MAE",
      caption: "Mean absolute error on the held-out window",
    },
  ];

  return (
    <section className="border-b border-[var(--border)] bg-[var(--surface)]">
      <Page>
        <dl className="grid grid-cols-2 divide-x divide-y divide-[var(--border)] sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
          {cells.map((cell) => (
            <div key={cell.unit} className="px-4 py-6 first:pl-0 lg:px-5 lg:py-7">
              <dd className="flex items-baseline gap-1.5">
                {cell.value === null ? (
                  <Skeleton className="h-7 w-20" />
                ) : (
                  <span className="readout text-[clamp(1.6rem,3.4vw,2.15rem)]">{cell.value}</span>
                )}
                <span className="data text-[10px] text-[var(--foreground-muted)]">{cell.unit}</span>
              </dd>
              <dt className="mt-2.5 text-[11.5px] leading-snug text-[var(--foreground-muted)]">
                {cell.caption}
              </dt>
            </div>
          ))}
        </dl>
      </Page>
    </section>
  );
}
