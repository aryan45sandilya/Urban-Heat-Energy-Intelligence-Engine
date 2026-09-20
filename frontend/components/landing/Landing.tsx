"use client";

import Link from "next/link";
import { ArrowRight, Compass, GitBranch, Layers, Thermometer } from "lucide-react";

import { HeroField } from "./HeroField";
import { NetworkStats } from "./NetworkStats";
import { PipelineDiagram } from "./PipelineDiagram";
import { useHeatEda, useMeta } from "@/hooks/useApi";
import { Page, Reveal } from "@/components/ui/primitives";
import { fixed } from "@/lib/format";

const CAPABILITIES = [
  {
    icon: Thermometer,
    title: "Predict",
    href: "/predict",
    body:
      "How much hotter is this place than the countryside around it, under these conditions? " +
      "A tuned Random Forest answers in degrees, at any of 166 measured locations.",
  },
  {
    icon: GitBranch,
    title: "Explain",
    href: "/predict",
    body:
      "Every prediction arrives with its SHAP attribution: which inputs pushed the number up, " +
      "which pulled it down, and by how much — in degrees, not in abstractions.",
  },
  {
    icon: Layers,
    title: "Simulate",
    href: "/simulate",
    body:
      "Change the green cover, the sealed surface, the wind. The same fitted model runs again " +
      "and the two results are placed side by side with the difference spelled out.",
  },
  {
    icon: Compass,
    title: "Map",
    href: "/map",
    body:
      "Hold the weather identical across the whole network and the remaining differences are " +
      "the cities themselves. That map is the planner's question, answered.",
  },
] as const;

export function Landing() {
  const { data: meta } = useMeta();
  const { data: eda } = useHeatEda();

  const urbanNight = eda?.summer_night?.by_class?.urban?.mean;
  const ruralNight = eda?.summer_night?.by_class?.rural?.mean;

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-[var(--border)]">
        <div className="survey-grid pointer-events-none absolute inset-0" aria-hidden />
        <Page className="relative">
          <div className="grid gap-10 py-14 sm:py-20 lg:grid-cols-12 lg:gap-8 lg:py-24">
            <div className="lg:col-span-7 xl:col-span-6">
              <p className="label">
                Urban climate · Machine learning · Explainable AI
              </p>
              <h1 className="mt-5 text-[clamp(2.1rem,6.4vw,4.4rem)] leading-[0.98]">
                Predict urban heat risk.
                <br />
                <span className="text-[var(--primary)]">Understand why.</span>
                <br />
                Explore what happens next.
              </h1>
              <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-[var(--foreground-muted)] sm:text-base">
                A city is measurably hotter than the land around it. UHEI learns that
                difference from four-plus years of hourly weather-station observations and the
                physical fabric of each place — how much ground is built on, sealed,
                planted or flooded — and then tells you which of those things the model
                leaned on to reach its answer.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  href="/dashboard"
                  className="group inline-flex items-center gap-2 bg-[var(--primary)] px-5 py-3
                             text-[13px] font-medium text-white transition-colors
                             hover:bg-[var(--primary-deep)]"
                  style={{ borderRadius: "var(--radius-sm)" }}
                >
                  Open the intelligence console
                  <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
                <Link
                  href="/method"
                  className="inline-flex items-center gap-2 border border-[var(--border-strong)]
                             px-5 py-3 text-[13px] font-medium transition-colors
                             hover:border-[var(--foreground)] hover:bg-[var(--surface)]"
                  style={{ borderRadius: "var(--radius-sm)" }}
                >
                  How it was built
                </Link>
              </div>

              {urbanNight !== undefined && ruralNight !== undefined && (
                <p className="mt-8 max-w-xl border-l-2 border-[var(--primary)] pl-4 text-[13px] leading-relaxed text-[var(--foreground-muted)]">
                  Measured across this network on summer nights, urban sites sit{" "}
                  <span className="data font-medium text-[var(--foreground)]">
                    {fixed(urbanNight, 2)} °C
                  </span>{" "}
                  above their rural references while rural sites sit at{" "}
                  <span className="data font-medium text-[var(--foreground)]">
                    {fixed(ruralNight, 2)} °C
                  </span>{" "}
                  — the control that says the construction is sound.
                </p>
              )}
            </div>

            <div className="lg:col-span-5 xl:col-span-6">
              <div className="flex h-full min-h-[260px] flex-col justify-end border border-[var(--border)] bg-[var(--surface)] p-4 sm:min-h-[340px] sm:p-5">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <p className="label-strong">Observed network transect</p>
                  <p className="data text-[9px] text-[var(--foreground-faint)]">
                    summer nights · 2022–2026
                  </p>
                </div>
                <div className="h-[180px] sm:h-[240px]">
                  <HeroField />
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-2.5">
                  <span className="label text-[8.5px]">← rural</span>
                  <span className="label text-[8.5px]">
                    ordered by surrounding building density
                  </span>
                  <span className="label text-[8.5px]">dense urban →</span>
                </div>
              </div>
            </div>
          </div>
        </Page>
      </section>

      {/* ── Network facts ────────────────────────────────────────────────── */}
      <NetworkStats />

      {/* ── Capabilities ─────────────────────────────────────────────────── */}
      <section className="border-b border-[var(--border)]">
        <Page>
          <div className="grid gap-px bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-4">
            {CAPABILITIES.map((capability, i) => (
              <Reveal key={capability.title} delay={i * 0.06}>
                <Link
                  href={capability.href}
                  className="group flex h-full flex-col bg-[var(--background)] p-6 transition-colors
                             hover:bg-[var(--surface)] lg:p-7"
                >
                  <capability.icon
                    size={18}
                    className="text-[var(--primary)] transition-transform group-hover:-translate-y-0.5"
                  />
                  <h2 className="mt-4 text-[1.35rem]">{capability.title}</h2>
                  <p className="mt-2.5 flex-1 text-[13px] leading-relaxed text-[var(--foreground-muted)]">
                    {capability.body}
                  </p>
                  <span className="label mt-5 inline-flex items-center gap-1.5 text-[var(--primary)]">
                    Open
                    <ArrowRight size={11} className="transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        </Page>
      </section>

      {/* ── Pipeline ─────────────────────────────────────────────────────── */}
      <PipelineDiagram />

      {/* ── Sources ──────────────────────────────────────────────────────── */}
      <section className="border-b border-[var(--border)] bg-[var(--background-deep)]">
        <Page>
          <div className="grid gap-8 py-12 lg:grid-cols-12 lg:py-16">
            <div className="lg:col-span-4">
              <p className="label">Everything here is measured</p>
              <h2 className="mt-3 text-[clamp(1.5rem,3.2vw,2.1rem)]">
                Three public records, no synthetic data
              </h2>
              <p className="mt-4 text-[14px] leading-relaxed text-[var(--foreground-muted)]">
                No figure in this product is invented, rounded up for effect, or filled in
                when the source was silent. Where the record is thin, the interface says so.
              </p>
            </div>
            <div className="lg:col-span-8">
              <ul className="grid gap-px bg-[var(--border)] sm:grid-cols-2">
                {(meta?.data_sources ?? []).map((source) => (
                  <li key={source.key} className="bg-[var(--background-deep)] p-5">
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-[family-name:var(--font-display)] text-[15px] font-semibold
                                 underline-offset-4 hover:text-[var(--primary)] hover:underline"
                    >
                      {source.name}
                    </a>
                    <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--foreground-muted)]">
                      {source.description}
                    </p>
                    <p className="label mt-3 text-[8.5px]">{source.license}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Page>
      </section>
    </>
  );
}
