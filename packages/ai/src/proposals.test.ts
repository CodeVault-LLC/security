import { describe, expect, it } from "vitest";

import { AI_ACTIONS, AI_FORBIDDEN_PATCH_FIELDS, aiAction } from "./actions.js";
import {
  AiOutputError,
  assertPatchAllowed,
  buildProposal,
  extractJson,
  validateOutput,
} from "./proposals.js";
import type { CvssSuggestionOutput, DraftTextOutput } from "./schemas.js";

/**
 * Provider-output handling.
 *
 * The property under test: nothing a model returns can become a change to
 * canonical data unless it parses, validates against the action's schema, and
 * touches only fields that action declared. Everything else is a failed run.
 */

describe("extractJson", () => {
  it("parses a bare JSON object", () => {
    expect(extractJson('{"markdown":"hello"}')).toEqual({ markdown: "hello" });
  });

  it("parses JSON inside a code fence", () => {
    expect(extractJson('```json\n{"markdown":"hello"}\n```')).toEqual({
      markdown: "hello",
    });
  });

  it("parses JSON after a sentence of preamble", () => {
    expect(
      extractJson('Here is the result:\n{"markdown":"hello"}'),
    ).toEqual({ markdown: "hello" });
  });

  it("rejects prose", () => {
    expect(() => extractJson("I think this is a SQL injection.")).toThrow(
      AiOutputError,
    );
  });

  it("rejects empty output", () => {
    expect(() => extractJson("   ")).toThrow(/no output/);
  });
});

describe("validateOutput", () => {
  it("accepts output matching the action's schema", () => {
    const output = validateOutput<DraftTextOutput>("FINDING_DRAFT_SUMMARY", {
      markdown: "An unauthenticated endpoint accepts a crafted template.",
      sourceIds: ["EVID-000001"],
      uncertainties: [],
      rationale: "Drawn from the reproduction capture.",
    });

    expect(output.markdown).toContain("unauthenticated");
  });

  it("rejects output missing a required field", () => {
    expect(() =>
      validateOutput("FINDING_DRAFT_SUMMARY", { markdown: "text" }),
    ).toThrow(AiOutputError);
  });

  it("rejects output of the wrong shape entirely", () => {
    expect(() =>
      validateOutput("FINDING_SUGGEST_CWE", { markdown: "not a cwe list" }),
    ).toThrow(AiOutputError);
  });

  it("rejects a malformed CWE identifier", () => {
    expect(() =>
      validateOutput("FINDING_SUGGEST_CWE", {
        candidates: [
          {
            cweId: "SQL injection",
            name: "SQL Injection",
            confidence: "HIGH",
            reasoning: "It is one.",
          },
        ],
        rationale: "…",
      }),
    ).toThrow(AiOutputError);
  });
});

describe("CVSS suggestions", () => {
  const output: CvssSuggestionOutput = {
    metrics: [
      {
        metric: "AV",
        value: "N",
        confidence: "HIGH",
        reasoning: "Reachable over the network.",
        sourceIds: ["EVID-000002"],
      },
      {
        metric: "PR",
        value: "N",
        confidence: "HIGH",
        reasoning: "No authentication is required.",
        sourceIds: [],
      },
    ],
    unknownMetrics: ["SC", "SI", "SA"],
    rationale: "Based on the recorded capture.",
  };

  it("has no schema field a model could put a score in", () => {
    const schema = aiAction("FINDING_SUGGEST_CVSS40").outputSchema as {
      properties?: Record<string, unknown>;
    };

    expect(Object.keys(schema.properties ?? {})).not.toContain("score");
    expect(Object.keys(schema.properties ?? {})).not.toContain("vector");
  });

  it("produces a patch of metrics only", () => {
    const proposal = buildProposal("FINDING_SUGGEST_CVSS40", output);

    expect(proposal).not.toBeNull();
    expect(Object.keys(proposal?.patch ?? {}).sort()).toEqual([
      "metrics",
      "reasoningMarkdown",
    ]);
    expect(proposal?.patch.metrics).toEqual({ AV: "N", PR: "N" });
  });

  it("records the metrics the model could not establish", () => {
    const proposal = buildProposal("FINDING_SUGGEST_CVSS40", output);

    expect(proposal?.rationaleMarkdown).toContain("SC");
  });
});

describe("patch restrictions", () => {
  it("refuses fields the action did not declare", () => {
    expect(() =>
      assertPatchAllowed(aiAction("FINDING_DRAFT_SUMMARY"), {
        summaryMarkdown: "fine",
        title: "not this action's business",
      }),
    ).toThrow(/may not change "title"/);
  });

  it.each(AI_FORBIDDEN_PATCH_FIELDS)(
    "refuses to let AI change %s under any action",
    (field) => {
      for (const definition of Object.values(AI_ACTIONS)) {
        expect(() =>
          assertPatchAllowed(definition, { [field]: "anything" }),
        ).toThrow(AiOutputError);
      }
    },
  );

  it("never lets AI record a prior-art conclusion", () => {
    expect(AI_FORBIDDEN_PATCH_FIELDS).toContain("priorArtState");
  });

  it("never lets AI approve, publish or change visibility", () => {
    expect(AI_FORBIDDEN_PATCH_FIELDS).toContain("visibility");
    expect(AI_FORBIDDEN_PATCH_FIELDS).toContain("approvedBy");
    expect(AI_FORBIDDEN_PATCH_FIELDS).toContain("reviewState");
    expect(AI_FORBIDDEN_PATCH_FIELDS).toContain("status");
  });
});

describe("review actions", () => {
  const reviewActions = [
    "FINDING_FACT_CHECK",
    "FINDING_PRIOR_ART_SYNTHESIS",
    "REPORT_CONSISTENCY_REVIEW",
    "REPORT_LEAK_REVIEW",
    "AFFECTED_VERSION_REVIEW",
  ] as const;

  it.each(reviewActions)("%s produces no patch at all", (action) => {
    expect(aiAction(action).producesPatch).toBe(false);
    expect(aiAction(action).allowedPatchFields).toHaveLength(0);
  });
});

describe("the action registry", () => {
  it("gives every action an output schema", () => {
    for (const definition of Object.values(AI_ACTIONS)) {
      expect(definition.outputSchema).toBeDefined();
    }
  });

  it("keeps report actions bound to the report's audience", () => {
    for (const definition of Object.values(AI_ACTIONS)) {
      if (definition.targetType === "REPORT_SECTION") {
        expect(definition.contextAudience).toBe("INHERIT_FROM_REPORT");
      }
    }
  });
});
