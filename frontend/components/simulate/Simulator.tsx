"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, RotateCcw, TriangleAlert } from "lucide-react";

import { ScenarioBoard } from "./ScenarioBoard";
import { ScenarioEditor, type ScenarioDraft, buildDefaultScenarios } from "./ScenarioEditor";
import { ConditionPanel, DEFAULT_CONDITIONS, DEFAULT_LIMITS } from "@/components/controls/ConditionPanel";
import { SitePicker, SiteSummaryCard } from "@/components/site/SitePicker";
import {
  Block, BlockHeader, Button, ErrorState, LoadingState, Page, PageHeader, Panel,
} from "@/components/ui/primitives";
import { useFeatures, useSites } from "@/hooks/useApi";
import { api, ApiError } from "@/lib/api";
import type { HeatConditions, HeatSimulateResponse, Site } from "@/lib/types";

const TIMESTAMP = "2024-07-16T03:00:00Z"; // 23:00 US Eastern, mid-July

export function Simulator() {
  const { data: sitesData } = useSites();
  const { data: catalogue } = useFeatures("heat");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const site: Site | null = useMemo(() => {
    const sites = sitesData?.sites ?? [];
    if (!sites.length) return null;
    return sites.find((candidate) => candidate.station_id === selectedId) ?? sites[0];
  }, [sitesData, selectedId]);

  const [conditions, setConditions] = useState<HeatConditions>(DEFAULT_CONDITIONS);
  const [result, setResult] = useState<HeatSimulateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const requestId = useRef(0);

  // Scenario controls are seeded from the selected site's *measured* morphology,
  // so "more green cover" starts from what is actually there today. Edits are
  // stored against the site they were made for, which means changing site
  // re-seeds the controls without an effect having to notice.
  const [edits, setEdits] = useState<{ siteId: string; scenarios: ScenarioDraft[] } | null>(null);
  const scenarios: ScenarioDraft[] = useMemo(() => {
    if (!site) return [];
    if (edits && edits.siteId === site.station_id) return edits.scenarios;
    return buildDefaultScenarios(site);
  }, [site, edits]);

  const setScenarios = useCallback(
    (next: ScenarioDraft[]) => {
      if (!site) return;
      setEdits({ siteId: site.station_id, scenarios: next });
    },
    [site],
  );

  const limits = useMemo(() => {
    if (!catalogue) return DEFAULT_LIMITS;
    const range = (name: string, fallback: [number, number]): [number, number] => {
      const spec = catalogue.features.find((f) => f.name === name);
      return spec ? [Number(spec.p01.toFixed(1)), Number(spec.p99.toFixed(1))] : fallback;
    };
    return {
      ...DEFAULT_LIMITS,
      t_ref_c: range("t_ref_c", DEFAULT_LIMITS.t_ref_c),
      relative_humidity_pct: range("rh_ref_pct", DEFAULT_LIMITS.relative_humidity_pct),
      wind_speed_ms: [0, range("wind_speed_ms", DEFAULT_LIMITS.wind_speed_ms)[1]] as [number, number],
      slp_hpa: range("slp_hpa", DEFAULT_LIMITS.slp_hpa),
    };
  }, [catalogue]);

  const run = useCallback(async () => {
    if (!site || scenarios.length === 0) return;
    const id = ++requestId.current;
    setPending(true);
    try {
      const response = await api.simulateHeat({
        station_id: site.station_id,
        timestamp: TIMESTAMP,
        baseline: conditions,
        scenarios: scenarios.map((scenario) => ({
          name: scenario.name,
          description: scenario.description,
          conditions: scenario.conditions ?? undefined,
          overrides: scenario.overrides,
        })),
        // The baseline attribution is worth the 1–2 seconds it costs; four more
        // would make every slider nudge feel broken. Scenario attributions are
        // fetched individually when a reader opens one.
        explain: true,
        explain_scenarios: false,
      });
      if (id !== requestId.current) return;
      setResult(response);
      setError(null);
    } catch (exc) {
      if (id !== requestId.current) return;
      setError(exc instanceof ApiError ? exc.message : "Unexpected failure.");
    } finally {
      if (id === requestId.current) setPending(false);
    }
  }, [site, conditions, scenarios]);

  useEffect(() => {
    if (!site || scenarios.length === 0) return;
    const handle = setTimeout(() => void run(), 320);
    return () => clearTimeout(handle);
  }, [site, conditions, scenarios, run]);

  return (
    <Page>
      <PageHeader
        eyebrow="What-if simulator"
        title="Change the ground. Rerun the model. Read the difference."
        lede="Each scenario is the same fitted Random Forest evaluated on modified inputs. The difference between two runs is the model's response to that change in inputs — a statistical sensitivity, not a forecast of what rebuilding a city would do."
        aside={
          <Button onClick={() => void run()} disabled={pending || !site}>
            <Play size={12} />
            {pending ? "Running scenarios…" : "Run scenarios"}
          </Button>
        }
      />

      <div className="grid gap-px bg-[var(--border)] xl:grid-cols-12">
        <Block className="bg-[var(--background)] p-5 xl:col-span-4 xl:p-6">
          <BlockHeader title="Baseline site" />
          <SitePicker
            value={site?.station_id ?? null}
            onChange={(next) => setSelectedId(next.station_id)}
            height="14rem"
          />

          {site && (
            <Panel className="mt-5">
              <SiteSummaryCard site={site} />
            </Panel>
          )}

          <div className="mt-6 border-t border-[var(--border)] pt-5">
            <ConditionPanel
              conditions={conditions}
              onChange={setConditions}
              limits={limits}
              onReset={() => setConditions(DEFAULT_CONDITIONS)}
            />
          </div>
        </Block>

        <Block className="bg-[var(--background)] p-5 xl:col-span-8 xl:p-7">
          {error ? (
            <ErrorState message={error} onRetry={() => void run()} />
          ) : !result ? (
            <LoadingState label="Running the baseline and scenarios" rows={7} />
          ) : (
            <ScenarioBoard
              result={result}
              pending={pending}
              stationId={site?.station_id ?? null}
              timestamp={TIMESTAMP}
              baselineConditions={conditions}
              scenarios={scenarios}
            />
          )}
        </Block>
      </div>

      <div className="grid gap-px border-t border-[var(--border)] bg-[var(--border)] xl:grid-cols-12">
        <Block className="bg-[var(--background)] p-5 xl:col-span-12 xl:p-7">
          <BlockHeader
            title="Scenario controls"
            meta="Sliders start from this site's measured fabric; the shaded mark on each track is today's value"
            action={
              site && (
                <Button variant="outline" size="sm" onClick={() => setEdits(null)}>
                  <RotateCcw size={11} />
                  Reset all
                </Button>
              )
            }
          />
          {site ? (
            <ScenarioEditor site={site} scenarios={scenarios} onChange={setScenarios} />
          ) : (
            <LoadingState rows={4} />
          )}

          <p className="mt-6 flex items-start gap-2 border-t border-[var(--border)] pt-4 text-[11.5px] leading-relaxed text-[var(--foreground-muted)]">
            <TriangleAlert size={13} className="mt-px shrink-0 text-[var(--warning)]" />
            <span>
              {result?.method ??
                "Scenario results come from evaluating the fitted model on modified inputs."}{" "}
              Pushing a slider far outside the range the model was trained on will produce a
              number, but not a trustworthy one — the tracks are bounded by the observed
              distribution for exactly that reason.
            </span>
          </p>
        </Block>
      </div>
    </Page>
  );
}
