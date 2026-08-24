import { describe, expect, it } from "vitest";

import { buildIntelligenceScores } from "./intelligence-refresh.js";

describe("intelligence score aggregation", () => {
  it("keeps the highest EPSS signal across every CVE on the finding", () => {
    const scores = buildIntelligenceScores(
      "finding-1",
      ["CVE-2026-1000", "CVE-2026-2000"],
      new Map([
        [
          "CVE-2026-1000",
          {
            cve: "CVE-2026-1000",
            epss: 0.12,
            percentile: 0.7,
            date: "2026-08-20",
          },
        ],
        [
          "CVE-2026-2000",
          {
            cve: "CVE-2026-2000",
            epss: 0.81,
            percentile: 0.98,
            date: "2026-08-21",
          },
        ],
      ]),
      new Set(["CVE-2026-1000"]),
      "2026-08-24T10:00:00.000Z",
    );

    expect(scores).toHaveLength(2);
    expect(scores.find((score) => score.scheme === "EPSS")).toMatchObject({
      score: 0.81,
      metrics: {
        cveId: "CVE-2026-2000",
        percentile: 0.98,
        modelDate: "2026-08-21",
        evaluatedCveIds: ["CVE-2026-1000", "CVE-2026-2000"],
      },
    });
    expect(scores.find((score) => score.scheme === "KEV")).toMatchObject({
      score: 1,
      metrics: {
        listed: true,
        listedCveIds: ["CVE-2026-1000"],
        evaluatedCveIds: ["CVE-2026-1000", "CVE-2026-2000"],
      },
    });
  });

  it("writes an explicit negative KEV fact so an old positive is superseded", () => {
    const scores = buildIntelligenceScores(
      "finding-1",
      ["cve-2026-1000"],
      new Map(),
      new Set(),
      "2026-08-24T10:00:00.000Z",
    );

    expect(scores).toEqual([
      expect.objectContaining({
        scheme: "KEV",
        score: 0,
        metrics: {
          listed: false,
          listedCveIds: [],
          evaluatedCveIds: ["CVE-2026-1000"],
        },
      }),
    ]);
  });

  it("preserves the prior KEV fact when the catalog request failed", () => {
    const scores = buildIntelligenceScores(
      "finding-1",
      ["CVE-2026-1000"],
      new Map(),
      null,
      "2026-08-24T10:00:00.000Z",
    );

    expect(scores).toEqual([]);
  });
});
