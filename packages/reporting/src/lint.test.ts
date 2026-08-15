import { describe, expect, it } from "vitest";

import { hasBlockingFindings, lintReport, type LintInput } from "./lint.js";

/**
 * The report linter.
 *
 * The gate between a draft and something that leaves the building. The tests
 * below are written around the failures that actually end embargoes early: an
 * internal capture referenced from a public advisory, a pasted credential, an
 * unreviewed AI draft, and a report whose marking contradicts its audience.
 */

function input(overrides: Partial<LintInput> = {}): LintInput {
  return {
    audience: "PUBLIC",
    tlp: "TLP:CLEAR",
    sections: [],
    requiredSectionTitles: [],
    referencedItems: [],
    scores: [],
    findingCveIds: [],
    hasAffectedVersionConclusion: true,
    ...overrides,
  };
}

function section(
  content: string,
  overrides: Partial<LintInput["sections"][number]> = {},
): LintInput["sections"][number] {
  return {
    id: "section-1",
    key: "summary",
    title: "Summary",
    required: true,
    contentMarkdown: content,
    reviewState: "APPROVED",
    sourceRefs: [],
    ...overrides,
  };
}

describe("visibility violations", () => {
  it("blocks a public report that references internal evidence", () => {
    const result = lintReport(
      input({
        sections: [section("See [evidence:EVID-000001] for the capture.")],
        referencedItems: [
          {
            reference: "EVID-000001",
            kind: "evidence",
            visibility: "INTERNAL",
          },
        ],
      }),
    );

    const violation = result.findings.find(
      (finding) => finding.ruleId === "visibility-violation",
    );

    expect(violation?.severity).toBe("BLOCKING");
    expect(hasBlockingFindings(result)).toBe(true);
  });

  it("blocks a public report that references vendor-only evidence", () => {
    const result = lintReport(
      input({
        sections: [section("[evidence:EVID-000002]")],
        referencedItems: [
          { reference: "EVID-000002", kind: "evidence", visibility: "VENDOR" },
        ],
      }),
    );

    expect(result.blocking).toBe(true);
  });

  it("allows a vendor report to reference vendor evidence", () => {
    const result = lintReport(
      input({
        audience: "VENDOR",
        tlp: "TLP:AMBER",
        sections: [section("[evidence:EVID-000002]")],
        referencedItems: [
          { reference: "EVID-000002", kind: "evidence", visibility: "VENDOR" },
        ],
      }),
    );

    expect(result.blocking).toBe(false);
  });

  it("blocks an unresolved directive", () => {
    const result = lintReport(
      input({ sections: [section("[evidence:EVID-999999]")] }),
    );

    expect(
      result.findings.some(
        (finding) => finding.ruleId === "unresolved-directive",
      ),
    ).toBe(true);
    expect(result.blocking).toBe(true);
  });

  it("blocks a directive whose kind does not match the thing it names", () => {
    // The renderer looks the reference up in the table for its kind, so this
    // would leave a hole in the page if the linter matched on reference alone.
    const result = lintReport(
      input({
        sections: [section("[evidence:FIND-2026-0001]")],
        referencedItems: [
          {
            reference: "FIND-2026-0001",
            kind: "finding",
            visibility: "PUBLIC",
          },
        ],
      }),
    );

    expect(
      result.findings.some(
        (finding) => finding.ruleId === "unresolved-directive",
      ),
    ).toBe(true);
  });

  it("resolves a score directive against the case's approved schemes", () => {
    const result = lintReport(
      input({
        sections: [section("[score:CVSS40]")],
        referencedItems: [
          { reference: "CVSS40", kind: "score", visibility: "PUBLIC" },
        ],
        scores: [
          {
            scheme: "CVSS40",
            vector:
              "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N",
            score: 9.3,
          },
        ],
      }),
    );

    expect(
      result.findings.some(
        (finding) => finding.ruleId === "unresolved-directive",
      ),
    ).toBe(false);
  });

  it("blocks an unknown directive", () => {
    const result = lintReport(
      input({ sections: [section("[exfiltrate:everything]")] }),
    );

    expect(
      result.findings.some((finding) => finding.ruleId === "unknown-directive"),
    ).toBe(true);
  });

  it("blocks a proof of concept that is not approved for the audience", () => {
    const result = lintReport(
      input({
        sections: [section("[poc:POC-000001]")],
        referencedItems: [
          {
            reference: "POC-000001",
            kind: "poc",
            visibility: "PUBLIC",
            approvedForAudience: false,
          },
        ],
      }),
    );

    expect(
      result.findings.some((finding) => finding.ruleId === "poc-not-approved"),
    ).toBe(true);
  });
});

describe("credential detection", () => {
  const credentials: Array<[string, string]> = [
    ["an AWS key", "Use AKIAIOSFODNN7EXAMPLE to reproduce."],
    ["a GitHub token", "export TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
    ["a Slack token", "xoxb-1234567890-abcdefghijkl"],
    ["a private key", "-----BEGIN RSA PRIVATE KEY-----"],
    [
      "a bearer token",
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
    ],
    ["an inline password", "password=hunter2hunter2"],
  ];

  it.each(credentials)("blocks %s in a public report", (_label, content) => {
    const result = lintReport(input({ sections: [section(content)] }));

    expect(
      result.findings.some((finding) =>
        finding.ruleId.startsWith("credential:"),
      ),
    ).toBe(true);
    expect(result.blocking).toBe(true);
  });

  it("reports a credential in an internal report without blocking it", () => {
    const result = lintReport(
      input({
        audience: "INTERNAL",
        tlp: "TLP:RED",
        sections: [section("password=hunter2hunter2")],
      }),
    );

    const finding = result.findings.find((item) =>
      item.ruleId.startsWith("credential:"),
    );

    expect(finding?.severity).toBe("ERROR");
    expect(result.blocking).toBe(false);
  });
});

describe("public-report hygiene", () => {
  it("flags a private address", () => {
    const result = lintReport(
      input({ sections: [section("Reproduced against 192.168.1.50.")] }),
    );

    expect(
      result.findings.some(
        (finding) => finding.ruleId === "private-address-in-public",
      ),
    ).toBe(true);
  });

  it("respects an explicit allow-list for a private address", () => {
    const result = lintReport(
      input({
        sections: [section("Reproduced against 192.168.1.50.")],
        allowedPrivateAddresses: ["192.168.1.50"],
      }),
    );

    expect(
      result.findings.some(
        (finding) => finding.ruleId === "private-address-in-public",
      ),
    ).toBe(false);
  });

  it("flags an internal hostname", () => {
    const result = lintReport(
      input({ sections: [section("Tested on build01.corp.")] }),
    );

    expect(
      result.findings.some(
        (finding) => finding.ruleId === "internal-hostname-in-public",
      ),
    ).toBe(true);
  });

  it("blocks TLP:RED content quoted into a public report", () => {
    const result = lintReport(
      input({ sections: [section("From the TLP:RED briefing:")] }),
    );

    const finding = result.findings.find(
      (item) => item.ruleId === "restricted-tlp-in-public",
    );

    expect(finding?.severity).toBe("BLOCKING");
  });

  it("flags an internal filename", () => {
    const result = lintReport(
      input({ sections: [section("See internal-notes.md for detail.")] }),
    );

    expect(
      result.findings.some(
        (finding) => finding.ruleId === "internal-filename-in-public",
      ),
    ).toBe(true);
  });
});

describe("structure and review state", () => {
  it("blocks a missing required section", () => {
    const result = lintReport(
      input({ requiredSectionTitles: ["Affected Versions"] }),
    );

    expect(
      result.findings.some(
        (finding) => finding.ruleId === "required-section-missing",
      ),
    ).toBe(true);
    expect(result.blocking).toBe(true);
  });

  it("blocks an empty required section", () => {
    const result = lintReport(
      input({
        requiredSectionTitles: ["Summary"],
        sections: [section("   ")],
      }),
    );

    expect(
      result.findings.some(
        (finding) => finding.ruleId === "required-section-empty",
      ),
    ).toBe(true);
  });

  it("blocks an unreviewed AI draft in a public report", () => {
    const result = lintReport(
      input({
        sections: [section("Drafted by a model.", { reviewState: "AI_DRAFT" })],
      }),
    );

    const finding = result.findings.find(
      (item) => item.ruleId === "unapproved-ai-section",
    );

    expect(finding?.severity).toBe("BLOCKING");
  });

  it("reports a section whose source facts have changed", () => {
    const result = lintReport(
      input({
        sections: [
          section("Approved earlier.", { reviewState: "NEEDS_REVIEW" }),
        ],
      }),
    );

    expect(
      result.findings.some(
        (finding) => finding.ruleId === "stale-approved-section",
      ),
    ).toBe(true);
  });
});

describe("consistency checks", () => {
  it("blocks a TLP marking that contradicts the audience", () => {
    const result = lintReport(input({ audience: "PUBLIC", tlp: "TLP:RED" }));

    const finding = result.findings.find(
      (item) => item.ruleId === "tlp-audience-mismatch",
    );

    expect(finding?.severity).toBe("BLOCKING");
  });

  it("reports a missing affected-version conclusion", () => {
    const result = lintReport(input({ hasAffectedVersionConclusion: false }));

    expect(
      result.findings.some(
        (finding) => finding.ruleId === "missing-affected-versions",
      ),
    ).toBe(true);
  });

  it("reports severity discussed without an approved vector", () => {
    const result = lintReport(
      input({ sections: [section("The CVSS score is 9.8.")] }),
    );

    expect(
      result.findings.some(
        (finding) => finding.ruleId === "score-without-vector",
      ),
    ).toBe(true);
  });

  it("reports a vector with no computed score", () => {
    const result = lintReport(
      input({
        scores: [{ scheme: "CVSS40", vector: "CVSS:4.0/AV:N", score: null }],
      }),
    );

    expect(
      result.findings.some(
        (finding) => finding.ruleId === "vector-without-score",
      ),
    ).toBe(true);
  });

  it("reports a CVE in the text that no finding records", () => {
    const result = lintReport(
      input({
        sections: [section("This is tracked as CVE-2026-11111.")],
        findingCveIds: ["CVE-2026-22222"],
      }),
    );

    expect(
      result.findings.some((finding) => finding.ruleId === "cve-mismatch"),
    ).toBe(true);
  });

  it("notes a vendor statement so it is not read as verified fact", () => {
    const result = lintReport(
      input({
        sections: [section("The vendor confirms the fix is complete.")],
      }),
    );

    const finding = result.findings.find(
      (item) => item.ruleId === "vendor-claim-attribution",
    );

    expect(finding?.severity).toBe("INFO");
  });
});

describe("a clean report", () => {
  it("produces nothing blocking", () => {
    const result = lintReport(
      input({
        requiredSectionTitles: ["Summary"],
        sections: [
          section(
            "A template parameter is evaluated server-side, allowing an " +
              "unauthenticated attacker to execute code. See [evidence:EVID-000003].",
          ),
        ],
        referencedItems: [
          { reference: "EVID-000003", kind: "evidence", visibility: "PUBLIC" },
        ],
        scores: [
          {
            scheme: "CVSS40",
            vector:
              "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N",
            score: 9.3,
          },
        ],
      }),
    );

    expect(result.blocking).toBe(false);
    expect(hasBlockingFindings(result)).toBe(false);
  });
});
