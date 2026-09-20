"use client";

import { useCallback, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

import { AttributionBridge } from "@/components/signature/AttributionBridge";
import { BlockHeader, LoadingState } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { RISK_LABELS, fixed, signed } from "@/lib/format";
import type { Explanation, HeatConditions, HeatSimulateResponse } from "@/lib/types";
import type { ScenarioDraft } from "./ScenarioEditor";

/**
 * Baseline against scenarios, as a single comparison instrument.
 *
 * The baseline is anchored on the left at full size. Each scenario is a column
 * whose bar is drawn on a shared axis through the baseline, so a reader can see
 * at a glance which interventions move the number and by how much — before
 * reading a single figure.
 */
export function ScenarioBoard({
  result, pending, stationId, timestamp, baselineConditions, scenarios,
}: {
  result: HeatSimulateResponse;
  pending?: boolean;
  stationId: string | null;
  timestamp: string;
  baselineConditions: HeatConditions;
  scenarios: ScenarioDraft[];
}) {
  const reduce = useReducedMotion();
  const [openScenario, setOpenScenario] = useState<string | null>(null);
  const [attributions, setAttributions] = useState<Record<string, Explanation>>({});
  const [explaining, setExplaining] = useState<string | null>(null);

  /* Scenario attributions cost 1–2 seconds each, so they are fetched when a
     reader actually opens one, and kept once fetched. */
  const toggle = useCallback(
    async (name: string) => {
      if (openScenario === name) {
        setOpenScenario(null);
        return;
      }
      setOpenScenario(name);
      if (attributions[name] || !stationId) return;

      const draft = scenarios.find((scenario) => scenario.name === name);
      if (!draft) return;

      setExplaining(name);
      try {
        const response = await api.predictHeat({
          station_id: stationId,
          timestamp,
          conditions: draft.conditions ?? baselineConditions,
          overrides: draft.overrides,
          explain: true,
        });
        if (response.explanation) {
          setAttributions((current) => ({ ...current, [name]: response.explanation! }));
        }
      } catch {
        /* The panel simply stays empty; the scenario result itself is unaffected. */
      } finally {
        setExplaining((current) => (current === name ? null : current));
      }
    },
    [openScenario, attributions, stationId, timestamp, baselineConditions, scenarios],
  );

  const baseline = result.baseline.prediction.uhi_intensity_c;
  const all = [baseline, ...result.scenarios.map((s) => s.prediction.uhi_intensity_c)];
  const lo = Math.min(...all, 0) - 0.25;
  const hi = Math.max(...all, 0) + 0.25;
  const span = hi - lo || 1;
  const zero = ((0 - lo) / span) * 100;
  const pos = (value: number) => ((value - lo) / span) * 100;

  const baselineRisk = RISK_LABELS[result.baseline.risk.band];

  return (
    <div className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
      {/* ── Baseline ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border)] pb-5">
        <div>
          <p className="label">Baseline · {result.site.name}</p>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="readout text-[clamp(2.4rem,7vw,3.6rem)]">
              {baseline > 0 ? "+" : ""}
              {fixed(baseline, 2)}
            </span>
            <span className="data text-[13px] text-[var(--foreground-muted)]">°C anomaly</span>
          </div>
          <p className="mt-1.5 text-[12.5px] text-[var(--foreground-muted)]">
            {fixed(result.baseline.prediction.site_temperature_c, 1)} °C on the thermometer ·
            feels like {fixed(result.baseline.prediction.heat_index_c, 1)} °C
            {baselineRisk && (
              <>
                {" · "}
                <span style={{ color: baselineRisk.tone }}>{baselineRisk.label}</span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* ── Scenario columns ─────────────────────────────────────────── */}
      <div className="mt-6">
        <BlockHeader
          title="Scenario outcomes"
          meta="Same model, same moment, modified inputs"
        />

        <div className="grid gap-px bg-[var(--border)] sm:grid-cols-2 2xl:grid-cols-3">
          {result.scenarios.map((scenario, index) => {
            const value = scenario.prediction.uhi_intensity_c;
            const cooler = scenario.delta_uhi_c < 0;
            const tone = cooler ? "var(--accent)" : "var(--heat-5)";
            const risk = RISK_LABELS[scenario.risk.band];
            const open = openScenario === scenario.name;

            return (
              <div key={scenario.name} className="bg-[var(--background)] p-4 lg:p-5">
                <p className="font-[family-name:var(--font-display)] text-[14px] font-semibold">
                  {scenario.name}
                </p>
                {scenario.description && (
                  <p className="mt-1 text-[11.5px] leading-snug text-[var(--foreground-muted)]">
                    {scenario.description}
                  </p>
                )}

                {/* shared axis: baseline tick + scenario bar */}
                <div className="relative mt-4 h-[26px]">
                  <span
                    className="absolute inset-y-0 w-px bg-[var(--border-strong)]"
                    style={{ left: `${zero}%` }}
                    aria-hidden
                  />
                  <span
                    className="absolute inset-y-0 w-[2px] bg-[var(--foreground)]"
                    style={{ left: `${pos(baseline)}%` }}
                    aria-hidden
                    title="baseline"
                  />
                  <motion.span
                    className="absolute top-[7px] h-[12px]"
                    style={{
                      background: tone,
                      left: `${Math.min(pos(baseline), pos(value))}%`,
                    }}
                    initial={reduce ? false : { width: 0 }}
                    animate={{ width: `${Math.abs(pos(value) - pos(baseline))}%` }}
                    transition={{ duration: 0.45, delay: reduce ? 0 : index * 0.05, ease: [0.16, 1, 0.3, 1] }}
                  />
                </div>

                <div className="mt-2 flex items-baseline justify-between gap-3">
                  <span className="flex items-baseline gap-1.5">
                    <span className="readout text-[24px]">
                      {value > 0 ? "+" : ""}
                      {fixed(value, 2)}
                    </span>
                    <span className="data text-[10px] text-[var(--foreground-muted)]">°C</span>
                  </span>
                  <span
                    className="data text-[15px] font-medium"
                    style={{ color: tone }}
                  >
                    {signed(scenario.delta_uhi_c, 2)}
                    <span className="ml-1 text-[9px]">°C vs baseline</span>
                  </span>
                </div>

                <dl className="mt-3 space-y-1 border-t border-[var(--border)] pt-2.5">
                  <Row label="Site temperature"
                       value={`${fixed(scenario.prediction.site_temperature_c, 1)} °C`}
                       delta={signed(scenario.delta_temperature_c, 2)} tone={tone} />
                  <Row label="Feels like"
                       value={`${fixed(scenario.prediction.heat_index_c, 1)} °C`}
                       delta={signed(scenario.delta_heat_index_c, 2)} tone={tone} />
                  {scenario.percent_change_uhi !== null && (
                    <Row label="Relative change"
                         value={`${scenario.percent_change_uhi > 0 ? "+" : ""}${scenario.percent_change_uhi}%`}
                         tone={tone} />
                  )}
                  {risk && (
                    <Row label="Heat stress" value={risk.label} tone={risk.tone} />
                  )}
                </dl>

                {scenario.changes.length > 0 && (
                  <div className="mt-3 border-t border-[var(--border)] pt-2.5">
                    <p className="label mb-1.5 text-[8px]">What changed</p>
                    <ul className="space-y-1">
                      {scenario.changes.map((change) => (
                        <li
                          key={change.field}
                          className="flex items-baseline justify-between gap-2 text-[11px]"
                        >
                          <span className="truncate text-[var(--foreground-muted)]">
                            {change.label}
                          </span>
                          <span className="data shrink-0">
                            {formatLever(change.baseline_value, change.unit)}
                            <span className="mx-1 text-[var(--foreground-faint)]">→</span>
                            <span className="text-[var(--foreground)]">
                              {formatLever(change.scenario_value, change.unit)}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void toggle(scenario.name)}
                  aria-expanded={open}
                  className="label mt-3 text-[var(--primary)] underline-offset-4 hover:underline"
                >
                  {open ? "Hide attribution" : "Why this result"}
                </button>
                {open && (
                  <div className="mt-3 border-t border-[var(--border)] pt-3">
                    {scenario.explanation ?? attributions[scenario.name] ? (
                      <AttributionBridge
                        explanation={(scenario.explanation ?? attributions[scenario.name])!}
                        max={6}
                      />
                    ) : explaining === scenario.name ? (
                      <LoadingState label="Computing the attribution" rows={4} />
                    ) : (
                      <p className="text-[11.5px] text-[var(--foreground-muted)]">
                        The attribution could not be computed for this scenario.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Baseline attribution ─────────────────────────────────────── */}
      {result.baseline.explanation && (
        <div className="mt-8 border-t border-[var(--border)] pt-6">
          <BlockHeader
            title="Why the baseline came out where it did"
            meta="SHAP attribution for the unmodified site"
          />
          <AttributionBridge explanation={result.baseline.explanation} max={7} />
        </div>
      )}
    </div>
  );
}

function Row({
  label, value, delta, tone,
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[11.5px] text-[var(--foreground-muted)]">{label}</dt>
      <dd className="data flex items-baseline gap-2 text-[11.5px]">
        <span>{value}</span>
        {delta && <span style={{ color: tone }}>{delta}</span>}
      </dd>
    </div>
  );
}

function formatLever(value: number, unit: string): string {
  if (unit === "0-1") return `${(value * 100).toFixed(0)}%`;
  if (Math.abs(value) >= 100) return value.toFixed(0);
  return value.toFixed(2);
}
