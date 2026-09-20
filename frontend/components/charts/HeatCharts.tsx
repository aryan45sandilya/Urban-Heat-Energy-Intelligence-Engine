"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

import { AXIS, CHART_MARGIN, CLASS_SERIES, ChartTooltip, GRID } from "./chartTheme";
import { MONTHS, heatColor } from "@/lib/format";
import type { BinnedPoint, HeatEda, ShapGlobal } from "@/lib/types";

/** Diurnal cycle of the anomaly, one line per site class. */
export function DiurnalChart({ eda, height = 230 }: { eda: HeatEda; height?: number }) {
  const hours = Array.from({ length: 24 }, (_, hour) => {
    const row: Record<string, number> = { hour };
    for (const series of eda.diurnal_by_class) {
      const point = series.points.find((p) => p.hour === hour);
      if (point) row[series.class] = Number(point.mean.toFixed(3));
    }
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={hours} margin={CHART_MARGIN}>
        <defs>
          {Object.entries(CLASS_SERIES).map(([key, colour]) => (
            <linearGradient key={key} id={`diurnal-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colour} stopOpacity={0.22} />
              <stop offset="100%" stopColor={colour} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid {...GRID} />
        <XAxis
          dataKey="hour"
          {...AXIS}
          ticks={[0, 4, 8, 12, 16, 20]}
          tickFormatter={(h) => `${String(h).padStart(2, "0")}:00`}
        />
        <YAxis {...AXIS} width={46} tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}`} />
        <ReferenceLine y={0} stroke="var(--border-strong)" strokeWidth={1} />
        <Tooltip
          content={
            <ChartTooltip
              unit=" °C"
              labelFormatter={(h) => `${String(h).padStart(2, "0")}:00 US Eastern`}
            />
          }
          cursor={{ stroke: "var(--foreground-faint)", strokeDasharray: "3 3" }}
        />
        {["rural", "suburban", "urban"].map((cls) => (
          <Area
            key={cls}
            type="monotone"
            dataKey={cls}
            name={cls}
            stroke={CLASS_SERIES[cls]}
            strokeWidth={2}
            fill={`url(#diurnal-${cls})`}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Any binned relationship with an inter-quartile band. */
export function ResponseChart({
  points, xLabel, yLabel = "ΔT (°C)", height = 210, colour = "var(--primary)",
  xFormatter, unit = " °C",
}: {
  points: BinnedPoint[];
  xLabel: string;
  yLabel?: string;
  height?: number;
  colour?: string;
  xFormatter?: (value: number) => string;
  unit?: string;
}) {
  const data = points.map((p) => ({
    x: Number(p.x.toFixed(3)),
    mean: Number(p.y.toFixed(3)),
    band: [Number(p.y_p25.toFixed(3)), Number(p.y_p75.toFixed(3))] as [number, number],
    count: p.count,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid {...GRID} />
        <XAxis
          dataKey="x"
          type="number"
          domain={["dataMin", "dataMax"]}
          {...AXIS}
          tickFormatter={xFormatter ?? ((v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)))}
          label={{
            value: xLabel, position: "insideBottom", offset: -2,
            style: { fill: "var(--foreground-faint)", fontSize: 9,
              fontFamily: "var(--font-mono)", letterSpacing: "0.08em" },
          }}
          height={38}
        />
        <YAxis {...AXIS} width={46} tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}`} />
        <ReferenceLine y={0} stroke="var(--border-strong)" />
        <Tooltip
          content={<ChartTooltip unit={unit} labelFormatter={(v) => `${xLabel}: ${Number(v).toFixed(2)}`} />}
          cursor={{ stroke: "var(--foreground-faint)", strokeDasharray: "3 3" }}
        />
        <Area
          dataKey="band"
          name="interquartile range"
          stroke="none"
          fill={colour}
          fillOpacity={0.13}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="mean"
          name={yLabel}
          stroke={colour}
          strokeWidth={2}
          dot={{ r: 2, fill: colour, strokeWidth: 0 }}
          activeDot={{ r: 4, strokeWidth: 0 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Distribution of the target, coloured by the thermal ramp. */
export function DistributionChart({ eda, height = 190 }: { eda: HeatEda; height?: number }) {
  const data = eda.distribution.map((bin) => ({
    mid: Number(bin.mid.toFixed(2)),
    count: bin.count,
  }));
  const lo = data[0]?.mid ?? -4;
  const hi = data[data.length - 1]?.mid ?? 6;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={CHART_MARGIN} barCategoryGap={0}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="mid" {...AXIS} interval={Math.floor(data.length / 8)} />
        <YAxis {...AXIS} width={46} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)} />
        <ReferenceLine x={0} stroke="var(--foreground)" strokeDasharray="3 3" />
        <Tooltip
          content={
            <ChartTooltip
              unit=" site-hours"
              labelFormatter={(v) => `ΔT ≈ ${Number(v).toFixed(2)} °C`}
              valueFormatter={(value) => value.toLocaleString()}
            />
          }
          cursor={{ fill: "var(--surface-sunk)" }}
        />
        <Bar dataKey="count" name="site-hours" isAnimationActive={false}>
          {data.map((entry) => (
            <Cell key={entry.mid} fill={heatColor(entry.mid, lo, hi)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Global SHAP importance — mean |contribution| in target units. */
export function GlobalDriversChart({
  shap, limit = 10, height = 300, unit = "°C",
}: {
  shap: ShapGlobal;
  limit?: number;
  height?: number;
  unit?: string;
}) {
  const data = shap.ranking.slice(0, limit).map((row) => ({
    label: row.label.length > 26 ? `${row.label.slice(0, 25)}…` : row.label,
    value: Number(row.mean_abs_shap.toFixed(4)),
    direction: row.mean_shap,
  })).reverse();

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
        <CartesianGrid {...GRID} horizontal={false} vertical />
        <XAxis type="number" {...AXIS} tickFormatter={(v) => v.toFixed(2)} />
        <YAxis
          type="category"
          dataKey="label"
          {...AXIS}
          width={150}
          tick={{ fill: "var(--foreground-muted)", fontSize: 10 }}
        />
        <Tooltip
          content={
            <ChartTooltip
              unit={` ${unit}`}
              valueFormatter={(value) => `${value.toFixed(3)} ${unit}`}
            />
          }
          cursor={{ fill: "var(--surface-sunk)" }}
        />
        <Bar dataKey="value" name="mean |SHAP|" isAnimationActive={false} barSize={11}>
          {data.map((entry) => (
            <Cell
              key={entry.label}
              fill={entry.direction >= 0 ? "var(--heat-5)" : "var(--mineral)"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Seasonal profile of the anomaly. */
export function SeasonalChart({ eda, height = 190 }: { eda: HeatEda; height?: number }) {
  const data = eda.seasonal.map((row) => ({
    month: MONTHS[row.month - 1],
    mean: Number(row.mean.toFixed(3)),
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="month" {...AXIS} />
        <YAxis {...AXIS} width={46} tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}`} />
        <ReferenceLine y={0} stroke="var(--border-strong)" />
        <Tooltip content={<ChartTooltip unit=" °C" />} cursor={{ fill: "var(--surface-sunk)" }} />
        <Bar dataKey="mean" name="mean ΔT" isAnimationActive={false}>
          {data.map((entry) => (
            <Cell key={entry.month} fill={heatColor(entry.mean, -0.2, 0.9)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
