import { describe, expect, it } from "vitest";

import {
  findingRevisionChanges,
  formatRevisionValue,
} from "./finding-revision-diff.js";

describe("finding revision comparison", () => {
  it("orders known fields, labels them, and ignores equal values", () => {
    expect(
      findingRevisionChanges(
        {
          validationState: "DRAFT",
          title: "Old title",
          summaryMarkdown: "Same summary",
        },
        {
          validationState: "CONFIRMED",
          title: "New title",
          summaryMarkdown: "Same summary",
        },
      ),
    ).toEqual([
      {
        field: "title",
        label: "Title",
        before: "Old title",
        after: "New title",
        longForm: false,
      },
      {
        field: "validationState",
        label: "Validation state",
        before: "DRAFT",
        after: "CONFIRMED",
        longForm: false,
      },
    ]);
  });

  it("marks Markdown fields as long-form and formats empty and array values", () => {
    expect(
      findingRevisionChanges(
        { technicalMarkdown: null },
        { technicalMarkdown: "## Reproduction" },
      )[0],
    ).toMatchObject({ label: "Technical description", longForm: true });
    expect(formatRevisionValue(null)).toBe("Not set");
    expect(formatRevisionValue("  ")).toBe("Empty");
    expect(formatRevisionValue(["CWE-79", "CWE-80"])).toBe("CWE-79, CWE-80");
  });
});
