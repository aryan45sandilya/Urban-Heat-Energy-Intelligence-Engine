"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Search } from "lucide-react";

import { MorphologyFingerprint } from "@/components/signature/MorphologyFingerprint";
import { ErrorState, LoadingState, Tabs } from "@/components/ui/primitives";
import { useSites } from "@/hooks/useApi";
import { cn } from "@/lib/cn";
import { CLASS_TONE, fixed } from "@/lib/format";
import type { Site } from "@/lib/types";

const CLASS_FILTERS = [
  { value: "all", label: "All" },
  { value: "urban", label: "Urban" },
  { value: "suburban", label: "Suburban" },
  { value: "rural", label: "Rural" },
] as const;

const REGION_FILTERS = [
  { value: "all", label: "All regions", code: null },
  { value: "US", label: "United States", code: "US" },
  { value: "IN", label: "India", code: "IN" },
] as const;

type ClassFilter = (typeof CLASS_FILTERS)[number]["value"];
type RegionFilter = (typeof REGION_FILTERS)[number]["value"];

export function SitePicker({
  value, onChange, height = "22rem",
}: {
  value: string | null;
  onChange: (site: Site) => void;
  height?: string;
}) {
  const { data, error, isLoading, mutate } = useSites();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ClassFilter>("all");
  const [region, setRegion] = useState<RegionFilter>("all");
  const deferred = useDeferredValue(query);

  const results = useMemo(() => {
    const sites = data?.sites ?? [];
    const needle = deferred.trim().toLowerCase();
    return sites.filter((site) => {
      if (filter !== "all" && site.urban_class !== filter) return false;
      if (region !== "all") {
        const siteCountry = site.country ?? "US";
        if (siteCountry.toUpperCase() !== region) return false;
      }
      if (!needle) return true;
      return (
        site.name.toLowerCase().includes(needle) ||
        (site.state ?? "").toLowerCase().includes(needle) ||
        site.station_id.includes(needle)
      );
    });
  }, [data, deferred, filter, region]);

  if (error) {
    return <ErrorState message={error.message} onRetry={() => mutate()} compact />;
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-col gap-2 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--foreground-faint)]"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search sites by name or state"
              aria-label="Search sites"
              className="w-full border border-[var(--border)] bg-[var(--surface)] py-2 pl-8 pr-3
                         text-[12px] outline-none transition-colors
                         placeholder:text-[var(--foreground-faint)]
                         focus:border-[var(--primary)]"
              style={{ borderRadius: "var(--radius-sm)" }}
            />
          </div>
          <Tabs options={CLASS_FILTERS} value={filter} onChange={setFilter} />
        </div>
        <div className="flex gap-1.5">
          {REGION_FILTERS.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRegion(r.value)}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] transition-colors ${
                region === r.value
                  ? "bg-[var(--primary)] text-white"
                  : "border border-[var(--border)] text-[var(--foreground-muted)] hover:border-[var(--foreground)]"
              }`}
              style={{ borderRadius: "var(--radius-sm)" }}
            >
              {r.code && (
                <span
                  className="inline-block rounded px-1 py-px text-[9px] font-bold leading-none"
                  style={{
                    background: region === r.value
                      ? "rgba(255,255,255,0.25)"
                      : "color-mix(in srgb, var(--primary) 18%, transparent)",
                    color: region === r.value ? "white" : "var(--primary)",
                  }}
                >
                  {r.code}
                </span>
              )}
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <LoadingState label="Loading the station network" rows={5} />
      ) : (
        <>
          <ul
            className="scroll-thin min-h-0 flex-1 divide-y divide-[var(--border)] overflow-y-auto
                       border-y border-[var(--border)]"
            style={{ maxHeight: height }}
            role="listbox"
            aria-label="Observation sites"
          >
            {results.map((site) => {
              const selected = site.station_id === value;
              return (
                <li key={site.station_id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => onChange(site)}
                    className={cn(
                      "grid w-full grid-cols-[1fr_auto] items-center gap-3 py-2.5 text-left",
                      "border-l-[3px] transition-colors",
                      selected
                        ? "border-l-[var(--primary)] bg-[var(--primary-soft)] pl-[calc(0.75rem-3px)] pr-3"
                        : "border-l-transparent px-3 hover:bg-[var(--surface)]",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span
                          className="h-[7px] w-[7px] shrink-0"
                          style={{ background: CLASS_TONE[site.urban_class] }}
                          aria-hidden
                        />
                        <span className={cn(
                          "truncate text-[12.5px] font-medium",
                          selected && "text-[var(--foreground)]",
                        )}>
                          {site.name}
                        </span>
                      </span>
                      <span
                        className="label mt-0.5 block text-[8.5px]"
                        style={selected ? { color: "var(--foreground-muted)" } : undefined}
                      >
                        {site.state} · {site.urban_class} ·{" "}
                        {site.morphology.building_count_km2_3km.toFixed(0)} bldg/km²
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      {site.observed ? (
                        <>
                          <span className={cn(
                            "data block text-[13px] font-medium",
                            selected && "text-[var(--foreground)]",
                          )}>
                            {site.observed.summer_night_mean_uhi_c >= 0 ? "+" : ""}
                            {fixed(site.observed.summer_night_mean_uhi_c, 2)}
                          </span>
                          <span className="label block text-[8px]">°C night</span>
                        </>
                      ) : (
                        <span className={cn(
                          "data text-[11px]",
                          selected
                            ? "text-[var(--foreground-muted)]"
                            : "text-[var(--foreground-faint)]",
                        )}>—</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
            {results.length === 0 && (
              <li className="px-3 py-6 text-center text-[12px] text-[var(--foreground-muted)]">
                No site matches that search.
              </li>
            )}
          </ul>
          <p className="label pt-2 text-[8.5px]">
            {results.length} of {data?.count ?? 0} sites · value shown is the measured mean
            summer-night anomaly
          </p>
        </>
      )}
    </div>
  );
}

export function SiteSummaryCard({ site }: { site: Site }) {
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[1.05rem] leading-tight">{site.name}</h3>
          <p className="label mt-1 text-[8.5px]">
            {site.state} · {site.lat.toFixed(3)}°{site.lat >= 0 ? "N" : "S"}{" "}
            {Math.abs(site.lon).toFixed(3)}°{site.lon >= 0 ? "E" : "W"} ·{" "}
            {site.elevation_m.toFixed(0)} m
          </p>
        </div>
        <span
          className="label shrink-0 border px-1.5 py-0.5 text-[8.5px]"
          style={{
            color: CLASS_TONE[site.urban_class],
            borderColor: `color-mix(in srgb, ${CLASS_TONE[site.urban_class]} 40%, transparent)`,
            borderRadius: "var(--radius-sm)",
          }}
        >
          {site.urban_class}
        </span>
      </div>
      <div className="mt-3.5">
        <MorphologyFingerprint morphology={site.morphology} />
      </div>
    </div>
  );
}
