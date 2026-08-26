import { describe, expect, it } from "vitest";

import type { FindingDetail } from "@codevault/contracts";

import { buildPublicAdvisory } from "./public-advisory.js";

describe("public advisory", () => {
  it("excludes private research fields and non-public references", () => {
    const finding = {
      ref: "FIND-001",
      title: "Authentication bypass",
      summaryMarkdown: "Public summary.",
      impactMarkdown: "Public impact.",
      remediationMarkdown: "Upgrade to 1.2.3.",
      technicalMarkdown: "PRIVATE TECHNICAL DETAIL",
      reproductionMarkdown: "PRIVATE REPRODUCTION",
      researcherNotesMarkdown: "PRIVATE NOTES",
      severity: "HIGH",
      score: 8.1,
      assets: [],
      affectedRanges: [],
      identifiers: [],
      references: [
        {
          title: "Public bulletin",
          url: "https://example.test/public",
          visibility: "PUBLIC",
        },
        {
          title: "Private tracker",
          url: "https://example.test/private",
          visibility: "INTERNAL",
        },
        {
          title: "Unsafe public link",
          url: "javascript:alert(1)",
          visibility: "PUBLIC",
        },
      ],
    } as unknown as FindingDetail;

    const advisory = buildPublicAdvisory({
      finding,
      generatedAt: "2026-08-26T12:00:00.000Z",
    });
    expect(advisory).toContain("Public summary");
    expect(advisory).toContain("Public bulletin");
    expect(advisory).not.toContain("PRIVATE");
    expect(advisory).not.toContain("Private tracker");
    expect(advisory).not.toContain("javascript:");
  });
});
