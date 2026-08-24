import { describe, expect, it } from "vitest";

import {
  highestSeverity,
  isSeverityRating,
  severityFromScore,
} from "./severity.js";

describe("severityFromScore", () => {
  it.each([
    [0, "NONE"],
    [0.1, "LOW"],
    [3.9, "LOW"],
    [4, "MEDIUM"],
    [6.9, "MEDIUM"],
    [7, "HIGH"],
    [8.9, "HIGH"],
    [9, "CRITICAL"],
    [10, "CRITICAL"],
  ] as const)("maps %s to %s", (score, expected) => {
    expect(severityFromScore(score)).toBe(expected);
  });

  it.each([-0.1, 10.1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid score of %s",
    (score) => {
      expect(() => severityFromScore(score)).toThrow(RangeError);
    },
  );
});

describe("severity helpers", () => {
  it("recognizes exact ratings", () => {
    expect(isSeverityRating("HIGH")).toBe(true);
    expect(isSeverityRating("high")).toBe(false);
    expect(isSeverityRating(9)).toBe(false);
  });

  it("selects the highest rating and handles an empty list", () => {
    expect(highestSeverity(["LOW", "CRITICAL", "HIGH"])).toBe("CRITICAL");
    expect(highestSeverity([])).toBe("NONE");
  });
});
