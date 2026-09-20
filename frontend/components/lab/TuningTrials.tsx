"use client";

import { Th, Td } from "./ModelLab";
import { fixed, seconds } from "@/lib/format";
import type { ModelsResponse } from "@/lib/types";

const PARAM_LABELS: Record<string, string> = {
  n_estimators: "Trees",
  max_depth: "Max depth",
  min_samples_split: "Min split",
  min_samples_leaf: "Min leaf",
  max_features: "Max features",
  bootstrap: "Bootstrap",
};

export function TuningTrials({
  tuning, unit,
}: {
  tuning: ModelsResponse["tuning"];
  unit: string;
}) {
  const keys = Object.keys(PARAM_LABELS);
  const best = tuning.top_trials[0]?.cv_rmse ?? 0;
  const worst = tuning.top_trials[tuning.top_trials.length - 1]?.cv_rmse ?? best + 1;
  const span = worst - best || 1;

  return (
    <div className="grid gap-px bg-[var(--border)] lg:grid-cols-12">
      <div className="bg-[var(--background)] lg:col-span-8 lg:pr-7">
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[38rem] text-left">
            <thead>
              <tr className="border-b border-[var(--border-strong)]">
                <Th>#</Th>
                <Th>CV RMSE</Th>
                {keys.map((key) => (
                  <Th key={key} right>{PARAM_LABELS[key]}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tuning.top_trials.map((trial, i) => {
                const width = 100 - ((trial.cv_rmse - best) / span) * 78;
                return (
                  <tr
                    key={i}
                    className={`border-b border-[var(--border)] ${
                      i === 0 ? "bg-[var(--primary-soft)]" : ""
                    }`}
                  >
                    <Td mono className="text-[var(--foreground-faint)]">
                      {String(i + 1).padStart(2, "0")}
                    </Td>
                    <Td>
                      <span className="flex items-center gap-2">
                        <span className="relative h-[6px] w-[5rem] bg-[var(--surface-sunk)]">
                          <span
                            className="absolute inset-y-0 left-0"
                            style={{
                              width: `${width}%`,
                              background: i === 0 ? "var(--primary)" : "var(--heat-3)",
                            }}
                          />
                        </span>
                        <span className="data text-[12px]">{fixed(trial.cv_rmse, 4)}</span>
                      </span>
                    </Td>
                    {keys.map((key) => (
                      <Td key={key} right mono>
                        {formatParam(trial.params[key])}
                      </Td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--foreground-muted)]">
          The ten best of {tuning.n_iter} sampled configurations, ranked by cross-validated
          RMSE inside the training window. Scores across the leading configurations differ by
          far less than the spread between model families — the choice of a forest mattered
          more than the choice of its settings.
        </p>
      </div>

      <div className="bg-[var(--background)] lg:col-span-4 lg:pl-7">
        <dl className="space-y-3">
          <Fact label="Search" value={tuning.search} />
          <Fact label="Configurations sampled" value={String(tuning.n_iter)} />
          <Fact label="Cross-validation" value={tuning.cv} />
          <Fact label="Rows searched on" value={tuning.search_rows.toLocaleString()} />
          <Fact label="Best CV RMSE" value={`${fixed(tuning.best_cv_rmse, 4)} ${unit}`} />
          <Fact label="Search time" value={seconds(tuning.seconds)} />
        </dl>

        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <p className="label mb-2">Search space</p>
          <dl className="space-y-1.5">
            {Object.entries(tuning.space).map(([key, values]) => (
              <div key={key} className="flex items-baseline justify-between gap-3">
                <dt className="text-[11.5px] text-[var(--foreground-muted)]">
                  {PARAM_LABELS[key] ?? key}
                </dt>
                <dd className="data text-right text-[10.5px] text-[var(--foreground)]">
                  {values.map(formatParam).join(" · ")}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label text-[8px]">{label}</dt>
      <dd className="mt-0.5 text-[12.5px]">{value}</dd>
    </div>
  );
}

function formatParam(value: unknown): string {
  if (value === null || value === undefined || value === "None") return "none";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}
