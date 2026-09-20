"use client";

import { Block, BlockHeader } from "@/components/ui/primitives";
import { fixed } from "@/lib/format";

const CONCEPTS = [
  {
    title: "A tree splits, and then overfits",
    body:
      "A decision tree asks a chain of yes/no questions — is the wind under 2 m/s, is the "
      + "sealed fraction above 18% — until each leaf holds a handful of similar hours. Grown "
      + "deep enough it can fit the training data almost perfectly, which is precisely the "
      + "problem: it has memorised noise. The single tree in the comparison shows exactly "
      + "that gap between its training and validation scores.",
  },
  {
    title: "Bootstrap sampling decorrelates the errors",
    body:
      "Each tree in the forest is grown on a different bootstrap resample of the training "
      + "rows. The trees therefore make different mistakes, and averaging their predictions "
      + "cancels much of the variance while leaving the shared signal intact.",
  },
  {
    title: "Feature randomness stops one input dominating",
    body:
      "At every split, each tree may only consider a random subset of the inputs. Without "
      + "this, background temperature and the night flag would head every tree and the "
      + "morphology variables would rarely get a look in. The constraint forces the ensemble "
      + "to find structure in the weaker predictors too.",
  },
  {
    title: "Why it suits this problem",
    body:
      "The heat island is a product of interactions, not a sum of effects: sealed ground "
      + "matters at night and barely at noon, and only when the wind is light. A forest "
      + "represents that kind of conditional structure natively, without being told which "
      + "interactions to look for — which is why it beats the regularised linear models here "
      + "by a wide margin.",
  },
  {
    title: "What it cannot do",
    body:
      "A forest cannot extrapolate. Ask it about a sealed fraction higher than anything in "
      + "the training data and it returns the value at the edge of what it saw, with no "
      + "warning. It also gives no calibrated uncertainty, and it is not a physical model: "
      + "it has learned an association between conditions and measured temperature "
      + "differences, nothing more.",
  },
] as const;

const PARAM_NOTES: Record<string, string> = {
  n_estimators: "Trees averaged. More is steadier and slower; the benefit flattens quickly.",
  max_depth: "How many questions deep a tree may go. Unbounded lets leaves become tiny.",
  min_samples_split: "A node below this size is never split further.",
  min_samples_leaf: "The floor on leaf size — the main brake on memorisation.",
  max_features: "How many inputs each split may consider. Lower means more decorrelation.",
  bootstrap: "Whether each tree is grown on a resample or on the whole training set.",
};

export function ForestAnatomy({
  hyperparameters, metrics, unit,
}: {
  hyperparameters: Record<string, unknown>;
  metrics: Record<string, unknown>;
  unit: string;
}) {
  const train = metrics.train as { r2: number } | undefined;
  const validation = metrics.validation as { r2: number } | undefined;
  const oob = metrics.oob_r2 as number | undefined;

  return (
    <div className="grid gap-px border-t border-[var(--border)] bg-[var(--border)] lg:grid-cols-12">
      <Block className="bg-[var(--background)] py-8 lg:col-span-5 lg:pr-7">
        <BlockHeader title="The shipped forest" meta="Configuration and shape" />
        <dl className="divide-y divide-[var(--border)]">
          {Object.entries(hyperparameters).map(([key, value]) => (
            <div key={key} className="py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[12.5px] font-medium">{key}</dt>
                <dd className="data text-[12.5px] text-[var(--primary)]">
                  {value === null || value === "None" ? "unbounded" : String(value)}
                </dd>
              </div>
              {PARAM_NOTES[key] && (
                <p className="mt-1 text-[11px] leading-snug text-[var(--foreground-muted)]">
                  {PARAM_NOTES[key]}
                </p>
              )}
            </div>
          ))}
        </dl>

        <dl className="mt-5 grid grid-cols-2 gap-px border border-[var(--border)] bg-[var(--border)] sm:grid-cols-4">
          <Stat label="Mean depth" value={fixed(metrics.mean_tree_depth as number, 1)} />
          <Stat
            label="Mean leaves"
            value={Math.round((metrics.mean_leaves as number) ?? 0).toLocaleString()}
          />
          <Stat label="Train R²" value={fixed(train?.r2, 3)} />
          <Stat label="Valid R²" value={fixed(validation?.r2, 3)} />
        </dl>

        {train && validation && (
          <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--foreground-muted)]">
            The gap between training R² ({fixed(train.r2, 3)}) and validation R² (
            {fixed(validation.r2, 3)}) is the forest&apos;s memorisation showing through. Deep
            unpruned trees fit the training rows closely; the ensemble average is what
            generalises.
            {oob !== undefined && (
              <> Out-of-bag R² is {fixed(oob, 3)} — an internal estimate from the rows each
              tree did not see.</>
            )}
          </p>
        )}
      </Block>

      <Block className="bg-[var(--background)] py-8 lg:col-span-7 lg:pl-7">
        <BlockHeader
          title="Why a Random Forest, in plain terms"
          meta={`Predictions are in ${unit}`}
        />
        <div className="grid gap-px bg-[var(--border)] sm:grid-cols-2">
          {CONCEPTS.map((concept, i) => (
            <div key={concept.title} className="bg-[var(--background)] py-4 sm:px-4 sm:first:pl-0">
              <p className="data text-[10px] text-[var(--foreground-faint)]">
                {String(i + 1).padStart(2, "0")}
              </p>
              <h3 className="mt-1 text-[14px] leading-snug">{concept.title}</h3>
              <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--foreground-muted)]">
                {concept.body}
              </p>
            </div>
          ))}
        </div>
      </Block>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--surface)] px-3 py-2.5">
      <p className="label text-[8px]">{label}</p>
      <p className="readout mt-1 text-[16px]">{value}</p>
    </div>
  );
}
