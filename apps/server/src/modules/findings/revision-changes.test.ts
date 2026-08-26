import { describe, expect, it } from "vitest";

import { collectFindingRevisionChanges } from "./revision-changes.js";

describe("finding revision audit snapshots", () => {
  it("records every changed field and omits unchanged input", () => {
    expect(
      collectFindingRevisionChanges(
        {
          title: "Original title",
          summaryMarkdown: "Original summary",
          validationState: "DRAFT",
          cweIds: ["CWE-79"],
        },
        {
          title: "Updated title",
          summaryMarkdown: "Original summary",
          validationState: "CONFIRMED",
          cweIds: ["CWE-79", "CWE-80"],
        },
      ),
    ).toEqual({
      before: {
        title: "Original title",
        validationState: "DRAFT",
        cweIds: ["CWE-79"],
      },
      after: {
        title: "Updated title",
        validationState: "CONFIRMED",
        cweIds: ["CWE-79", "CWE-80"],
      },
      stateOnly: false,
    });
  });

  it("recognizes a revision containing only lifecycle state changes", () => {
    expect(
      collectFindingRevisionChanges(
        { remediationState: "UNFIXED", visibility: "INTERNAL" },
        { remediationState: "FIXED", visibility: "VENDOR" },
      ),
    ).toMatchObject({ stateOnly: true });
  });
});
