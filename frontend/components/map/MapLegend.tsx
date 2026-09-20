"use client";

/**
 * UHEI's legend is a measuring rule, not a gradient bar: seven discrete stops
 * with tick marks and printed bounds, matching the wordmark and the thermal
 * ladder exactly so one colour means one thing across the whole product.
 */
export function MapLegend({
  label, unit, min, max, format,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  format: (value: number) => string;
}) {
  const stops = [0, 1, 2, 3, 4, 5, 6];
  const mid = (min + max) / 2;

  return (
    <figure
      className="border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_94%,transparent)]
                 p-3 shadow-[var(--shadow)]"
      style={{ borderRadius: "var(--radius)" }}
    >
      <figcaption className="label-strong mb-2 text-[9px]">
        {label} <span className="text-[var(--foreground-faint)]">({unit})</span>
      </figcaption>

      <div className="flex w-[11.5rem] sm:w-[13.5rem]">
        {stops.map((stop) => (
          <span
            key={stop}
            className="h-[9px] flex-1"
            style={{ background: `var(--heat-${stop})` }}
          />
        ))}
      </div>

      <div className="flex w-[11.5rem] sm:w-[13.5rem]">
        {stops.map((stop) => (
          <span key={stop} className="flex-1 border-l border-[var(--border-strong)]" style={{ height: 4 }} />
        ))}
        <span className="border-l border-[var(--border-strong)]" style={{ height: 4 }} />
      </div>

      <div className="mt-0.5 flex w-[11.5rem] justify-between sm:w-[13.5rem]">
        <span className="data text-[9px] text-[var(--foreground-muted)]">{format(min)}</span>
        <span className="data text-[9px] text-[var(--foreground-faint)]">{format(mid)}</span>
        <span className="data text-[9px] text-[var(--foreground-muted)]">{format(max)}</span>
      </div>
    </figure>
  );
}
