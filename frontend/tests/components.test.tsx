import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AttributionBridge } from "@/components/signature/AttributionBridge";
import { MorphologyFingerprint } from "@/components/signature/MorphologyFingerprint";
import { ThermalLadder } from "@/components/signature/ThermalLadder";
import { HeatReadout } from "@/components/prediction/HeatReadout";
import { MapLegend } from "@/components/map/MapLegend";
import { Button, EmptyState, ErrorState, LoadingState, Tabs } from "@/components/ui/primitives";
import type { Explanation, HeatPredictResponse, Morphology } from "@/lib/types";

const explanation: Explanation = {
  base_value: 0.42,
  prediction: 2.31,
  contributions: [
    { feature: "impervious_fraction_1km", label: "Impervious surface (1 km)", unit: "0-1",
      group: "morphology", value: 0.29, contribution: 0.84, direction: "increases" },
    { feature: "wind_speed_ms", label: "Wind speed", unit: "m/s",
      group: "atmosphere", value: 1.0, contribution: 0.61, direction: "increases" },
    { feature: "green_fraction_1km", label: "Green cover (1 km)", unit: "0-1",
      group: "morphology", value: 0.52, contribution: -0.37, direction: "decreases" },
  ],
  other_features_contribution: 0.81,
  interpretation: "Values are SHAP attributions in the model's output units.",
};

const morphology: Morphology = {
  building_plan_fraction_1km: 0.21,
  building_count_km2_1km: 480,
  building_count_km2_3km: 578,
  road_length_km_km2_1km: 12.5,
  green_fraction_1km: 0.52,
  water_fraction_1km: 0.07,
  impervious_fraction_1km: 0.29,
};

const prediction: HeatPredictResponse = {
  prediction: {
    uhi_intensity_c: 2.31,
    site_temperature_c: 26.31,
    background_temperature_c: 24.0,
    relative_humidity_pct: 63.4,
    heat_index_c: 27.8,
  },
  risk: {
    band: "caution",
    description: "Fatigue possible with prolonged exposure or activity.",
    heat_index_c: 27.8,
    basis: "US National Weather Service heat-index categories.",
  },
  site: {
    station_id: "725053-94728", name: "Central Park", state: "NY",
    lat: 40.779, lon: -73.969, elevation_m: 39, urban_class: "urban",
    morphology, overridden: {},
  },
  conditions: { t_ref_c: 24, dewpoint_ref_c: 18.5, wind_speed_ms: 1, sky_cover_oktas: 0, slp_hpa: 1016, precip_1h_mm: 0 },
  timestamp_utc: "2024-07-16T03:00:00+00:00",
  timestamp_local: "2024-07-15T23:00:00-04:00",
  explanation,
  model: {
    task: "heat", name: "Random Forest (compact)", version: "1.0.0",
    trained_at: "2024-01-01T00:00:00", test_r2: 0.425, test_rmse: 1.519,
    target: "uhi_intensity_c", unit: "°C",
  },
  disclaimer: "This is a statistical prediction, not a causal claim.",
};

describe("AttributionBridge", () => {
  it("anchors the span between the model average and this prediction", () => {
    render(<AttributionBridge explanation={explanation} />);
    expect(screen.getByText("Model average")).toBeInTheDocument();
    expect(screen.getByText("0.42")).toBeInTheDocument();
    expect(screen.getByText("This prediction")).toBeInTheDocument();
    expect(screen.getByText("2.31")).toBeInTheDocument();
  });

  it("signs every contribution so direction is unambiguous", () => {
    render(<AttributionBridge explanation={explanation} />);
    expect(screen.getByText("+0.84")).toBeInTheDocument();
    expect(screen.getByText("+0.61")).toBeInTheDocument();
    expect(screen.getByText("−0.37")).toBeInTheDocument();
  });

  it("accounts for the features it did not list", () => {
    render(<AttributionBridge explanation={explanation} />);
    expect(screen.getByText(/All remaining inputs together/)).toBeInTheDocument();
  });

  it("respects the maximum number of girders", () => {
    render(<AttributionBridge explanation={explanation} max={2} />);
    expect(screen.getByText("Impervious surface (1 km)")).toBeInTheDocument();
    expect(screen.queryByText("Green cover (1 km)")).not.toBeInTheDocument();
  });
});

describe("ThermalLadder", () => {
  it("prints the prediction with an explicit sign", () => {
    render(<ThermalLadder value={2.31} min={-2} max={6} />);
    expect(screen.getByText("+2.31")).toBeInTheDocument();
  });

  it("labels the extremes of the scale", () => {
    render(<ThermalLadder value={0} min={-2} max={6} />);
    expect(screen.getByText("6.0")).toBeInTheDocument();
    expect(screen.getByText("-2.0")).toBeInTheDocument();
  });

  it("renders reference markers", () => {
    render(
      <ThermalLadder value={1} min={-2} max={6}
        markers={[{ value: 0.98, label: "urban mean" }]} />,
    );
    expect(screen.getByText(/urban mean/)).toBeInTheDocument();
  });
});

describe("MorphologyFingerprint", () => {
  it("shows all five channels as percentages or densities", () => {
    render(<MorphologyFingerprint morphology={morphology} />);
    for (const label of ["Built", "Sealed", "Green", "Water", "Roads"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("52%")).toBeInTheDocument();   // green
    expect(screen.getByText("12.5")).toBeInTheDocument();  // road density
  });

  it("can be rendered without labels for dense contexts", () => {
    render(<MorphologyFingerprint morphology={morphology} showLabels={false} />);
    expect(screen.queryByText("Built")).not.toBeInTheDocument();
  });
});

describe("HeatReadout", () => {
  it("leads with the anomaly and derives the rest from it", () => {
    render(<HeatReadout result={prediction} networkRange={[-2, 6]} />);
    // The value appears twice on purpose: once as the headline readout, once as
    // the needle on the thermal ladder beside it.
    expect(screen.getAllByText("+2.31")).toHaveLength(2);
    expect(screen.getByText("Site temperature")).toBeInTheDocument();
    expect(screen.getByText("26.3")).toBeInTheDocument();
    expect(screen.getByText("Feels like")).toBeInTheDocument();
  });

  it("presents the risk band as an interpretation with its basis", () => {
    render(<HeatReadout result={prediction} />);
    expect(screen.getByText("Caution")).toBeInTheDocument();
    expect(screen.getByText(/National Weather Service/)).toBeInTheDocument();
  });
});

describe("MapLegend", () => {
  it("prints the bounds through the supplied formatter", () => {
    render(
      <MapLegend label="Modelled anomaly" unit="°C" min={-0.5} max={3.2}
        format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`} />,
    );
    expect(screen.getByText("Modelled anomaly")).toBeInTheDocument();
    expect(screen.getByText("-0.50")).toBeInTheDocument();
    expect(screen.getByText("+3.20")).toBeInTheDocument();
  });
});

describe("states", () => {
  it("announces loading politely", () => {
    render(<LoadingState label="Scoring the network" />);
    const status = screen.getByRole("status");
    expect(within(status).getByText("Scoring the network")).toBeInTheDocument();
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("surfaces the real error message and offers a retry", async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Cannot reach the prediction service." onRetry={onRetry} />);

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("Cannot reach the prediction service.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("renders an empty state without inventing content", () => {
    render(<EmptyState message="No site matches that search." />);
    expect(screen.getByText("No site matches that search.")).toBeInTheDocument();
  });
});

describe("controls", () => {
  it("marks the selected tab for assistive technology", async () => {
    const onChange = vi.fn();
    render(
      <Tabs
        options={[
          { value: "heat", label: "Urban heat" },
          { value: "energy", label: "Electricity demand" },
        ]}
        value="heat"
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("tab", { name: "Urban heat" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: "Electricity demand" }));
    expect(onChange).toHaveBeenCalledWith("energy");
  });

  it("does not fire while disabled", async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Run prediction</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Run prediction" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
