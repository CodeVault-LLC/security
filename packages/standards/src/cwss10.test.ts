import { describe, expect, it } from "vitest";

import {
  buildCwss10Vector,
  calculateCwss10,
  Cwss10VectorError,
} from "./cwss10.js";

const BUSINESS_CRITICAL_VECTOR =
  "(TI:H,0.9/AP:A,1.0/AL:A,1.0/IC:N,1.0/FC:T,1.0/RP:L,0.9/RL:A,1.0/AV:I,1.0/AS:N,1.0/IN:T,0.9/SC:A,1.0/BI:C,1.0/DI:H,1.0/EX:H,1.0/EC:N,1.0/P:NA,1.0)";

describe("CWSS 1.0", () => {
  it("matches MITRE's business-critical application example", () => {
    const result = calculateCwss10(BUSINESS_CRITICAL_VECTOR);

    expect(result.score).toBe(92.6);
    expect(result.baseFindingScore).toBe(96);
    expect(result.attackSurfaceScore).toBe(0.965);
    expect(result.environmentalScore).toBe(1);
  });

  it("builds a fully weighted portable vector", () => {
    const parsed = calculateCwss10(BUSINESS_CRITICAL_VECTOR);

    expect(buildCwss10Vector(parsed.metrics)).toContain("TI:H,0.9");
    expect(buildCwss10Vector(parsed.metrics)).toContain("AV:I,1.0");
  });

  it("rejects incomplete and malformed vectors", () => {
    expect(() => calculateCwss10("TI:H,0.9")).toThrow(Cwss10VectorError);
    expect(() =>
      calculateCwss10(BUSINESS_CRITICAL_VECTOR.replace("AV:I", "AV:Z")),
    ).toThrow(/does not accept/);
  });
});
