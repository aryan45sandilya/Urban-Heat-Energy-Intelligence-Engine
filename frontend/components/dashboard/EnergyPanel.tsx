"use client";

import { useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";

import { AXIS, CHART_MARGIN, ChartTooltip, GRID } from "@/components/charts/chartTheme";
import { ResponseChart } from "@/components/charts/HeatCharts";
import { Block, BlockHeader, LoadingState, Tabs } from "@/components/ui/primitives";
import { useEnergyEda, useMeta } from "@/hooks/useApi";
import { SEASONS, compact, fixed } from "@/lib/format";

const SEASON_TONES = ["var(--mineral)", "var(--accent)", "var(--heat-5)", "var(--secondary)"];

export function EnergyPanel() {
  const { data: eda } = useEnergyEda();
  const { data: meta } = useMeta();
  const [view, setView] = useState<"temperature" | "diurnal">("temperature");

  const diurnal = useMemo(() => {
    if (!eda) return [];
    return Array.from({ length: 24 }, (_, hour) => {
      const row: Record<string, number> = { hour };
      for (const series of eda.diurnal_by_season) {
        const point = series.points.find((p) => p.hour === hour);
        if (point) row[SEASONS[series.season]] = Math.round(point.mean);
      }
      return row;
    });
  }, [eda]);

  const energyTask = meta?.tasks?.energy;
  const testMetrics = energyTask?.metrics?.test as { r2?: number; mae?: number } | undefined;

  return (
    <div className="grid gap-px border-t border-[var(--border)] bg-[var(--border)] lg:grid-cols-12">
      <Block className="bg-[var(--background)] p-5 lg:col-span-7 lg:p-7">
        <BlockHeader
          title="Electricity demand responds to the same weather"
          meta={
            eda
              ? `NYISO metered load · ${compact(eda.rows)} zone-hours · ${eda.zones} zones`
              : undefined
          }
          action={
            <Tabs
              options={[
                { value: "temperature", label: "vs temperature" },
                { value: "diurnal", label: "by hour" },
              ]}
              value={view}
              onChange={setView}
            />
          }
        />
        {!eda ? (
          <LoadingState rows={5} />
        ) : view === "temperature" ? (
          <>
            <ResponseChart
              points={eda.load_vs_temperature}
              xLabel="air temperature (°C)"
              yLabel="zonal load (MW)"
              colour="var(--secondary)"
              unit=" MW"
              height={250}
              xFormatter={(v) => v.toFixed(0)}
            />
            <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--foreground-muted)]">
              The characteristic U: demand rises below the 18.3 °C balance point as electric
              heating comes on, and climbs much more steeply above it as air conditioning does.
              That upper arm is where urban heat and the grid meet.
            </p>
          </>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={diurnal} margin={CHART_MARGIN}>
                <CartesianGrid {...GRID} />
                <XAxis
                  dataKey="hour"
                  {...AXIS}
                  ticks={[0, 4, 8, 12, 16, 20]}
                  tickFormatter={(h) => `${String(h).padStart(2, "0")}`}
                />
                <YAxis {...AXIS} width={50} tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`} />
                <Tooltip
                  content={
                    <ChartTooltip
                      unit=" MW"
                      labelFormatter={(h) => `${String(h).padStart(2, "0")}:00 US Eastern`}
                      valueFormatter={(v) => `${v.toLocaleString()} MW`}
                    />
                  }
                  cursor={{ stroke: "var(--foreground-faint)", strokeDasharray: "3 3" }}
                />
                {SEASONS.map((season, i) => (
                  <Line
                    key={season}
                    type="monotone"
                    dataKey={season}
                    name={season}
                    stroke={SEASON_TONES[i]}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
            <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--foreground-muted)]">
              Mean zonal load by hour, split by meteorological season. Summer peaks late in
              the afternoon and stays high into the evening; winter shows the twin morning
              and evening shoulders of a heating-driven system.
            </p>
          </>
        )}
      </Block>

      <Block className="bg-[var(--background)] p-5 lg:col-span-5 lg:p-7">
        <BlockHeader
          title="Load zones"
          meta="Mean and peak metered demand, 2022–2024"
        />
        {!eda ? (
          <LoadingState rows={5} />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart
                data={[...eda.by_zone].sort((a, b) => b.mean_mw - a.mean_mw)}
                layout="vertical"
                margin={{ top: 4, right: 20, bottom: 4, left: 4 }}
              >
                <CartesianGrid {...GRID} horizontal={false} vertical />
                <XAxis
                  type="number"
                  {...AXIS}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                />
                <YAxis
                  type="category"
                  dataKey="zone_name"
                  {...AXIS}
                  width={92}
                  tick={{ fill: "var(--foreground-muted)", fontSize: 10 }}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      valueFormatter={(v) => `${Math.round(v).toLocaleString()} MW`}
                    />
                  }
                  cursor={{ fill: "var(--surface-sunk)" }}
                />
                <Bar dataKey="mean_mw" name="mean load" barSize={11} isAnimationActive={false}>
                  {eda.by_zone.map((zone) => (
                    <Cell
                      key={zone.zone}
                      fill={zone.zone === "N.Y.C." ? "var(--heat-5)" : "var(--secondary)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            <dl className="mt-4 grid grid-cols-2 gap-px border border-[var(--border)] bg-[var(--border)]">
              <div className="bg-[var(--surface)] px-3 py-2.5">
                <dt className="label text-[8px]">Weekday mean</dt>
                <dd className="readout mt-1 text-[16px]">
                  {compact(eda.weekend_effect.weekday_mean_mw)}
                  <span className="data ml-1 text-[9px] text-[var(--foreground-muted)]">MW</span>
                </dd>
              </div>
              <div className="bg-[var(--surface)] px-3 py-2.5">
                <dt className="label text-[8px]">Weekend mean</dt>
                <dd className="readout mt-1 text-[16px]">
                  {compact(eda.weekend_effect.weekend_mean_mw)}
                  <span className="data ml-1 text-[9px] text-[var(--foreground-muted)]">MW</span>
                </dd>
              </div>
            </dl>

            {testMetrics?.r2 !== undefined && (
              <p className="mt-3 text-[11px] text-[var(--foreground-faint)]">
                Demand model held-out R² {fixed(testMetrics.r2, 3)} · MAE{" "}
                {fixed(testMetrics.mae, 0)} MW. Weather and calendar only — no autoregressive
                load term, so this is a demand-response model rather than a dispatch forecast.
              </p>
            )}
          </>
        )}
      </Block>
    </div>
  );
}
