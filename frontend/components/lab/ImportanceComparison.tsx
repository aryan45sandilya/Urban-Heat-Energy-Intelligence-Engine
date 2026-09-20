"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";

import { fixed } from "@/lib/format";
import type { ModelMetricsResponse, ShapGlobal } from "@/lib/types";

/**
 * Impurity importance and SHAP answer different questions, and showing them on
 * one row makes the difference legible: impurity says how often an input was
 * *used* to split, SHAP says how much it *moved the answer*. Where the two
 * disagree, that disagreement is worth knowing about.
 */
export function ImportanceComparison({
  importance, shap, unit,
}: {
  importance: ModelMetricsResponse["feature_importance"];
  shap: ShapGlobal;
  unit: string;
}) {
  const reduce = useReducedMotion();

  const rows = useMemo(() => {
    const shapByFeature = new Map(shap.ranking.map((r) => [r.feature, r]));
    const impurityRank = new Map(importance.map((r, i) => [r.feature, i + 1]));
    const shapRank = new Map(shap.ranking.map((r, i) => [r.feature, i + 1]));
    const maxImpurity = Math.max(...importance.map((r) => r.importance), 1e-9);
    const maxShap = Math.max(...shap.ranking.map((r) => r.mean_abs_shap), 1e-9);

    return importance.slice(0, 14).map((row) => {
      const s = shapByFeature.get(row.feature);
      return {
        feature: row.feature,
        label: s?.label ?? row.feature.replace(/_/g, " "),
        group: s?.group ?? "other",
        impurity: row.importance,
        impurityWidth: (row.importance / maxImpurity) * 100,
        shap: s?.mean_abs_shap ?? 0,
        shapWidth: ((s?.mean_abs_shap ?? 0) / maxShap) * 100,
        direction: s?.mean_shap ?? 0,
        rankShift: (impurityRank.get(row.feature) ?? 0) - (shapRank.get(row.feature) ?? 0),
      };
    });
  }, [importance, shap]);

  return (
    <div>
      <div className="grid grid-cols-[minmax(0,1fr)_1fr_1fr] items-baseline gap-4 border-b border-[var(--border)] pb-2">
        <span className="label text-[8px]">Input</span>
        <span className="label text-[8px]">Impurity importance (share of variance reduced)</span>
        <span className="label text-[8px]">SHAP (mean |contribution|, {unit})</span>
      </div>

      <ul className="divide-y divide-[var(--border)]">
        {rows.map((row, i) => (
          <li
            key={row.feature}
            className="grid grid-cols-[minmax(0,1fr)_1fr_1fr] items-center gap-4 py-2.5"
          >
            <span className="min-w-0">
              <span className="block truncate text-[12.5px]">{row.label}</span>
              <span className="label mt-0.5 block text-[8px]">
                {row.group}
                {Math.abs(row.rankShift) >= 3 && (
                  <span className="ml-1.5 text-[var(--secondary)]">
                    {row.rankShift > 0 ? "↑" : "↓"} {Math.abs(row.rankShift)} places under SHAP
                  </span>
                )}
              </span>
            </span>

            <span className="flex items-center gap-2">
              <span className="relative h-[7px] flex-1 bg-[var(--surface-sunk)]">
                <motion.span
                  className="absolute inset-y-0 left-0 bg-[var(--heat-3)]"
                  initial={reduce ? false : { width: 0 }}
                  whileInView={{ width: `${Math.max(1, row.impurityWidth)}%` }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.42, delay: i * 0.025, ease: [0.16, 1, 0.3, 1] }}
                />
              </span>
              <span className="data w-[3.2rem] shrink-0 text-right text-[11px]">
                {(row.impurity * 100).toFixed(1)}%
              </span>
            </span>

            <span className="flex items-center gap-2">
              <span className="relative h-[7px] flex-1 bg-[var(--surface-sunk)]">
                <motion.span
                  className="absolute inset-y-0 left-0"
                  style={{
                    background: row.direction >= 0 ? "var(--heat-5)" : "var(--mineral)",
                  }}
                  initial={reduce ? false : { width: 0 }}
                  whileInView={{ width: `${Math.max(1, row.shapWidth)}%` }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.42, delay: i * 0.025, ease: [0.16, 1, 0.3, 1] }}
                />
              </span>
              <span className="data w-[3.2rem] shrink-0 text-right text-[11px]">
                {fixed(row.shap, 3)}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-4 max-w-3xl text-[11.5px] leading-relaxed text-[var(--foreground-muted)]">
        Impurity importance is biased towards inputs with many distinct values — continuous
        variables score highly simply because there are more places to split them. SHAP is
        computed on held-out rows and measures the effect on the output, which is the
        question a reader actually has. Where an input climbs or falls several places between
        the two columns, that is flagged.
      </p>
    </div>
  );
}
