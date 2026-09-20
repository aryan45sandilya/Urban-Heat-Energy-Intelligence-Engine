"use client";

import { motion, useReducedMotion } from "motion/react";

import { Page } from "@/components/ui/primitives";

const STAGES = [
  {
    n: "01",
    title: "Observe",
    body: "NOAA ISD-Lite hourly records for every station in the Northeast corridor whose period of record spans the study window.",
  },
  {
    n: "02",
    title: "Measure the ground",
    body: "OpenStreetMap geometry sampled on a 20 m lattice inside 1 km of each station: built, sealed, vegetated, water, road.",
  },
  {
    n: "03",
    title: "Difference",
    body: "Each site is compared hour-for-hour against its three nearest rural references, corrected for altitude. What remains is the heat island.",
  },
  {
    n: "04",
    title: "Learn",
    body: "Ten model families fitted on identical chronological splits; the Random Forest is then tuned by time-series cross-validation.",
  },
  {
    n: "05",
    title: "Explain",
    body: "SHAP attributions turn each prediction into a list of contributions in degrees — globally and for any single case.",
  },
  {
    n: "06",
    title: "Interrogate",
    body: "Rerun the fitted model under changed conditions and compare. The delta is the model's sensitivity, stated as such.",
  },
] as const;

export function PipelineDiagram() {
  const reduce = useReducedMotion();

  return (
    <section className="border-b border-[var(--border)]">
      <Page>
        <div className="py-12 lg:py-16">
          <div className="max-w-2xl">
            <p className="label">From raw record to interrogable model</p>
            <h2 className="mt-3 text-[clamp(1.5rem,3.2vw,2.1rem)]">
              Six stages, each one reproducible from a single command
            </h2>
          </div>

          <ol className="mt-10 grid gap-px bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-3">
            {STAGES.map((stage, i) => (
              <motion.li
                key={stage.n}
                className="relative bg-[var(--background)] p-6 lg:p-7"
                initial={reduce ? false : { opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.4, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
              >
                <span
                  className="absolute left-0 top-0 h-[3px] bg-[var(--primary)]"
                  style={{ width: `${((i + 1) / STAGES.length) * 100}%` }}
                  aria-hidden
                />
                <p className="data text-[11px] text-[var(--foreground-faint)]">{stage.n}</p>
                <h3 className="mt-2 text-[1.15rem]">{stage.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--foreground-muted)]">
                  {stage.body}
                </p>
              </motion.li>
            ))}
          </ol>
        </div>
      </Page>
    </section>
  );
}
