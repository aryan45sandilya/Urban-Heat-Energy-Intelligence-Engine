"use client";

/**
 * Shared chart language.
 *
 * Recharts ships a look that belongs to no product in particular. Everything
 * here replaces it: the axes are hairlines, the grid is the same rule colour as
 * the page, the tooltip is a bordered slab with monospaced figures, and every
 * series colour is drawn from the thermal ramp so charts, map and ladder agree.
 */

export const AXIS = {
  stroke: "var(--border-strong)",
  tickLine: false,
  axisLine: { stroke: "var(--border-strong)" },
  tick: { fill: "var(--foreground-muted)", fontSize: 10 },
} as const;

export const GRID = {
  stroke: "var(--rule)",
  strokeDasharray: "0",
  vertical: false,
} as const;

export const SERIES = {
  primary: "var(--primary)",
  secondary: "var(--secondary)",
  accent: "var(--accent)",
  mineral: "var(--mineral)",
  muted: "var(--foreground-faint)",
} as const;

export const CLASS_SERIES: Record<string, string> = {
  urban: "var(--heat-5)",
  suburban: "var(--heat-3)",
  rural: "var(--accent)",
};

/** Recharts injects these into whatever element is passed as `content`. */
interface TooltipItem {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

export interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipItem[];
  label?: unknown;
  unit?: string;
  labelFormatter?: (label: unknown) => string;
  valueFormatter?: (value: number, name: string) => string;
}

export function ChartTooltip({
  active, payload, label, unit = "", labelFormatter, valueFormatter,
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="border border-[var(--border-strong)] bg-[var(--surface-elevated)] px-2.5 py-2
                 shadow-[var(--shadow)]"
      style={{ borderRadius: "var(--radius-sm)" }}
    >
      {label !== undefined && (
        <p className="label mb-1.5 text-[9px]">
          {labelFormatter ? labelFormatter(label) : String(label)}
        </p>
      )}
      <div className="space-y-1">
        {payload.map((entry: TooltipItem, i: number) => (
          <div key={i} className="flex items-center gap-2.5">
            <span
              className="h-[8px] w-[8px] shrink-0"
              style={{ background: entry.color ?? "var(--foreground)" }}
            />
            <span className="text-[11px] text-[var(--foreground-muted)]">{entry.name}</span>
            <span className="data ml-auto text-[11px] font-medium text-[var(--foreground)]">
              {valueFormatter && typeof entry.value === "number"
                ? valueFormatter(entry.value, String(entry.name))
                : `${typeof entry.value === "number" ? entry.value.toFixed(2) : entry.value}${unit}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const CHART_MARGIN = { top: 8, right: 12, bottom: 4, left: -14 };
