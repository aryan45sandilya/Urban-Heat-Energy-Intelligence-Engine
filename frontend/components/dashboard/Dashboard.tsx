"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Gauge, MapPin, Sliders } from "lucide-react";

import { ConditionBar } from "./ConditionBar";
import { HotspotLeaderboard } from "./HotspotLeaderboard";
import { NetworkBand } from "./NetworkBand";
import { DEFAULT_CONDITIONS } from "@/components/controls/ConditionPanel";
import { DiurnalChart, GlobalDriversChart, ResponseChart } from "@/components/charts/HeatCharts";
import { EnergyPanel } from "./EnergyPanel";
import {
  Block, BlockHeader, ErrorState, LoadingState, Page, PageHeader, Reveal,
} from "@/components/ui/primitives";
import { useHeatEda, useShap } from "@/hooks/useApi";
import { api, ApiError } from "@/lib/api";
import { fixed, timeLabel } from "@/lib/format";
import type { HeatConditions, HotspotResponse } from "@/lib/types";

/** 23:00 US Eastern on a mid-July 2025 night — when the nocturnal heat island peaks. */
const DEFAULT_TIMESTAMP = "2025-07-16T03:00:00Z";

export function Dashboard() {
  const [conditions, setConditions] = useState<HeatConditions>(DEFAULT_CONDITIONS);
  const [layer, setLayer] = useState<HotspotResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const requestId = useRef(0);

  const { data: eda } = useHeatEda();
  const { data: shap } = useShap("heat");

  const run = useCallback(async (next: HeatConditions) => {
    const id = ++requestId.current;
    setPending(true);
    try {
      const response = await api.hotspots({
        timestamp: DEFAULT_TIMESTAMP,
        conditions: next,
      });
      if (id !== requestId.current) return;
      setLayer(response);
      setError(null);
    } catch (exc) {
      if (id !== requestId.current) return;
      setError(exc instanceof ApiError ? exc.message : "Unexpected failure.");
    } finally {
      if (id === requestId.current) setPending(false);
    }
  }, []);

  // Scoring is kicked off from a timer callback rather than synchronously in the
  // effect body: it coalesces rapid condition changes into one request, and it
  // keeps the state transition out of the render path.
  useEffect(() => {
    const handle = setTimeout(() => void run(conditions), 60);
    return () => clearTimeout(handle);
  }, [conditions, run]);

  const summary = useMemo(() => {
    if (!layer) return null;
    const urban = layer.sites.filter((s) => s.urban_class === "urban");
    const rural = layer.sites.filter((s) => s.urban_class === "rural");
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
    const atRisk = layer.sites.filter(
      (s) => s.heat_risk !== "none" && s.heat_risk !== "caution",
    ).length;
    return {
      hottest: layer.sites[0],
      urbanMean: mean(urban.map((s) => s.uhi_c)),
      ruralMean: mean(rural.map((s) => s.uhi_c)),
      spread: layer.scale.max - layer.scale.min,
      atRisk,
    };
  }, [layer]);

  return (
    <Page>
      <PageHeader
        eyebrow="Intelligence console"
        title="Urban heat across the network, right now"
        lede="Set the background atmosphere once. Every measured site is then scored by the same fitted model under those identical conditions, so the differences you see are the cities themselves."
        aside={
          layer && (
            <div className="text-left lg:text-right">
              <p className="label text-[8.5px]">Evaluated for</p>
              <p className="data mt-1 text-[12px]">{timeLabel(layer.timestamp_local)}</p>
              <p className="label mt-1 text-[8.5px]">
                {layer.model.name} · test R²{" "}
                {layer.model.test_r2 !== null ? fixed(layer.model.test_r2, 3) : "—"}
              </p>
            </div>
          )
        }
      />

      <ConditionBar value={conditions} onChange={setConditions} pending={pending} />

      {error && (
        <div className="py-6">
          <ErrorState message={error} onRetry={() => void run(conditions)} />
        </div>
      )}

      {/* ── Primary intelligence row ──────────────────────────────────── */}
      <div className="grid gap-px bg-[var(--border)] lg:grid-cols-12">
        <Block className="bg-[var(--background)] p-5 lg:col-span-5 lg:p-7">
          <BlockHeader title="Hottest site under these conditions" />
          {!layer ? (
            <LoadingState label="Scoring the network" rows={4} />
          ) : summary?.hottest ? (
            <div>
              <div className="flex items-baseline gap-2">
                <span className="readout text-[clamp(2.6rem,8vw,4rem)] text-[var(--primary)]">
                  +{fixed(summary.hottest.uhi_c, 2)}
                </span>
                <span className="data text-[13px] text-[var(--foreground-muted)]">°C</span>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-[14px] font-medium">
                <MapPin size={13} className="text-[var(--primary)]" />
                {summary.hottest.name}
                <span className="label text-[8.5px]">{summary.hottest.state}</span>
              </p>
              <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--foreground-muted)]">
                The model puts this site {fixed(summary.hottest.uhi_c, 2)} °C above its rural
                reference, giving {fixed(summary.hottest.temp_c, 1)} °C on the thermometer and
                a heat index of {fixed(summary.hottest.heat_index_c, 1)} °C.
              </p>

              <dl className="mt-5 grid grid-cols-3 gap-px border border-[var(--border)] bg-[var(--border)]">
                <Stat label="Urban mean" value={fixed(summary.urbanMean, 2)} unit="°C" />
                <Stat label="Rural mean" value={fixed(summary.ruralMean, 2)} unit="°C" />
                <Stat label="Network spread" value={fixed(summary.spread, 2)} unit="°C" />
              </dl>

              <Link
                href="/map"
                className="label mt-5 inline-flex items-center gap-1.5 text-[var(--primary)]
                           underline-offset-4 hover:underline"
              >
                See the whole network on the map
                <ArrowRight size={11} />
              </Link>
            </div>
          ) : null}
        </Block>

        <Block className="bg-[var(--background)] p-5 lg:col-span-7 lg:p-7">
          <BlockHeader
            title="Where the heat concentrates"
            meta={layer ? `${layer.sites.length} sites · same atmosphere applied to each` : undefined}
          />
          {!layer ? <LoadingState rows={6} /> : <HotspotLeaderboard layer={layer} />}
        </Block>
      </div>

      {/* ── Network band ──────────────────────────────────────────────── */}
      <div className="border-t border-[var(--border)]">
        {layer && <NetworkBand layer={layer} />}
      </div>

      {/* ── Why / when ────────────────────────────────────────────────── */}
      <div className="grid gap-px border-t border-[var(--border)] bg-[var(--border)] lg:grid-cols-12">
        <Block className="bg-[var(--background)] p-5 lg:col-span-7 lg:p-7">
          <BlockHeader
            title="When the heat island appears"
            meta="Measured mean anomaly by hour of day, 2022–2025"
          />
          {eda ? <DiurnalChart eda={eda} height={250} /> : <LoadingState rows={5} />}
          <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--foreground-muted)]">
            Urban sites diverge from their rural references after sunset and stay warm until
            dawn: sealed surfaces release the day&apos;s stored heat while open country radiates
            it away. By mid-afternoon the three classes are nearly indistinguishable.
          </p>
        </Block>

        <Block className="bg-[var(--background)] p-5 lg:col-span-5 lg:p-7">
          <BlockHeader
            title="What the model leans on"
            meta={shap ? `mean |SHAP| over ${shap.n_samples.toLocaleString()} held-out rows` : undefined}
            action={
              <Link href="/lab" className="label text-[var(--primary)] underline-offset-4 hover:underline">
                Model lab
              </Link>
            }
          />
          {shap ? (
            <GlobalDriversChart shap={shap} limit={9} height={280} />
          ) : (
            <LoadingState rows={6} />
          )}
          <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--foreground-muted)]">
            Bars are the average size of each input&apos;s contribution, in degrees. Warm bars
            push the anomaly up on average, cool bars pull it down. This is how the model
            uses its inputs — not a claim about cause.
          </p>
        </Block>
      </div>

      {/* ── Morphology response ───────────────────────────────────────── */}
      <div className="grid gap-px border-t border-[var(--border)] bg-[var(--border)] lg:grid-cols-2">
        <Block className="bg-[var(--background)] p-5 lg:p-7">
          <BlockHeader
            title="Sealed ground against night-time heat"
            meta="Observed summer nights, binned by impervious fraction within 1 km"
          />
          {eda ? (
            <ResponseChart
              points={eda.relationships.impervious_fraction_1km ?? []}
              xLabel="impervious fraction (1 km)"
              xFormatter={(v) => `${(v * 100).toFixed(0)}%`}
            />
          ) : (
            <LoadingState rows={5} />
          )}
        </Block>
        <Block className="bg-[var(--background)] p-5 lg:p-7">
          <BlockHeader
            title="Wind against the heat island"
            meta="Observed across all hours, binned by background wind speed"
          />
          {eda ? (
            <ResponseChart
              points={eda.relationships.wind_speed_ms ?? []}
              xLabel="wind speed (m/s)"
              colour="var(--mineral)"
              xFormatter={(v) => v.toFixed(1)}
            />
          ) : (
            <LoadingState rows={5} />
          )}
        </Block>
      </div>

      {/* ── Energy ────────────────────────────────────────────────────── */}
      <EnergyPanel />

      {/* ── Scenario entry point ──────────────────────────────────────── */}
      <Reveal>
        <section className="my-10 border border-[var(--border)] bg-[var(--surface)]">
          <div className="grid gap-6 p-6 lg:grid-cols-[1fr_auto] lg:items-center lg:p-8">
            <div className="max-w-2xl">
              <p className="label flex items-center gap-1.5">
                <Sliders size={11} />
                What happens next
              </p>
              <h2 className="mt-2.5 text-[clamp(1.3rem,2.6vw,1.8rem)]">
                Change the ground, not just the weather
              </h2>
              <p className="mt-2.5 text-[13.5px] leading-relaxed text-[var(--foreground-muted)]">
                Raise the green cover at a site, cut the sealed surface, thin the road
                network — then run the same fitted model again and read the difference in
                degrees, with the attribution for both runs side by side.
              </p>
            </div>
            <Link
              href="/simulate"
              className="group inline-flex shrink-0 items-center gap-2 bg-[var(--primary)] px-5 py-3
                         text-[13px] font-medium text-white transition-colors hover:bg-[var(--primary-deep)]"
              style={{ borderRadius: "var(--radius-sm)" }}
            >
              <Gauge size={14} />
              Open the simulator
              <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </section>
      </Reveal>
    </Page>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="bg-[var(--surface)] px-3 py-2.5">
      <p className="label text-[8px]">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="readout text-[17px]">{value}</span>
        <span className="data text-[9px] text-[var(--foreground-muted)]">{unit}</span>
      </p>
    </div>
  );
}
