import { describe, expect, it } from "vitest";

import {
  applyFindingView,
  matchingFindingView,
} from "./finding-filter-views.js";

describe("finding triage views", () => {
  it("applies a view as a complete filter set", () => {
    expect(applyFindingView("unfixed-critical")).toEqual({
      validationState: "",
      remediationState: "UNFIXED",
      disclosureState: "",
      priorArtState: "",
      severity: "CRITICAL",
    });
  });

  it("recognizes a matching filter set", () => {
    expect(
      matchingFindingView({
        validationState: "CONFIRMED",
        remediationState: "",
        disclosureState: "CONTACT_PREPARED",
        priorArtState: "",
        severity: "",
      }),
    ).toBe("ready-for-vendor");
  });

  it("treats manually adjusted filters as a custom view", () => {
    expect(
      matchingFindingView({
        validationState: "CONFIRMED",
        remediationState: "FIXED",
        disclosureState: "CONTACT_PREPARED",
        priorArtState: "",
        severity: "",
      }),
    ).toBeNull();
  });
});
