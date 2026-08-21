import { describe, expect, it } from "vitest";

import {
  exportFindingsCsv,
  exportFindingsJson,
  parseFindingsCsv,
  parseFindingsJson,
} from "./finding-exchange.js";

const findings = [
  {
    title: "Formula, quote, and newline",
    summaryMarkdown: 'A cell starts with = and contains "quotes".\nNext line.',
    technicalMarkdown: "=CMD()",
    impactMarkdown: "Impact",
    remediationMarkdown: "Fix",
    cweIds: ["CWE-1236"],
    visibility: "INTERNAL" as const,
  },
];

describe("finding exchange", () => {
  it("round-trips the versioned JSON shape", () => {
    expect(parseFindingsJson(exportFindingsJson(findings))).toEqual(findings);
  });

  it("round-trips RFC 4180 CSV and neutralizes spreadsheet formulas", () => {
    const csv = exportFindingsCsv(findings);

    expect(csv).toContain("'=CMD()");
    expect(parseFindingsCsv(csv)).toEqual([
      { ...findings[0], technicalMarkdown: "'=CMD()" },
    ]);
  });

  it("rejects rows without a title instead of inventing one", () => {
    expect(() => parseFindingsCsv("title,summary\n,missing")).toThrow(
      "Row 2 has no title",
    );
  });

  it("rejects a declared incompatible JSON version", () => {
    expect(() =>
      parseFindingsJson(
        JSON.stringify({
          format: "codevault.findings",
          version: 2,
          findings: [],
        }),
      ),
    ).toThrow("version is not supported");
  });
});
