"use client";

import { useState } from "react";

import { ComparisonTable } from "./ComparisonTable";
import { ForestAnatomy } from "./ForestAnatomy";
import { ImportanceComparison } from "./ImportanceComparison";
import { ShapExplorer } from "./ShapExplorer";
import { TuningTrials } from "./TuningTrials";
import {
  Block, BlockHeader, ErrorState, LoadingState, Page, PageHeader, Tabs,
} from "@/components/ui/primitives";
import { useModelMetrics, useModels, useShap } from "@/hooks/useApi";
import { fixed } from "@/lib/format";
import type { RegimeMetric, SegmentMetrics, SelectedModel } from "@/lib/types";

const TASKS = [
  { value: "heat" as const, label: "Urban heat" },
  { value: "energy" as const, label: "Electricity demand" },
];

export function ModelLab() {
  const [task, setTask] = useState<"heat" | "energy">("heat");
  const { data: models, error, isLoading, mutate } = useModels(task);
  const { data: metrics } = useModelMetrics(task);
  const { data: shap } = useShap(task);

  const unit = task === "heat" ? "°C" : "MW";
  const selected = models?.selected;
  const testMetrics = selected?.metrics?.test as
    | { r2: number; rmse: number; mae: number }
    | undefined;

  return (
    <Page>
      <PageHeader
        eyebrow="Model lab"
        title="What was tried, what won, and why"
        lede="Ten model families were fitted on identical chronological splits and scored on identical held-out rows. Nothing here is quoted from a paper: every figure was produced by the training run whose artifacts this application serves."
        aside={<Tabs options={TASKS} value={task} onChange={setTask} />}
      />

      {error ? (
        <div className="py-8">
          <ErrorState message={error.message} onRetry={() => mutate()} />
        </div>
      ) : isLoading || !models ? (
        <div className="py-8">
          <LoadingState label="Loading the training report" rows={8} />
        </div>
      ) : (
        <>
          {/* ── Headline ─────────────────────────────────────────────── */}
          <section className="grid gap-px border-b border-[var(--border)] bg-[var(--border)] lg:grid-cols-12">
            <div className="bg-[var(--background)] py-6 lg:col-span-5 lg:pr-7">
              <p className="label">Shipped model</p>
              <h2 className="mt-2 text-[clamp(1.4rem,3vw,2rem)]">{selected?.name}</h2>
              {testMetrics && (
                <dl className="mt-5 grid grid-cols-3 gap-px border border-[var(--border)] bg-[var(--border)]">
                  <Metric label="Test R²" value={fixed(testMetrics.r2, 3)} />
                  <Metric label="Test RMSE" value={fixed(testMetrics.rmse, task === "heat" ? 3 : 0)} unit={unit} />
                  <Metric label="Test MAE" value={fixed(testMetrics.mae, task === "heat" ? 3 : 0)} unit={unit} />
                </dl>
              )}
              {selected?.selection && (
                <>
                  <p className="mt-4 text-[11.5px] leading-relaxed text-[var(--foreground-muted)]">
                    {selected.selection.rule}
                  </p>
                  {selected.selection.candidates && (
                    <SelectionTable
                      selection={selected.selection}
                      unit={unit}
                      decimals={task === "heat" ? 4 : 1}
                    />
                  )}
                </>
              )}
            </div>

            <div className="bg-[var(--background)] py-6 lg:col-span-7 lg:pl-7">
              <BlockHeader
                title="Split discipline"
                meta="No shuffling anywhere in the pipeline"
              />
              <SplitTable split={models.split} />
              <ul className="mt-4 space-y-1.5">
                {models.notes.map((note) => (
                  <li
                    key={note}
                    className="flex gap-2 text-[11.5px] leading-relaxed text-[var(--foreground-muted)]"
                  >
                    <span className="mt-[7px] h-px w-3 shrink-0 bg-[var(--border-strong)]" />
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* ── Comparison ───────────────────────────────────────────── */}
          <Block className="py-8">
            <BlockHeader
              title="Model comparison"
              meta={`All ten candidates, scored on the same ${models.split.valid_rows ?? "—"} validation rows and ${models.split.test_rows ?? "—"} test rows`}
            />
            <ComparisonTable
              candidates={models.candidates}
              selectedKey={selected?.key ?? ""}
              unit={unit}
              task={task}
            />
          </Block>

          {/* ── Segment metrics ──────────────────────────────────────── */}
          {models.segment_metrics && (
            <SegmentSection
              block={models.segment_metrics}
              regimes={models.regime_metrics}
              task={task}
            />
          )}

          {/* ── Tuning ───────────────────────────────────────────────── */}
          <Block className="border-t border-[var(--border)] py-8">
            <BlockHeader
              title="Random Forest optimisation"
              meta={`${models.tuning.search} · ${models.tuning.n_iter} configurations · ${models.tuning.cv}`}
            />
            <TuningTrials tuning={models.tuning} unit={unit} />
          </Block>

          {/* ── Forest anatomy ───────────────────────────────────────── */}
          <ForestAnatomy
            hyperparameters={selected?.hyperparameters ?? {}}
            metrics={selected?.metrics ?? {}}
            unit={unit}
          />

          {/* ── Importance ───────────────────────────────────────────── */}
          <Block className="border-t border-[var(--border)] py-8">
            <BlockHeader
              title="What the forest uses"
              meta="Impurity-based importance beside SHAP attribution — two different questions about the same model"
            />
            {metrics && shap ? (
              <ImportanceComparison
                importance={metrics.feature_importance}
                shap={shap}
                unit={unit}
              />
            ) : (
              <LoadingState rows={6} />
            )}
          </Block>

          {/* ── SHAP structure ───────────────────────────────────────── */}
          {shap && (
            <Block className="border-t border-[var(--border)] py-8">
              <BlockHeader
                title="How each input moves the prediction"
                meta={`${shap.method} · ${shap.n_samples.toLocaleString()} rows from the ${shap.sample_window}`}
              />
              <ShapExplorer shap={shap} unit={unit} />
            </Block>
          )}
        </>
      )}
    </Page>
  );
}

function SelectionTable({
  selection, unit, decimals,
}: {
  selection: NonNullable<SelectedModel["selection"]>;
  unit: string;
  decimals: number;
}) {
  const candidates = selection.candidates ?? [];
  return (
    <div className="mt-4">
      <p className="label mb-2">Configurations considered</p>
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <Th>Configuration</Th>
            <Th right>Valid RMSE</Th>
            <Th right>Test R²</Th>
            <Th right>Size</Th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate) => (
            <tr
              key={candidate.key}
              className={`border-b border-[var(--border)] ${
                candidate.key === selection.chosen ? "bg-[var(--primary-soft)]" : ""
              }`}
            >
              <Td>
                {candidate.key}
                <span className="label ml-2 text-[8px]">{candidate.note}</span>
                {candidate.key === selection.chosen && (
                  <span className="label ml-2 text-[8px] text-[var(--primary)]">shipped</span>
                )}
              </Td>
              {candidate.fitted === false ? (
                <Td right className="text-[var(--foreground-faint)]" mono>
                  not fitted
                </Td>
              ) : (
                <Td right mono>{fixed(candidate.validation_rmse, decimals)} {unit}</Td>
              )}
              <Td right mono>
                {candidate.fitted === false ? "—" : fixed(candidate.test_r2, 4)}
              </Td>
              <Td right mono>
                {(candidate.estimated_size_mb ?? candidate.predicted_size_mb ?? 0).toFixed(0)} MB
                {candidate.fitted === false && (
                  <span className="label ml-1 text-[7.5px]">est.</span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SegmentSection({
  block, regimes, task,
}: {
  block: SegmentMetrics;
  regimes?: RegimeMetric[];
  task: "heat" | "energy";
}) {
  const decimals = task === "heat" ? 3 : 0;
  return (
    <div className="grid gap-px border-t border-[var(--border)] bg-[var(--border)] lg:grid-cols-2">
      <Block className="bg-[var(--background)] py-8 lg:pr-7">
        <BlockHeader
          title={task === "heat" ? "Accuracy by site class" : "Accuracy by load zone"}
          meta="Scored within each segment of the held-out window"
        />
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <Th>Segment</Th>
              <Th right>Rows</Th>
              <Th right>R²</Th>
              <Th right>RMSE</Th>
            </tr>
          </thead>
          <tbody>
            {block.segments.map((row) => (
              <tr key={row.segment} className="border-b border-[var(--border)]">
                <Td>{row.segment}</Td>
                <Td right mono>{row.rows.toLocaleString()}</Td>
                <Td right mono>{fixed(row.r2, 3)}</Td>
                <Td right mono>{fixed(row.rmse, decimals)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--foreground-muted)]">
          {block.note}
        </p>
      </Block>

      {regimes && regimes.length > 0 && (
        <Block className="bg-[var(--background)] py-8 lg:pl-7">
          <BlockHeader
            title="Accuracy by regime"
            meta="The conditions the product is actually used under"
          />
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <Th>Regime</Th>
                <Th right>Rows</Th>
                <Th right>Mean ΔT</Th>
                <Th right>R²</Th>
                <Th right>RMSE</Th>
              </tr>
            </thead>
            <tbody>
              {regimes.map((row) => (
                <tr key={row.regime} className="border-b border-[var(--border)]">
                  <Td>{row.regime}</Td>
                  <Td right mono>{row.rows.toLocaleString()}</Td>
                  <Td right mono>{fixed(row.mean_target, 2)}</Td>
                  <Td right mono>{fixed(row.r2, 3)}</Td>
                  <Td right mono>{fixed(row.rmse, 3)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--foreground-muted)]">
            The heat island is a night-time, low-wind phenomenon, and the model is
            correspondingly more informative in those regimes than at midday in a gale.
          </p>
        </Block>
      )}
    </div>
  );
}

function SplitTable({ split }: { split: Record<string, unknown> }) {
  const rows = [
    ["Training window", split.train_window, split.train_rows_used, split.train_rows_available, split.train_stride],
    ["Validation window", split.valid_window, split.valid_rows, split.valid_rows_available, split.valid_stride],
    ["Test window", split.test_window, split.test_rows, split.test_rows_available, split.test_stride],
  ] as const;

  return (
    <table className="w-full text-left">
      <thead>
        <tr className="border-b border-[var(--border)]">
          <Th>Window</Th>
          <Th>Period</Th>
          <Th right>Rows used</Th>
          <Th right>Available</Th>
          <Th right>Stride</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, window, used, available, stride]) => {
          const period = Array.isArray(window)
            ? `${String(window[0]).slice(0, 10)} → ${String(window[1]).slice(0, 10)}`
            : "—";
          return (
            <tr key={label} className="border-b border-[var(--border)]">
              <Td>{label}</Td>
              <Td mono>{period}</Td>
              <Td right mono>{Number(used ?? 0).toLocaleString()}</Td>
              <Td right mono>{Number(available ?? 0).toLocaleString()}</Td>
              <Td right mono>{String(stride ?? 1)}</Td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="bg-[var(--surface)] px-3.5 py-3">
      <p className="label text-[8px]">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="readout text-[21px]">{value}</span>
        {unit && <span className="data text-[9px] text-[var(--foreground-muted)]">{unit}</span>}
      </p>
    </div>
  );
}

export function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`label pb-2 text-[8px] ${right ? "text-right" : "text-left"}`}>{children}</th>
  );
}

export function Td({
  children, right, mono, className,
}: {
  children: React.ReactNode;
  right?: boolean;
  mono?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`py-2 text-[12px] ${right ? "text-right" : "text-left"} ${
        mono ? "data" : ""
      } ${className ?? ""}`}
    >
      {children}
    </td>
  );
}
