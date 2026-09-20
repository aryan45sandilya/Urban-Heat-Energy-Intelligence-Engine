"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Clock, Play } from "lucide-react";

import { AttributionBridge } from "@/components/signature/AttributionBridge";
import { ConditionPanel, DEFAULT_CONDITIONS, DEFAULT_LIMITS } from "@/components/controls/ConditionPanel";
import { HeatReadout } from "@/components/prediction/HeatReadout";
import { SitePicker, SiteSummaryCard } from "@/components/site/SitePicker";
import {
  Block, BlockHeader, Button, ErrorState, LoadingState, Page, PageHeader, Panel,
} from "@/components/ui/primitives";
import { useFeatures, useHotspots, useSites } from "@/hooks/useApi";
import { api, ApiError } from "@/lib/api";
import { fixed, timeLabel } from "@/lib/format";
import type { HeatConditions, HeatPredictResponse, Site } from "@/lib/types";

const HOURS = [
  { label: "23:00 — deep night", iso: "2024-07-16T03:00:00Z" },
  { label: "05:00 — before dawn", iso: "2024-07-16T09:00:00Z" },
  { label: "14:00 — afternoon", iso: "2024-07-16T18:00:00Z" },
  { label: "19:00 — early evening", iso: "2024-07-16T23:00:00Z" },
  { label: "23:00 — January night", iso: "2024-01-16T04:00:00Z" },
];

export function PredictionStudio() {
  const { data: sitesData } = useSites();
  const { data: catalogue } = useFeatures("heat");
  const { data: baseline } = useHotspots();

  // The chosen site is derived from the loaded network rather than mirrored into
  // state, so there is no moment where the page holds a site the API has not
  // confirmed — and no effect that has to keep the two in step.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const site: Site | null = useMemo(() => {
    const sites = sitesData?.sites ?? [];
    if (!sites.length) return null;
    return sites.find((candidate) => candidate.station_id === selectedId) ?? sites[0];
  }, [sitesData, selectedId]);

  const [conditions, setConditions] = useState<HeatConditions>(DEFAULT_CONDITIONS);
  const [timestamp, setTimestamp] = useState(HOURS[0].iso);
  const [result, setResult] = useState<HeatPredictResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const requestId = useRef(0);

  const limits = useMemo(() => {
    if (!catalogue) return DEFAULT_LIMITS;
    const range = (name: string, fallback: [number, number]): [number, number] => {
      const spec = catalogue.features.find((f) => f.name === name);
      return spec ? [Number(spec.p01.toFixed(1)), Number(spec.p99.toFixed(1))] : fallback;
    };
    return {
      t_ref_c: range("t_ref_c", DEFAULT_LIMITS.t_ref_c),
      relative_humidity_pct: range("rh_ref_pct", DEFAULT_LIMITS.relative_humidity_pct),
      wind_speed_ms: [0, range("wind_speed_ms", DEFAULT_LIMITS.wind_speed_ms)[1]] as [number, number],
      sky_cover_oktas: [0, 8] as [number, number],
      slp_hpa: range("slp_hpa", DEFAULT_LIMITS.slp_hpa),
      precip_1h_mm: [0, Math.max(2, range("precip_1h_mm", DEFAULT_LIMITS.precip_1h_mm)[1])] as [number, number],
    };
  }, [catalogue]);

  const networkRange = useMemo((): [number, number] | undefined => {
    if (!baseline) return undefined;
    const [lo, hi] = baseline.summary.modelled_uhi_range_c;
    return [Math.min(lo, -1), Math.max(hi, 1)];
  }, [baseline]);

  // Two phases. Exact tree SHAP costs 1–2 seconds on this forest, and the
  // headline number should never wait for it: the prediction is requested
  // without an explanation and rendered immediately, then the same inputs are
  // sent again with `explain` so the attribution panel fills in behind it.
  const run = useCallback(async () => {
    if (!site) return;
    const id = ++requestId.current;
    const payload = { station_id: site.station_id, timestamp, conditions };

    setPending(true);
    setExplaining(true);
    try {
      const fast = await api.predictHeat({ ...payload, explain: false });
      if (id !== requestId.current) return;
      setResult(fast);
      setError(null);
      setPending(false);

      const explained = await api.predictHeat({ ...payload, explain: true });
      if (id !== requestId.current) return;
      setResult(explained);
    } catch (exc) {
      if (id !== requestId.current) return;
      setError(exc instanceof ApiError ? exc.message : "Unexpected failure.");
      setResult(null);
    } finally {
      if (id === requestId.current) {
        setPending(false);
        setExplaining(false);
      }
    }
  }, [site, conditions, timestamp]);

  // Predictions are cheap and the studio is meant to feel live, so it recomputes
  // as soon as any input settles rather than waiting for a submit button.
  useEffect(() => {
    if (!site) return;
    const handle = setTimeout(() => void run(), 220);
    return () => clearTimeout(handle);
  }, [site, conditions, timestamp, run]);

  return (
    <Page>
      <PageHeader
        eyebrow="Prediction studio"
        title="One site, one moment, one number — and the reason for it"
        lede="Choose a measured location, set the background atmosphere, and the tuned Random Forest predicts how far above its rural surroundings that place sits. Every input range below is the range the model was actually trained on."
        aside={
          result && (
            <div className="text-left lg:text-right">
              <p className="label text-[8.5px]">Model</p>
              <p className="data mt-1 text-[12px]">{result.model.name}</p>
              <p className="label mt-1 text-[8.5px]">
                v{result.model.version} · test RMSE{" "}
                {result.model.test_rmse !== null ? fixed(result.model.test_rmse, 3) : "—"} °C
              </p>
            </div>
          )
        }
      />

      <div className="grid gap-px bg-[var(--border)] xl:grid-cols-12">
        {/* ── Instrument column ─────────────────────────────────────── */}
        <Block className="bg-[var(--background)] p-5 xl:col-span-4 xl:p-6">
          <BlockHeader title="Location" meta="166 physical weather stations" />
          <SitePicker
            value={site?.station_id ?? null}
            onChange={(next) => setSelectedId(next.station_id)}
            height="17rem"
          />

          {site && (
            <Panel className="mt-5">
              <SiteSummaryCard site={site} />
              {site.observed && (
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[var(--border)] pt-3">
                  <Measured
                    label="Measured night mean"
                    value={`${site.observed.summer_night_mean_uhi_c >= 0 ? "+" : ""}${fixed(site.observed.summer_night_mean_uhi_c, 2)} °C`}
                  />
                  <Measured
                    label="Measured 90th pct"
                    value={`${site.observed.summer_night_p90_uhi_c >= 0 ? "+" : ""}${fixed(site.observed.summer_night_p90_uhi_c, 2)} °C`}
                  />
                  <Measured
                    label="Summer-night hours"
                    value={site.observed.summer_night_hours.toLocaleString()}
                  />
                  <Measured
                    label="Total hours"
                    value={site.observed.annual_hours.toLocaleString()}
                  />
                </dl>
              )}
            </Panel>
          )}

          <div className="mt-6">
            <h3 className="label-strong mb-2.5 flex items-center gap-1.5">
              <Clock size={11} />
              Moment
            </h3>
            <div className="grid gap-1.5">
              {HOURS.map((hour) => (
                <button
                  key={hour.iso}
                  type="button"
                  onClick={() => setTimestamp(hour.iso)}
                  className={`border px-3 py-2 text-left text-[12px] transition-colors ${
                    timestamp === hour.iso
                      ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary-deep)]"
                      : "border-[var(--border)] text-[var(--foreground-muted)] hover:border-[var(--foreground)]"
                  }`}
                  style={{ borderRadius: "var(--radius-sm)" }}
                >
                  {hour.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 border-t border-[var(--border)] pt-5">
            <ConditionPanel
              conditions={conditions}
              onChange={setConditions}
              limits={limits}
              onReset={() => setConditions(DEFAULT_CONDITIONS)}
            />
          </div>

          <Button className="mt-5 w-full" onClick={() => void run()} disabled={pending || !site}>
            <Play size={12} />
            {pending ? "Running the model…" : "Run prediction"}
          </Button>
        </Block>

        {/* ── Result column ─────────────────────────────────────────── */}
        <Block className="bg-[var(--background)] p-5 xl:col-span-8 xl:p-7">
          {error ? (
            <ErrorState message={error} onRetry={() => void run()} />
          ) : !result ? (
            <LoadingState label="Preparing the first prediction" rows={6} />
          ) : (
            <>
              <HeatReadout result={result} networkRange={networkRange} pending={pending} />

              <div className="mt-8 grid gap-px border-t border-[var(--border)] bg-[var(--border)] pt-px lg:grid-cols-2">
                <div className="bg-[var(--background)] pr-0 pt-6 lg:pr-6">
                  <BlockHeader
                    title="Why the model reached this number"
                    meta="SHAP attribution, in degrees"
                  />
                  {result.explanation ? (
                    <AttributionBridge explanation={result.explanation} />
                  ) : explaining ? (
                    <LoadingState label="Computing the attribution" rows={5} />
                  ) : (
                    <p className="text-[12px] text-[var(--foreground-muted)]">
                      Explanation unavailable for this prediction.
                    </p>
                  )}
                </div>

                <div className="bg-[var(--background)] pl-0 pt-6 lg:pl-6">
                  <BlockHeader title="Inputs as the model received them" />
                  <dl className="divide-y divide-[var(--border)]">
                    {Object.entries(result.conditions).map(([key, value]) => (
                      <div key={key} className="flex items-baseline justify-between gap-3 py-1.5">
                        <dt className="text-[12px] text-[var(--foreground-muted)]">
                          {LABELS[key] ?? key}
                        </dt>
                        <dd className="data text-[12px]">{fixed(value, 2)}</dd>
                      </div>
                    ))}
                    <div className="flex items-baseline justify-between gap-3 py-1.5">
                      <dt className="text-[12px] text-[var(--foreground-muted)]">Local time</dt>
                      <dd className="data text-[12px]">{timeLabel(result.timestamp_local)}</dd>
                    </div>
                  </dl>

                  <p className="mt-4 border-t border-[var(--border)] pt-3 text-[11px] leading-relaxed text-[var(--foreground-faint)]">
                    {result.explanation?.interpretation ?? result.disclaimer}
                  </p>

                  <Link
                    href="/simulate"
                    className="label mt-4 inline-flex items-center gap-1.5 text-[var(--primary)]
                               underline-offset-4 hover:underline"
                  >
                    Change the ground and rerun
                    <ArrowRight size={11} />
                  </Link>
                </div>
              </div>
            </>
          )}
        </Block>
      </div>
    </Page>
  );
}

const LABELS: Record<string, string> = {
  t_ref_c: "Background temperature (°C)",
  dewpoint_ref_c: "Background dew point (°C)",
  wind_speed_ms: "Wind speed (m/s)",
  sky_cover_oktas: "Cloud cover (oktas)",
  slp_hpa: "Sea-level pressure (hPa)",
  precip_1h_mm: "Rainfall, past hour (mm)",
};

function Measured({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label text-[8px]">{label}</dt>
      <dd className="data mt-0.5 text-[12px]">{value}</dd>
    </div>
  );
}
