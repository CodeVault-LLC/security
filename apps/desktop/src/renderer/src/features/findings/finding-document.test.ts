import { describe, expect, it } from "vitest";

import {
  buildFindingDocument,
  parseFindingDocument,
} from "./finding-document.js";

describe("finding document", () => {
  it("round-trips every report section through one Markdown document", () => {
    const content = {
      summaryMarkdown: "A concise summary.",
      technicalMarkdown: "Technical detail with a ## nested heading.",
      preconditionsMarkdown: "Authenticated access.",
      attackPathMarkdown: "1. Enter\n2. Escalate",
      impactMarkdown: "Sensitive data is exposed.",
      reproductionMarkdown: "`curl example.test`",
      remediationMarkdown: "Validate the caller.",
      researcherNotesMarkdown: "Internal note.",
    };

    const document = buildFindingDocument(content);

    expect(document).toContain("## Executive summary");
    expect(document).toContain("## Researcher notes (internal)");
    expect(parseFindingDocument(document)).toEqual(content);
  });

  it("keeps text before the first heading in the summary", () => {
    const parsed = parseFindingDocument(
      "Opening context\n\n## Technical description\n\nTechnical detail",
    );

    expect(parsed.summaryMarkdown).toBe("Opening context");
    expect(parsed.technicalMarkdown).toBe("Technical detail");
  });
});
