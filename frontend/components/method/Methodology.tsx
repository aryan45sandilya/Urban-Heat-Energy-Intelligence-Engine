"use client";

import { useState } from "react";
import { Check, CircleAlert, X } from "lucide-react";

import { TargetDiagram } from "./TargetDiagram";
import { DistributionChart, SeasonalChart } from "@/components/charts/HeatCharts";
import {
  Block, BlockHeader, ErrorState, LoadingState, Page, PageHeader, Tabs,
} from "@/components/ui/primitives";
import { useHeatEda, useMeta, useValidation } from "@/hooks/useApi";
import { compact, fixed } from "@/lib/format";

const LIMITATIONS = [
  {
    title: "Airports are not city centres",
    body:
      "Hourly observations of this quality come mostly from aerodromes, which sit on the "
      + "edge of the places they serve. The network does include genuine urban stations — "
      + "Central Park, downtown Baltimore, the Wall Street heliport — but a dense-core site "
      + "is the exception. The measured anomalies here are therefore conservative: the "
      + "hottest street canyons are under-represented.",
  },
  {
    title: "OpenStreetMap is uneven",
    body:
      "Building footprints are close to complete across this region, but green space and "
      + "water are tagged less consistently, and only OSM *ways* are measured — multipolygon "
      + "relations are not decomposed. Green cover is therefore a slight under-estimate in "
      + "some places. Road width is not tagged at all, so the impervious figure assumes a "
      + "7 m carriageway.",
  },
  {
    title: "Cloud cover is sparse",
    body:
      "ISD-Lite's sky-cover channel reports for roughly 60% of hours. Missing values are "
      + "imputed with the training-fold median inside the pipeline, which weakens a variable "
      + "that physically matters a great deal on clear nights.",
  },
  {
    title: "One region, three years",
    body:
      "Everything here was fitted on the US Northeast and Mid-Atlantic between 2022 and "
      + "2024. Applying it to a desert city, a tropical one, or a different decade would be "
      + "extrapolation, and a Random Forest extrapolates by returning the edge of what it "
      + "has seen — silently.",
  },
  {
    title: "The demand model is not a dispatch forecast",
    body:
      "Zonal load is modelled from weather and calendar alone, with no autoregressive term. "
      + "That makes it a demand-response model — useful for asking what a hot evening implies "
      + "— and useless for predicting tomorrow's peak, which depends on the grid's own state.",
  },
  {
    title: "Association, not causation",
    body:
      "Every number in this product describes a statistical relationship learned from "
      + "observations. A scenario showing that more green cover lowers the prediction means "
      + "the model associates greener sites with smaller anomalies, holding its other inputs "
      + "fixed. It is not a forecast of what planting trees would achieve.",
  },
] as const;

export function Methodology() {
  const { data: meta, error: metaError } = useMeta();
  const { data: eda } = useHeatEda();
  const { data: validation } = useValidation();
  const [section, setSection] = useState<"heat" | "energy">("heat");

  if (metaError) {
    return (
      <Page>
        <div className="py-10">
          <ErrorState message={metaError.message} />
        </div>
      </Page>
    );
  }

  const heatTask = meta?.tasks?.heat;
  const energyTask = meta?.tasks?.energy;

  return (
    <Page>
      <PageHeader
        eyebrow="Methodology"
        title="How this was built, and what it can be trusted to say"
        lede="The honest version: the target, the construction, the validation, and a plain list of everything that limits it."
      />

      {/* ── The target ───────────────────────────────────────────────── */}
      <div className="grid gap-px border-b border-[var(--border)] bg-[var(--border)] lg:grid-cols-12">
        <Block className="bg-[var(--background)] py-8 lg:col-span-5 lg:pr-7">
          <BlockHeader title="The target, and why it is that" />
          <p className="text-[13.5px] leading-relaxed text-[var(--foreground-muted)]">
            The model predicts <strong className="text-[var(--foreground)]">ΔT</strong>, the
            hourly air-temperature anomaly of a site relative to the rural landscape around
            it — not raw temperature.
          </p>
          <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--foreground-muted)]">
            Raw temperature is dominated by the weather pattern, which is the same for a city
            and its countryside. A model of raw temperature learns the season, gets an
            impressive R², and says nothing about cities. Differencing against the rural
            background removes the synoptic signal, and what is left is the quantity a
            planner actually asks about.
          </p>
          <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--foreground-muted)]">
            The control is convincing: averaged over the whole record, rural sites sit at{" "}
            <span className="data text-[var(--foreground)]">
              {eda ? fixed(eda.summer_night.by_class.rural?.mean, 2) : "—"} °C
            </span>{" "}
            on summer nights while urban sites sit at{" "}
            <span className="data text-[var(--primary)]">
              +{eda ? fixed(eda.summer_night.by_class.urban?.mean, 2) : "—"} °C
            </span>
            . The construction reproduces the urban heat island without being told it exists.
          </p>

          <div className="mt-5 border-t border-[var(--border)] pt-4">
            <p className="label mb-2">Heat risk is an interpretation, not a prediction</p>
            <p className="text-[12.5px] leading-relaxed text-[var(--foreground-muted)]">
              The model outputs a continuous anomaly in degrees. Adding it to the background
              temperature gives a site temperature; combining that with humidity through the
              published NWS heat-index formula gives an apparent temperature; the category
              label comes from the NWS threshold table. Three deterministic steps after the
              model — all clearly separable, none of them learned.
            </p>
          </div>
        </Block>

        <Block className="bg-[var(--background)] py-8 lg:col-span-7 lg:pl-7">
          <TargetDiagram />
        </Block>
      </div>

      {/* ── Data sources ─────────────────────────────────────────────── */}
      <Block className="py-8">
        <BlockHeader
          title="Data sources"
          meta={meta ? `${meta.network.stations} stations · ${meta.study_period_years.join(", ")}` : undefined}
        />
        <div className="grid gap-px bg-[var(--border)] md:grid-cols-2 xl:grid-cols-3">
          {(meta?.data_sources ?? []).map((source) => (
            <div key={source.key} className="bg-[var(--background)] p-5 md:first:pl-0">
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer noopener"
                className="font-[family-name:var(--font-display)] text-[14px] font-semibold
                           underline-offset-4 hover:text-[var(--primary)] hover:underline"
              >
                {source.name}
              </a>
              <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--foreground-muted)]">
                {source.description}
              </p>
              <p className="label mt-3 text-[8px]">{source.license}</p>
            </div>
          ))}
        </div>
      </Block>

      {/* ── Validation ───────────────────────────────────────────────── */}
      <div className="grid gap-px border-t border-[var(--border)] bg-[var(--border)] lg:grid-cols-12">
        <Block className="bg-[var(--background)] py-8 lg:col-span-7 lg:pr-7">
          <BlockHeader
            title="Validation and leakage audit"
            meta={validation ? `${countChecks(validation)} automated checks` : undefined}
            action={
              validation && (
                <span
                  className={`label flex items-center gap-1.5 ${
                    validation.passed ? "text-[var(--success)]" : "text-[var(--danger)]"
                  }`}
                >
                  {validation.passed ? <Check size={11} /> : <X size={11} />}
                  {validation.passed ? "all passed" : `${validation.failures.length} failed`}
                </span>
              )
            }
          />
          {validation ? (
            <ValidationGrid validation={validation} />
          ) : (
            <LoadingState rows={6} />
          )}
        </Block>

        <Block className="bg-[var(--background)] py-8 lg:col-span-5 lg:pl-7">
          <BlockHeader title="Splitting" meta={meta?.split_strategy.cross_validation} />
          <p className="text-[13px] leading-relaxed text-[var(--foreground-muted)]">
            {meta?.split_strategy.rationale}
          </p>
          <dl className="mt-4 divide-y divide-[var(--border)]">
            <Fact label="Strategy" value={meta?.split_strategy.type ?? "—"} />
            <Fact label="Training ends" value={meta?.split_strategy.train_end ?? "—"} />
            <Fact label="Validation ends" value={meta?.split_strategy.valid_end ?? "—"} />
            <Fact label="Cross-validation" value={meta?.split_strategy.cross_validation ?? "—"} />
          </dl>
          <p className="mt-4 text-[11.5px] leading-relaxed text-[var(--foreground-faint)]">
            The validation and test windows both contain a full summer. Evaluating a heat
            model only on shoulder seasons would flatter it in exactly the regime that
            matters least.
          </p>
        </Block>
      </div>

      {/* ── Distributions ────────────────────────────────────────────── */}
      <div className="grid gap-px border-t border-[var(--border)] bg-[var(--border)] lg:grid-cols-2">
        <Block className="bg-[var(--background)] py-8 lg:pr-7">
          <BlockHeader
            title="Distribution of the target"
            meta={eda ? `${compact(eda.rows)} site-hours` : undefined}
          />
          {eda ? <DistributionChart eda={eda} height={210} /> : <LoadingState rows={4} />}
          {eda && (
            <dl className="mt-3 grid grid-cols-4 gap-px border border-[var(--border)] bg-[var(--border)]">
              <Small label="Mean" value={`${fixed(eda.target.mean, 2)} °C`} />
              <Small label="Std dev" value={`${fixed(eda.target.std, 2)} °C`} />
              <Small label="1st pct" value={`${fixed(eda.target.p01, 2)} °C`} />
              <Small label="99th pct" value={`${fixed(eda.target.p99, 2)} °C`} />
            </dl>
          )}
        </Block>
        <Block className="bg-[var(--background)] py-8 lg:pl-7">
          <BlockHeader title="Seasonal profile" meta="Mean anomaly by calendar month" />
          {eda ? <SeasonalChart eda={eda} height={210} /> : <LoadingState rows={4} />}
          <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--foreground-muted)]">
            The anomaly persists year-round rather than being a summer phenomenon: winter
            sites stay warm through waste heat and reduced sky view, summer sites through
            stored solar energy. Only the mechanism changes.
          </p>
        </Block>
      </div>

      {/* ── Model card ───────────────────────────────────────────────── */}
      <Block className="border-t border-[var(--border)] py-8">
        <BlockHeader
          title="Model card"
          action={
            <Tabs
              options={[
                { value: "heat" as const, label: "Urban heat" },
                { value: "energy" as const, label: "Electricity demand" },
              ]}
              value={section}
              onChange={setSection}
            />
          }
        />
        <ModelCard task={section === "heat" ? heatTask : energyTask} which={section} />
      </Block>

      {/* ── Limitations ──────────────────────────────────────────────── */}
      <Block className="border-t border-[var(--border)] py-8">
        <BlockHeader
          title="Limitations"
          meta="The things that would matter if you tried to use this for real"
        />
        <div className="grid gap-px bg-[var(--border)] md:grid-cols-2 xl:grid-cols-3">
          {LIMITATIONS.map((limitation) => (
            <div key={limitation.title} className="bg-[var(--background)] p-5 md:first:pl-0">
              <p className="flex items-start gap-2">
                <CircleAlert size={13} className="mt-[3px] shrink-0 text-[var(--warning)]" />
                <span className="font-[family-name:var(--font-display)] text-[14px] font-semibold leading-snug">
                  {limitation.title}
                </span>
              </p>
              <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--foreground-muted)]">
                {limitation.body}
              </p>
            </div>
          ))}
        </div>
      </Block>
    </Page>
  );
}

/* ── Sub-components ────────────────────────────────────────────────────── */

function ValidationGrid({ validation }: { validation: ReturnType<typeof useValidation>["data"] }) {
  if (!validation) return null;
  return (
    <div className="space-y-5">
      {Object.entries(validation.sections).map(([name, checks]) => (
        <div key={name}>
          <p className="label mb-2">{name} dataset</p>
          <ul className="grid gap-px bg-[var(--border)] sm:grid-cols-2">
            {checks
              .filter((check) => check.severity !== "info" || !check.passed || check.name.startsWith("leakage"))
              .map((check) => (
                <li
                  key={check.name}
                  className="flex items-start gap-2 bg-[var(--background)] px-3 py-2"
                >
                  {check.passed ? (
                    <Check size={12} className="mt-[3px] shrink-0 text-[var(--success)]" />
                  ) : (
                    <X size={12} className="mt-[3px] shrink-0 text-[var(--danger)]" />
                  )}
                  <span className="min-w-0">
                    <span className="data block truncate text-[11px]">{check.name}</span>
                    <span className="block text-[11px] leading-snug text-[var(--foreground-muted)]">
                      {check.detail}
                    </span>
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ModelCard({
  task, which,
}: {
  task: ReturnType<typeof useMeta>["data"] extends infer T
    ? T extends { tasks: Record<string, infer U> } ? U | undefined : undefined
    : undefined;
  which: "heat" | "energy";
}) {
  if (!task) {
    return <LoadingState rows={5} />;
  }
  const test = task.metrics.test as { r2: number; rmse: number; mae: number } | undefined;
  const isHeat = which === "heat";

  return (
    <div className="grid gap-px bg-[var(--border)] lg:grid-cols-12">
      <div className="bg-[var(--background)] lg:col-span-5 lg:pr-7">
        <dl className="divide-y divide-[var(--border)]">
          <Fact label="Purpose" value={
            isHeat
              ? "Estimate how much hotter a measured location is than the rural landscape around it, hour by hour."
              : "Estimate zonal electricity demand from weather and calendar conditions."
          } />
          <Fact label="Intended use" value={
            isHeat
              ? "Exploratory analysis, planning conversations, teaching. Not for emergency response or regulatory decisions."
              : "Understanding how demand responds to weather. Not for dispatch, trading or reliability planning."
          } />
          <Fact label="Target" value={`${task.target.name} (${task.target.unit})`} />
          <Fact label="Training rows" value={task.rows.toLocaleString()} />
          <Fact label="Features" value={String(task.n_features)} />
          <Fact label="Model" value={task.selected_model} />
        </dl>
      </div>

      <div className="bg-[var(--background)] lg:col-span-7 lg:pl-7">
        {test && (
          <dl className="grid grid-cols-3 gap-px border border-[var(--border)] bg-[var(--border)]">
            <Small label="Test R²" value={fixed(test.r2, 3)} big />
            <Small label="Test RMSE" value={`${fixed(test.rmse, isHeat ? 3 : 0)} ${task.target.unit}`} big />
            <Small label="Test MAE" value={`${fixed(test.mae, isHeat ? 3 : 0)} ${task.target.unit}`} big />
          </dl>
        )}

        <div className="mt-5">
          <p className="label mb-2">Known failure modes</p>
          <ul className="space-y-1.5">
            {(isHeat
              ? [
                  "Extrapolates silently outside the observed range of any input.",
                  "Least informative at midday in high wind, when the anomaly is near zero anyway.",
                  "Gives no calibrated uncertainty — a single number, not an interval.",
                  "Sites with sparse cloud reporting lean on an imputed median for that input.",
                ]
              : [
                  "Overall R² is dominated by differences between zones; within-zone skill is the honest figure, and it is reported in the Model Lab.",
                  "No autoregressive load term, so it cannot track a demand ramp in progress.",
                  "Blind to outages, price response, demand-side programmes and generation mix.",
                  "Zone weather is a three-station average standing in for an entire service area.",
                ]
            ).map((item) => (
              <li key={item} className="flex gap-2 text-[12px] leading-relaxed text-[var(--foreground-muted)]">
                <span className="mt-[8px] h-px w-3 shrink-0 bg-[var(--border-strong)]" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <p className="label mb-2">Responsible use</p>
          <p className="text-[12.5px] leading-relaxed text-[var(--foreground-muted)]">
            Report predictions as predictions. State the conditions they assume. Do not
            present a scenario difference as the expected result of an intervention — it is
            the model&apos;s sensitivity to a change in its inputs, which is a narrower and
            weaker claim. Where a decision would affect people&apos;s safety, treat this as a
            source of questions, not answers.
          </p>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-2.5">
      <dt className="label text-[8px]">{label}</dt>
      <dd className="mt-1 text-[12.5px] leading-relaxed">{value}</dd>
    </div>
  );
}

function Small({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="bg-[var(--surface)] px-3 py-2.5">
      <p className="label text-[8px]">{label}</p>
      <p className={`mt-1 ${big ? "readout text-[19px]" : "data text-[12px]"}`}>{value}</p>
    </div>
  );
}

function countChecks(validation: { sections: Record<string, unknown[]> }): number {
  return Object.values(validation.sections).reduce((total, list) => total + list.length, 0);
}
