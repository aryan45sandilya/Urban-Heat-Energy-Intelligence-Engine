"use client";

import { Plus, X } from "lucide-react";

import { Slider } from "@/components/controls/Slider";
import { Button } from "@/components/ui/primitives";
import type { HeatConditions, Morphology, Site } from "@/lib/types";

export interface ScenarioDraft {
  id: string;
  name: string;
  description?: string;
  overrides: Partial<Morphology>;
  conditions?: HeatConditions | null;
}

const LEVERS = [
  {
    key: "green_fraction_1km" as const,
    label: "Green cover",
    unit: "%",
    scale: 100,
    min: 0,
    max: 0.9,
    step: 0.01,
    description: "Share of ground within 1 km that is park, forest, grass or other vegetation.",
  },
  {
    key: "impervious_fraction_1km" as const,
    label: "Sealed surface",
    unit: "%",
    scale: 100,
    min: 0,
    max: 0.45,
    step: 0.005,
    description: "Building footprints plus road carriageway — the surfaces that store and re-radiate heat.",
  },
  {
    key: "building_plan_fraction_1km" as const,
    label: "Building footprint",
    unit: "%",
    scale: 100,
    min: 0,
    max: 0.3,
    step: 0.005,
    description: "Share of ground covered by buildings within 1 km.",
  },
  {
    key: "building_count_km2_3km" as const,
    label: "Neighbourhood density",
    unit: "/km²",
    scale: 1,
    min: 0,
    max: 1300,
    step: 10,
    description: "Buildings per square kilometre in the surrounding 3 km — the urban context.",
  },
  {
    key: "road_length_km_km2_1km" as const,
    label: "Road density",
    unit: "km/km²",
    scale: 1,
    min: 0,
    max: 26,
    step: 0.5,
    description: "Length of road carriageway per square kilometre within 1 km.",
  },
  {
    key: "water_fraction_1km" as const,
    label: "Water cover",
    unit: "%",
    scale: 100,
    min: 0,
    max: 0.25,
    step: 0.005,
    description: "Share of ground covered by water bodies within 1 km.",
  },
];

/** Scenarios seeded from what is measured at the site, then moved deliberately. */
export function buildDefaultScenarios(site: Site): ScenarioDraft[] {
  const m = site.morphology;
  return [
    {
      id: "greening",
      name: "Greening programme",
      description: "Green cover raised by 20 points of ground area, sealed surface reduced to match.",
      overrides: {
        green_fraction_1km: Math.min(0.9, m.green_fraction_1km + 0.20),
        impervious_fraction_1km: Math.max(0, m.impervious_fraction_1km - 0.06),
      },
    },
    {
      id: "densification",
      name: "Densification",
      description: "Building footprint and neighbourhood density increased by half.",
      overrides: {
        building_plan_fraction_1km: Math.min(0.3, m.building_plan_fraction_1km * 1.5),
        building_count_km2_3km: Math.min(1300, m.building_count_km2_3km * 1.5),
        impervious_fraction_1km: Math.min(0.45, m.impervious_fraction_1km * 1.3),
      },
    },
    {
      id: "desealing",
      name: "De-sealing",
      description: "Sealed ground cut by a third; road density reduced with it.",
      overrides: {
        impervious_fraction_1km: m.impervious_fraction_1km * 0.66,
        road_length_km_km2_1km: m.road_length_km_km2_1km * 0.7,
      },
    },
  ];
}

export function ScenarioEditor({
  site, scenarios, onChange,
}: {
  site: Site;
  scenarios: ScenarioDraft[];
  onChange: (next: ScenarioDraft[]) => void;
}) {
  const update = (id: string, key: keyof Morphology, value: number) =>
    onChange(
      scenarios.map((scenario) =>
        scenario.id === id
          ? { ...scenario, overrides: { ...scenario.overrides, [key]: value } }
          : scenario,
      ),
    );

  const rename = (id: string, name: string) =>
    onChange(scenarios.map((s) => (s.id === id ? { ...s, name } : s)));

  const remove = (id: string) => onChange(scenarios.filter((s) => s.id !== id));

  const add = () =>
    onChange([
      ...scenarios,
      {
        id: `custom-${Date.now()}`,
        name: `Scenario ${scenarios.length + 1}`,
        description: "Custom combination of site changes.",
        overrides: {},
      },
    ]);

  return (
    <div className="grid gap-px bg-[var(--border)] lg:grid-cols-2 2xl:grid-cols-3">
      {scenarios.map((scenario) => (
        <div key={scenario.id} className="bg-[var(--background)] p-4 lg:p-5">
          <div className="flex items-start gap-2 pb-3">
            <input
              value={scenario.name}
              onChange={(event) => rename(scenario.id, event.target.value)}
              aria-label="Scenario name"
              maxLength={60}
              className="min-w-0 flex-1 border-b border-transparent bg-transparent pb-1
                         font-[family-name:var(--font-display)] text-[14px] font-semibold
                         outline-none transition-colors
                         hover:border-[var(--border)] focus:border-[var(--primary)]"
            />
            {scenarios.length > 1 && (
              <button
                type="button"
                onClick={() => remove(scenario.id)}
                aria-label={`Remove ${scenario.name}`}
                className="shrink-0 p-1 text-[var(--foreground-faint)] transition-colors
                           hover:text-[var(--danger)]"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="space-y-3.5">
            {LEVERS.map((lever) => {
              const current =
                scenario.overrides[lever.key] ??
                (site.morphology as unknown as Record<string, number>)[lever.key];
              const measured = (site.morphology as unknown as Record<string, number>)[lever.key];
              return (
                <Slider
                  key={lever.key}
                  label={lever.label}
                  unit={lever.unit}
                  decimals={lever.scale === 100 ? 0 : lever.key === "building_count_km2_3km" ? 0 : 1}
                  min={lever.min * lever.scale}
                  max={lever.max * lever.scale}
                  step={lever.step * lever.scale}
                  value={Number(((current ?? 0) * lever.scale).toFixed(4))}
                  baseline={Number((measured * lever.scale).toFixed(4))}
                  onChange={(value) => update(scenario.id, lever.key, value / lever.scale)}
                  description={lever.description}
                />
              );
            })}
          </div>
        </div>
      ))}

      {scenarios.length < 5 && (
        <div className="flex items-center justify-center bg-[var(--background)] p-6">
          <Button variant="outline" onClick={add}>
            <Plus size={13} />
            Add a scenario
          </Button>
        </div>
      )}
    </div>
  );
}
