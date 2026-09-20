"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { MorphologyFingerprint } from "@/components/signature/MorphologyFingerprint";
import { CLASS_TONE, RISK_LABELS, fixed } from "@/lib/format";
import type { BaselineHotspots, HotspotSite } from "@/lib/types";

type Site = BaselineHotspots["sites"][number];

export function MapSitePanel({
  site, live,
}: {
  site: Site;
  live: HotspotSite | null;
}) {
  const modelled = live?.uhi_c ?? site.modelled.uhi_c;
  const heatIndex = live?.heat_index_c ?? site.modelled.heat_index_c;
  const risk = RISK_LABELS[live?.heat_risk ?? site.modelled.heat_risk];

  return (
    <div className="p-4">
      <p className="label" style={{ color: CLASS_TONE[site.urban_class] }}>
        {site.urban_class} site
      </p>
      <h2 className="mt-1 pr-6 text-[1.05rem] leading-snug">{site.name}</h2>
      <p className="label mt-1 text-[8.5px]">
        {site.state} · {site.lat.toFixed(3)}°N {Math.abs(site.lon).toFixed(3)}°W ·{" "}
        {site.elevation_m.toFixed(0)} m
      </p>

      <div className="mt-4 grid grid-cols-2 gap-px border border-[var(--border)] bg-[var(--border)]">
        <Cell
          label="Modelled ΔT"
          value={`${modelled > 0 ? "+" : ""}${fixed(modelled, 2)}`}
          unit="°C"
          note="under the conditions set"
          accent
        />
        <Cell
          label="Measured ΔT"
          value={`${site.observed.summer_night_mean_uhi_c > 0 ? "+" : ""}${fixed(site.observed.summer_night_mean_uhi_c, 2)}`}
          unit="°C"
          note={`${site.observed.summer_night_hours.toLocaleString()} summer nights`}
        />
        <Cell
          label="Heat index"
          value={fixed(heatIndex, 1)}
          unit="°C"
          note={risk ? risk.label : undefined}
          tone={risk?.tone}
        />
        <Cell
          label="Measured 90th pct"
          value={`${site.observed.summer_night_p90_uhi_c > 0 ? "+" : ""}${fixed(site.observed.summer_night_p90_uhi_c, 2)}`}
          unit="°C"
          note="hottest nights"
        />
      </div>

      <div className="mt-4">
        <p className="label mb-2">Urban fabric within 1 km</p>
        <MorphologyFingerprint morphology={site.morphology} />
      </div>

      <dl className="mt-4 space-y-1 border-t border-[var(--border)] pt-3">
        <Row
          label="Neighbourhood density"
          value={`${site.morphology.building_count_km2_3km.toFixed(0)} buildings/km² (3 km)`}
        />
        <Row
          label="Annual mean anomaly"
          value={`${site.observed.annual_mean_uhi_c > 0 ? "+" : ""}${fixed(site.observed.annual_mean_uhi_c, 2)} °C`}
        />
        <Row
          label="Hours behind these figures"
          value={site.observed.annual_hours.toLocaleString()}
        />
      </dl>

      <Link
        href="/simulate"
        className="label mt-4 inline-flex items-center gap-1.5 text-[var(--primary)]
                   underline-offset-4 hover:underline"
      >
        Test a change at this site
        <ArrowRight size={11} />
      </Link>
    </div>
  );
}

function Cell({
  label, value, unit, note, accent, tone,
}: {
  label: string;
  value: string;
  unit: string;
  note?: string;
  accent?: boolean;
  tone?: string;
}) {
  return (
    <div className="bg-[var(--surface)] px-3 py-2.5">
      <p className="label text-[8px]">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span
          className="readout text-[19px]"
          style={{ color: accent ? "var(--primary)" : undefined }}
        >
          {value}
        </span>
        <span className="data text-[9px] text-[var(--foreground-muted)]">{unit}</span>
      </p>
      {note && (
        <p className="mt-0.5 text-[9.5px]" style={{ color: tone ?? "var(--foreground-faint)" }}>
          {note}
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[11px] text-[var(--foreground-muted)]">{label}</dt>
      <dd className="data text-[11px]">{value}</dd>
    </div>
  );
}
