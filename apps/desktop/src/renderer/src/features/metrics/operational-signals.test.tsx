import { describe, expect, it } from "vitest";

import type { MetricsResponse } from "@codevault/contracts";

import { buildOperationalSignals } from "./operational-signals.js";

const metrics: MetricsResponse = {
  window: "90d",
  bucket: "week",
  totals: {
    findings: 20,
    confirmed: 8,
    published: 6,
    openCases: 3,
    criticalsUnfixed: 3,
    awaitingReview: 5,
    overdueVendorResponses: 2,
    medianAcknowledgementDays: 4,
  },
  severity: {
    critical: 4,
    high: 5,
    medium: 6,
    low: 3,
    none: 1,
    unscored: 1,
  },
  validation: [],
  remediation: [],
  disclosure: [],
  externalId: [],
  priorArt: [],
  coverage: {
    total: 20,
    scored: 20,
    weaknessClassified: 10,
    assetLinked: 10,
    evidenceLinked: 10,
    affectedRangeRecorded: 10,
    priorArtChecked: 0,
  },
  age: {
    under30Days: 4,
    from30To89Days: 3,
    from90To179Days: 2,
    atLeast180Days: 1,
  },
  trend: [
    { bucketStart: "2026-07-01T00:00:00.000Z", opened: 6, published: 3 },
    { bucketStart: "2026-07-08T00:00:00.000Z", opened: 4, published: 2 },
  ],
  stages: [
    {
      stage: "CONTACT_TO_ACKNOWLEDGEMENT",
      p50Days: 4,
      p90Days: 14,
      sampleSize: 12,
    },
  ],
  cwe: [],
  topAssets: [],
  generatedAt: "2026-08-27T08:00:00.000Z",
};

describe("buildOperationalSignals", () => {
  it("derives transparent workflow ratios and percentile spread", () => {
    const signals = buildOperationalSignals(metrics);

    expect(signals.map((signal) => [signal.label, signal.value])).toEqual([
      ["Publication to intake", "50%"],
      ["Long-lived backlog", "30%"],
      ["Research completeness", "50%"],
      ["Critical remediation gap", "75%"],
      ["Review queue share", "25%"],
      ["Acknowledgement variability", "10d"],
    ]);
    expect(signals.at(-1)?.detail).toContain("across 12 cases");
  });
});
