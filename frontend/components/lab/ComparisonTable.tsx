"use client";

import { Fragment, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check, ChevronRight } from "lucide-react";

import { Th, Td } from "./ModelLab";
import { fixed, seconds } from "@/lib/format";
import type { CandidateResult } from "@/lib/types";

const FAMILY_TONE: Record<string, string> = {
  baseline: "var(--foreground-faint)",
  linear: "var(--mineral)",
  kernel: "var(--secondary)",
  tree: "var(--heat-3)",
  ensemble: "var(--primary)",
};

export function ComparisonTable({
  candidates, selectedKey, unit, task,
}: {
  candidates: CandidateResult[];
  selectedKey: string;
  unit: string;
  task: "heat" | "energy";
}) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState<string | null>(null);
  const decimals = task === "heat" ? 4 : 1;

  const best = Math.max(...candidates.map((c) => c.validation.r2));
  const worst = Math.min(...candidates.map((c) => c.validation.r2), 0);
  const span = best - worst || 1;

  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full min-w-[52rem] text-left">
        <thead>
          <tr className="border-b border-[var(--border-strong)]">
            <Th>Model</Th>
            <Th>Validation R²</Th>
            <Th right>Valid RMSE</Th>
            <Th right>Test RMSE</Th>
            <Th right>Test R²</Th>
            <Th right>Test MAE</Th>
            <Th right>CV RMSE</Th>
            <Th right>Fit time</Th>
            <Th right>Rows</Th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate, i) => {
            const isSelected =
              selectedKey.startsWith("random_forest") && candidate.key === "random_forest";
            const expanded = open === candidate.key;
            const width = ((candidate.validation.r2 - worst) / span) * 100;
            return (
              <Fragment key={candidate.key}>
                <tr
                  className={`border-b border-[var(--border)] transition-colors hover:bg-[var(--surface)] ${
                    isSelected ? "bg-[var(--primary-soft)]" : ""
                  }`}
                >
                  <Td>
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : candidate.key)}
                      aria-expanded={expanded}
                      className="flex items-center gap-1.5 text-left"
                    >
                      <ChevronRight
                        size={12}
                        className={`shrink-0 text-[var(--foreground-faint)] transition-transform ${
                          expanded ? "rotate-90" : ""
                        }`}
                      />
                      <span
                        className="h-[7px] w-[7px] shrink-0"
                        style={{ background: FAMILY_TONE[candidate.family] }}
                        aria-hidden
                      />
                      <span className="font-medium">{candidate.name}</span>
                      {isSelected && (
                        <span className="label flex items-center gap-1 text-[8px] text-[var(--primary)]">
                          <Check size={9} />
                          selected family
                        </span>
                      )}
                      {candidate.subsampled && (
                        <span className="label text-[8px] text-[var(--foreground-faint)]">
                          subsampled
                        </span>
                      )}
                    </button>
                  </Td>
                  <Td>
                    <span className="flex items-center gap-2">
                      <span className="relative h-[6px] w-[6rem] bg-[var(--surface-sunk)]">
                        <motion.span
                          className="absolute inset-y-0 left-0"
                          style={{ background: FAMILY_TONE[candidate.family] }}
                          initial={reduce ? false : { width: 0 }}
                          whileInView={{ width: `${Math.max(1.5, width)}%` }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.45, delay: i * 0.03, ease: [0.16, 1, 0.3, 1] }}
                        />
                      </span>
                      <span className="data text-[12px] tabular-nums">
                        {fixed(candidate.validation.r2, 4)}
                      </span>
                    </span>
                  </Td>
                  <Td right mono>{fixed(candidate.validation.rmse, decimals)}</Td>
                  <Td right mono>{fixed(candidate.test.rmse, decimals)}</Td>
                  <Td right mono>{fixed(candidate.test.r2, 4)}</Td>
                  <Td right mono>{fixed(candidate.test.mae, decimals)}</Td>
                  <Td right mono className="text-[var(--foreground-muted)]">
                    {fixed(candidate.cv.rmse_mean, decimals)}
                    <span className="text-[9px] text-[var(--foreground-faint)]">
                      {" ±"}
                      {fixed(candidate.cv.rmse_std, decimals)}
                    </span>
                  </Td>
                  <Td right mono className="text-[var(--foreground-muted)]">
                    {seconds(candidate.fit_seconds)}
                  </Td>
                  <Td right mono className="text-[var(--foreground-muted)]">
                    {candidate.fit_rows.toLocaleString()}
                  </Td>
                </tr>
                {expanded && (
                  <tr className="border-b border-[var(--border)]">
                    <td colSpan={9} className="bg-[var(--surface)] px-6 py-4">
                      <p className="max-w-3xl text-[12.5px] leading-relaxed text-[var(--foreground-muted)]">
                        {candidate.rationale}
                      </p>
                      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
                        <Detail label="Training R²" value={fixed(candidate.train.r2, 4)} />
                        <Detail label="Validation R²" value={fixed(candidate.validation.r2, 4)} />
                        <Detail
                          label="Generalisation gap"
                          value={fixed(candidate.train.r2 - candidate.validation.r2, 4)}
                        />
                        <Detail label="Cross-validation" value={candidate.cv.scheme} />
                        <Detail label="CV rows" value={candidate.cv.rows.toLocaleString()} />
                        <Detail label="CV time" value={seconds(candidate.cv_seconds)} />
                      </dl>
                      {candidate.subsampled && (
                        <p className="mt-3 text-[11px] text-[var(--foreground-faint)]">
                          Fitted on {candidate.fit_rows.toLocaleString()} rows rather than the full
                          training window — this family&apos;s cost grows faster than linearly in the
                          number of samples. It was scored on the same held-out rows as every
                          other candidate.
                        </p>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--foreground-muted)]">
        Values are in {unit} except R², which is dimensionless. The generalisation gap —
        training R² minus validation R² — is the honest measure of how much a model has
        memorised: a single decision tree shows a wide one, the forest a much narrower one.
      </p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label text-[8px]">{label}</dt>
      <dd className="data mt-0.5 text-[12px]">{value}</dd>
    </div>
  );
}
