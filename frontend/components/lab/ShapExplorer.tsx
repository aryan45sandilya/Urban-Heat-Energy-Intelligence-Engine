"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";

import { AXIS, CHART_MARGIN, ChartTooltip, GRID } from "@/components/charts/chartTheme";
import { heatColor } from "@/lib/format";
import type { ShapGlobal } from "@/lib/types";

export function ShapExplorer({ shap, unit }: { shap: ShapGlobal; unit: string }) {
  const available = shap.dependence.map((d) => d.feature);
  const [feature, setFeature] = useState(available[0] ?? "");

  const dependence = useMemo(
    () => shap.dependence.find((d) => d.feature === feature),
    [shap, feature],
  );
  const summary = useMemo(
    () => shap.summary.find((s) => s.feature === feature),
    [shap, feature],
  );

  const scatter = useMemo(() => {
    if (!summary) return [];
    const values = summary.points.map((p) => p.value);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    return summary.points.map((p) => ({ ...p, colour: heatColor(p.value, lo, hi) }));
  }, [summary]);

  if (!available.length) {
    return (
      <p className="text-[12px] text-[var(--foreground-muted)]">
        No dependence structure was stored for this model.
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 pb-5">
        {shap.dependence.map((entry) => (
          <button
            key={entry.feature}
            type="button"
            onClick={() => setFeature(entry.feature)}
            className={`border px-2.5 py-1.5 text-[11px] transition-colors ${
              feature === entry.feature
                ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary-deep)]"
                : "border-[var(--border)] text-[var(--foreground-muted)] hover:border-[var(--foreground)] hover:text-[var(--foreground)]"
            }`}
            style={{ borderRadius: "var(--radius-sm)" }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="grid gap-px bg-[var(--border)] lg:grid-cols-2">
        <div className="bg-[var(--background)] lg:pr-6">
          <p className="label-strong mb-1">Average effect across the range</p>
          <p className="mb-3 text-[11px] text-[var(--foreground-faint)]">
            Mean SHAP contribution within quantile bins of {dependence?.label.toLowerCase()}
          </p>
          {dependence && (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart
                data={dependence.bins.map((bin) => ({
                  value: Number(bin.value.toFixed(3)),
                  shap: Number(bin.mean_shap.toFixed(4)),
                  count: bin.count,
                }))}
                margin={CHART_MARGIN}
              >
                <CartesianGrid {...GRID} />
                <XAxis
                  dataKey="value"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  {...AXIS}
                  tickFormatter={(v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2))}
                />
                <YAxis {...AXIS} width={52} tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}`} />
                <ReferenceLine y={0} stroke="var(--border-strong)" />
                <Tooltip
                  content={
                    <ChartTooltip
                      unit={` ${unit}`}
                      labelFormatter={(v) =>
                        `${dependence.label}: ${Number(v).toFixed(2)} ${dependence.unit}`
                      }
                    />
                  }
                  cursor={{ stroke: "var(--foreground-faint)", strokeDasharray: "3 3" }}
                />
                <Line
                  type="monotone"
                  dataKey="shap"
                  name="mean SHAP"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  dot={{ r: 2.5, fill: "var(--primary)", strokeWidth: 0 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-[var(--background)] lg:pl-6">
          <p className="label-strong mb-1">Spread of individual contributions</p>
          <p className="mb-3 text-[11px] text-[var(--foreground-faint)]">
            One point per held-out row; vertical spread is the interaction with everything else
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <ScatterChart margin={CHART_MARGIN}>
              <CartesianGrid {...GRID} />
              <XAxis
                dataKey="value"
                type="number"
                {...AXIS}
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2))}
              />
              <YAxis
                dataKey="shap"
                type="number"
                {...AXIS}
                width={52}
                tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`}
              />
              <ZAxis range={[14, 14]} />
              <ReferenceLine y={0} stroke="var(--border-strong)" />
              <Tooltip
                content={
                  <ChartTooltip
                    unit={` ${unit}`}
                    valueFormatter={(value) => `${value.toFixed(3)} ${unit}`}
                  />
                }
                cursor={{ strokeDasharray: "3 3", stroke: "var(--foreground-faint)" }}
              />
              <Scatter data={scatter} name="SHAP" isAnimationActive={false} fillOpacity={0.6}>
                {scatter.map((point, i) => (
                  <Cell key={i} fill={point.colour} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>

      <p className="mt-4 max-w-3xl text-[11.5px] leading-relaxed text-[var(--foreground-muted)]">
        A SHAP value is the model&apos;s attribution, in {unit}, of part of its output to one
        input given the rest. A rising line means the model associates larger values of this
        input with a larger prediction. It does not mean that changing the world would change
        the measurement — that is a different claim, and this model cannot support it.
      </p>
    </div>
  );
}
