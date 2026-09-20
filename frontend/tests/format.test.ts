import { describe, expect, it } from "vitest";

import {
  CLASS_TONE, HEAT_RAMP, RISK_LABELS, compact, fixed, heatColor,
  percent, rampIndex, seconds, signed,
} from "@/lib/format";

describe("signed", () => {
  it("prefixes positives with a plus", () => {
    expect(signed(1.234, 2)).toBe("+1.23");
  });

  it("uses a true minus sign for negatives", () => {
    expect(signed(-1.234, 2)).toBe("−1.23");
  });

  it("gives zero no sign at all", () => {
    expect(signed(0, 2)).toBe("0.00");
    expect(signed(0.0001, 2)).toBe("0.00");
  });
});

describe("fixed", () => {
  it("renders an em dash for absent values", () => {
    expect(fixed(null)).toBe("—");
    expect(fixed(undefined)).toBe("—");
    expect(fixed(Number.NaN)).toBe("—");
  });

  it("respects the requested precision", () => {
    expect(fixed(3.14159, 3)).toBe("3.142");
  });
});

describe("compact", () => {
  it("abbreviates thousands and millions", () => {
    expect(compact(4_158_374)).toBe("4.16M");
    expect(compact(12_500)).toBe("12.5k");
    expect(compact(842)).toBe("842");
  });

  it("handles absent values", () => {
    expect(compact(null)).toBe("—");
  });
});

describe("percent", () => {
  it("scales a fraction", () => {
    expect(percent(0.4246, 1)).toBe("42.5%");
  });
});

describe("seconds", () => {
  it("switches units by magnitude", () => {
    expect(seconds(0.42)).toBe("420 ms");
    expect(seconds(13.5)).toBe("13.5 s");
    expect(seconds(786)).toBe("13.1 min");
  });
});

describe("thermal ramp", () => {
  it("maps the domain bounds onto the ramp ends", () => {
    expect(rampIndex(-2, -2, 6)).toBe(0);
    expect(rampIndex(6, -2, 6)).toBe(HEAT_RAMP.length - 1);
  });

  it("is monotone across the domain", () => {
    const indices = [-2, 0, 2, 4, 6].map((v) => rampIndex(v, -2, 6));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it("clamps values outside the domain rather than overflowing", () => {
    expect(rampIndex(-50, -2, 6)).toBe(0);
    expect(rampIndex(50, -2, 6)).toBe(HEAT_RAMP.length - 1);
  });

  it("falls back to the middle stop for a degenerate domain", () => {
    expect(rampIndex(1, 5, 5)).toBe(3);
    expect(rampIndex(Number.NaN, 0, 10)).toBe(3);
  });

  it("always returns a defined CSS variable", () => {
    for (const value of [-5, 0, 1.5, 3, 99]) {
      expect(heatColor(value, -2, 6)).toMatch(/^var\(--heat-[0-6]\)$/);
    }
  });
});

describe("risk bands", () => {
  it("covers every band the API can return", () => {
    for (const band of ["none", "caution", "extreme-caution", "danger", "extreme-danger"]) {
      expect(RISK_LABELS[band]).toBeDefined();
      expect(RISK_LABELS[band].tone).toMatch(/^var\(--/);
    }
  });
});

describe("class tones", () => {
  it("covers every site class", () => {
    for (const cls of ["urban", "suburban", "rural"]) {
      expect(CLASS_TONE[cls]).toMatch(/^var\(--/);
    }
  });
});
