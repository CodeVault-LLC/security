import { describe, expect, it } from "vitest";

import { buildReportMarkdown } from "./report-markdown.js";

describe("buildReportMarkdown", () => {
  it("creates a portable report with provenance and ordered sections", () => {
    const markdown = buildReportMarkdown({
      title: "Vendor advisory",
      reference: "REP-2026-0042",
      audience: "VENDOR",
      tlp: "TLP:AMBER",
      caseReference: "CASE-2026-0007",
      generatedAt: "2026-08-26",
      organisation: "CodeVault Labs",
      authorName: "Ada Researcher",
      templateVersion: "vendor-v1",
      notice: "Embargoed until 2026-09-01.",
      sections: [
        { title: "Summary", markdown: "A concise summary." },
        { title: "Impact", markdown: "Systems may be unavailable." },
      ],
    });

    expect(markdown).toContain("# Vendor advisory");
    expect(markdown).toContain("| Reference | REP-2026-0042 |");
    expect(markdown).toContain("| TLP | TLP:AMBER |");
    expect(markdown).toContain("> Embargoed until 2026-09-01.");
    expect(markdown.indexOf("## Summary")).toBeLessThan(
      markdown.indexOf("## Impact"),
    );
    expect(markdown.endsWith("\n")).toBe(true);
  });
});
