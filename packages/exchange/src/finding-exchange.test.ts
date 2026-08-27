import { describe, expect, it } from "vitest";

import {
  exportFindingsCsv,
  exportFindingsJson,
  exportFindingsSarif,
  parseFindingsCsv,
  parseFindingsJson,
  parseFindingsSarif,
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

  it("rejects characters after a quoted CSV field", () => {
    expect(() =>
      parseFindingsCsv('title,visibility\n"Quoted finding"junk,PUBLIC'),
    ).toThrow("unexpected character after a closing quote");
  });

  it("rejects duplicate normalized CSV columns", () => {
    expect(() =>
      parseFindingsCsv(
        "title, visibility ,Visibility\nAmbiguous finding,INTERNAL,PUBLIC",
      ),
    ).toThrow('repeats the "visibility" column');
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

  it("imports SARIF results with rules, CWEs, and source locations", () => {
    const sarif = JSON.stringify({
      version: "2.1.0",
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      runs: [
        {
          tool: {
            driver: {
              name: "Example scanner",
              rules: [
                {
                  id: "sql-injection",
                  shortDescription: { text: "SQL injection rule" },
                  properties: { tags: ["security", "CWE-89"] },
                },
              ],
            },
          },
          results: [
            {
              ruleId: "sql-injection",
              message: { text: "SQL injection in query builder" },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: "src/query.ts" },
                    region: { startLine: 42, startColumn: 7 },
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(parseFindingsSarif(sarif)).toEqual([
      {
        title: "SQL injection in query builder",
        summaryMarkdown: "SQL injection rule",
        technicalMarkdown: "Location: `src/query.ts:42:7`",
        cweIds: ["CWE-89"],
        visibility: "INTERNAL",
      },
    ]);
  });

  it("imports a multiline SARIF message as a title and summary", () => {
    const title =
      "Expensive AI routes lack per-client quotas, rate limits, and concurrency controls";
    const summary =
      "After authentication, generation requests can start provider calls without tenant limits. ".repeat(
        3,
      );
    const sarif = JSON.stringify({
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "Codex Security",
              rules: [
                {
                  id: "resource-exhaustion.ai-routes-no-tenant-limits",
                  shortDescription: {
                    text: "Resource exhaustion: AI routes have no tenant limits",
                  },
                },
              ],
            },
          },
          results: [
            {
              ruleId: "resource-exhaustion.ai-routes-no-tenant-limits",
              message: { text: `${title}\n\n${summary}` },
            },
          ],
        },
      ],
    });

    expect(parseFindingsSarif(sarif)).toEqual([
      {
        title,
        summaryMarkdown: summary.trim(),
        cweIds: [],
        visibility: "INTERNAL",
      },
    ]);
  });

  it("round-trips CodeVault fields through SARIF properties", () => {
    expect(parseFindingsSarif(exportFindingsSarif(findings))).toEqual(findings);
  });

  it("rejects unsupported SARIF versions", () => {
    expect(() =>
      parseFindingsSarif(JSON.stringify({ version: "2.0.0", runs: [] })),
    ).toThrow("SARIF version is not supported");
  });
});
