import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import { IntakeCitation, IntakeDraft } from "./intake.js";

const SHA = "a".repeat(64);

describe("intake contracts", () => {
  it("accepts a bounded manual finding draft", () => {
    expect(
      Value.Check(IntakeDraft, {
        title: "Unauthenticated export injection",
        summaryMarkdown: "A crafted export request reaches the query layer.",
        suggestedCweIds: ["CWE-89"],
        affectedVersions: [],
      }),
    ).toBe(true);
  });

  it("rejects an empty title and unknown draft fields", () => {
    expect(
      Value.Check(IntakeDraft, {
        title: "",
        suggestedCweIds: [],
        affectedVersions: [],
      }),
    ).toBe(false);
    expect(
      Value.Check(IntakeDraft, {
        title: "A valid finding title",
        suggestedCweIds: [],
        affectedVersions: [],
        validationState: "CONFIRMED",
      }),
    ).toBe(false);
  });

  it("requires file citations to carry a digest and bounded line range", () => {
    expect(
      Value.Check(IntakeCitation, {
        kind: "FILE",
        path: "findings/report.md",
        sha256: SHA,
        startLine: 12,
        endLine: 20,
      }),
    ).toBe(true);
    expect(
      Value.Check(IntakeCitation, {
        kind: "FILE",
        path: "findings/report.md",
        startLine: 1,
        endLine: 2,
      }),
    ).toBe(false);
  });
});
