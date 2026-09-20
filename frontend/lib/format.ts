/** Formatting and the shared thermal colour ramp. */

export function signed(value: number, decimals = 2): string {
  const rounded = Number(value.toFixed(decimals));
  return `${rounded > 0 ? "+" : rounded === 0 ? "" : "−"}${Math.abs(rounded).toFixed(decimals)}`;
}

export function fixed(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(decimals);
}

export function compact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(0);
}

export function percent(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(decimals)}%`;
}

export function seconds(value: number): string {
  if (value < 1) return `${(value * 1000).toFixed(0)} ms`;
  if (value < 90) return `${value.toFixed(1)} s`;
  return `${(value / 60).toFixed(1)} min`;
}

export function dateLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function timeLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const SEASONS = ["Winter", "Spring", "Summer", "Autumn"];

/* ── Thermal ramp ─────────────────────────────────────────────────────────
   Seven stops from mineral (cooler than the countryside) through sand to
   fired brick. Used identically by the map, the ladder and every heat chart
   so a colour means the same thing everywhere in the product.            */
export const HEAT_RAMP = [
  "var(--heat-0)", "var(--heat-1)", "var(--heat-2)", "var(--heat-3)",
  "var(--heat-4)", "var(--heat-5)", "var(--heat-6)",
] as const;

/** Literal hex stops, for canvas/WebGL contexts that cannot resolve CSS vars. */
export const HEAT_RAMP_HEX_LIGHT = [
  "#2d5560", "#6c8a86", "#c8b98f", "#d99a4e", "#c2601f", "#a3300e", "#6d1707",
] as const;
export const HEAT_RAMP_HEX_DARK = [
  "#4b7e8c", "#7ea19a", "#cbbd93", "#e0a457", "#dc7330", "#bf4118", "#8d2410",
] as const;

export function rampIndex(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || max <= min) return 3;
  const t = (value - min) / (max - min);
  return Math.min(HEAT_RAMP.length - 1, Math.max(0, Math.round(t * (HEAT_RAMP.length - 1))));
}

export function heatColor(value: number, min: number, max: number): string {
  return HEAT_RAMP[rampIndex(value, min, max)];
}

export function heatColorHex(value: number, min: number, max: number, dark: boolean): string {
  const ramp = dark ? HEAT_RAMP_HEX_DARK : HEAT_RAMP_HEX_LIGHT;
  return ramp[rampIndex(value, min, max)];
}

export const RISK_LABELS: Record<string, { label: string; tone: string }> = {
  none: { label: "No elevated risk", tone: "var(--accent)" },
  caution: { label: "Caution", tone: "var(--heat-3)" },
  "extreme-caution": { label: "Extreme caution", tone: "var(--heat-4)" },
  danger: { label: "Danger", tone: "var(--heat-5)" },
  "extreme-danger": { label: "Extreme danger", tone: "var(--heat-6)" },
};

export const CLASS_TONE: Record<string, string> = {
  urban: "var(--primary)",
  suburban: "var(--secondary)",
  rural: "var(--accent)",
};
