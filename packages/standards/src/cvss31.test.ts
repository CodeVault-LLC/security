import { describe, expect, it } from "vitest";

import {
  buildCvss31Vector,
  calculateCvss31,
  Cvss31VectorError,
  isValidCvss31Vector,
  parseCvss31Vector,
} from "./cvss31.js";

/**
 * Expected values are the published CVSS v3.1 scores for these vectors. They
 * are stated as constants rather than computed, so a regression in the formula
 * cannot quietly rewrite the expectation along with the implementation.
 */
const PUBLISHED_BASE_SCORES: readonly { vector: string; score: number }[] = [
  { vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", score: 9.8 },
  { vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H", score: 10 },
  { vector: "CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", score: 7.8 },
  { vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N", score: 6.1 },
  { vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N", score: 7.5 },
  { vector: "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N", score: 4.3 },
  { vector: "CVSS:3.1/AV:L/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:H", score: 7.8 },
  { vector: "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:H", score: 5.9 },
  { vector: "CVSS:3.1/AV:P/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N", score: 4.6 },
  { vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N", score: 0 },
];

describe("published base scores", () => {
  it.each(PUBLISHED_BASE_SCORES)(
    "scores $vector as $score",
    ({ vector, score }) => {
      expect(calculateCvss31(vector).baseScore).toBe(score);
    },
  );
});

describe("temporal scoring", () => {
  it("reduces the score for an unproven, officially fixed finding", () => {
    const result = calculateCvss31(
      "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H/E:U/RL:O/RC:C",
    );

    expect(result.baseScore).toBe(9.8);
    expect(result.temporalScore).toBe(8.5);
    expect(result.score).toBe(8.5);
  });

  it("leaves the score untouched when no temporal metric is set", () => {
    const result = calculateCvss31(
      "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
    );

    expect(result.temporalScore).toBe(result.baseScore);
    expect(result.score).toBe(result.baseScore);
  });
});

describe("environmental scoring", () => {
  it("raises the score when confidentiality matters more here", () => {
    const result = calculateCvss31(
      "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N/CR:H",
    );

    expect(result.baseScore).toBe(4.3);
    expect(result.environmentalScore).toBeGreaterThan(result.baseScore);
    expect(result.score).toBe(result.environmentalScore);
  });

  it("lowers the score when the deployment is less exposed", () => {
    const result = calculateCvss31(
      "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H/MAV:P",
    );

    expect(result.environmentalScore).toBeLessThan(result.baseScore);
  });

  it("prefers the environmental score when both are present", () => {
    const result = calculateCvss31(
      "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H/E:U/RL:O/RC:C/MAV:L",
    );

    expect(result.score).toBe(result.environmentalScore);
  });
});

describe("severity bands", () => {
  it("maps scores onto the published qualitative ratings", () => {
    expect(
      calculateCvss31("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H").severity,
    ).toBe("CRITICAL");
    expect(
      calculateCvss31("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N").severity,
    ).toBe("HIGH");
    expect(
      calculateCvss31("CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N").severity,
    ).toBe("MEDIUM");
    expect(
      calculateCvss31("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N").severity,
    ).toBe("NONE");
  });
});

describe("parseCvss31Vector", () => {
  it("rejects a CVSS 4.0 vector", () => {
    expect(() =>
      parseCvss31Vector("CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N"),
    ).toThrow(Cvss31VectorError);
  });

  it("rejects an unknown value", () => {
    expect(() =>
      parseCvss31Vector("CVSS:3.1/AV:Q/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"),
    ).toThrow(/not a valid value/);
  });

  it("rejects an incomplete vector", () => {
    expect(() => parseCvss31Vector("CVSS:3.1/AV:N/AC:L")).toThrow(/mandatory/);
  });

  it("reports validity without throwing", () => {
    expect(
      isValidCvss31Vector("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"),
    ).toBe(true);
    expect(isValidCvss31Vector("CVSS:3.1/nonsense")).toBe(false);
  });
});

describe("buildCvss31Vector", () => {
  it("round-trips a vector with temporal and environmental metrics", () => {
    const original =
      "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H/E:F/RL:W/RC:R/CR:H/MAV:A";

    expect(buildCvss31Vector(parseCvss31Vector(original))).toBe(original);
  });
});
