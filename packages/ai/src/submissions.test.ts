import { describe, expect, it } from "vitest";

import { aiAction } from "./actions.js";
import { buildProposal, validateOutput } from "./proposals.js";

describe("submission AI boundaries", () => {
  it("submission drafting cannot change recipients, route, or crypto", () => {
    const action = aiAction("SUBMISSION_DRAFT_INITIAL");
    expect(action.allowedPatchFields).toEqual(["subject", "bodyMarkdown"]);
    expect(action.allowedPatchFields).not.toContain("to");
    expect(action.allowedPatchFields).not.toContain("cryptoMode");
    expect(action.contextAudience).toBe("VENDOR");
    expect(action.toolPolicy).toBe("NONE");
  });

  it("turns structured initial-draft output into only subject and body", () => {
    const output = validateOutput("SUBMISSION_DRAFT_INITIAL", {
      subject: "Security report for CASE-2026-0001",
      bodyMarkdown: "Hello security team,\n\nPlease find our report attached.",
      sourceRefs: ["CASE-2026-0001", "FIND-2026-0001"],
      rationale: "Kept the disclosure factual and concise.",
    });
    expect(buildProposal("SUBMISSION_DRAFT_INITIAL", output)?.patch).toEqual({
      subject: "Security report for CASE-2026-0001",
      bodyMarkdown: "Hello security team,\n\nPlease find our report attached.",
    });
  });

  it("classification proposes one label and no lifecycle transition", () => {
    const output = validateOutput("SUBMISSION_CLASSIFY_REPLY", {
      rankings: [
        {
          classification: "ACKNOWLEDGEMENT",
          confidence: "HIGH",
          evidence: ["We have received your report"],
        },
      ],
      rationale: "The reply confirms receipt only.",
    });
    expect(buildProposal("SUBMISSION_CLASSIFY_REPLY", output)?.patch).toEqual({
      classification: "ACKNOWLEDGEMENT",
    });
  });
});
