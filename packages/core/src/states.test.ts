import { describe, expect, it } from "vitest";

import {
  canTransitionDisclosure,
  canTransitionReview,
  canTransitionValidation,
  isHumanOnlyPriorArtState,
  isSectionEditable,
  PRIOR_ART_STATES,
} from "./states.js";

describe("validation transitions", () => {
  it("walks the normal research path", () => {
    expect(canTransitionValidation("DRAFT", "REPRODUCED")).toBe(true);
    expect(canTransitionValidation("REPRODUCED", "PEER_REVIEWED")).toBe(true);
    expect(canTransitionValidation("PEER_REVIEWED", "CONFIRMED")).toBe(true);
  });

  it("refuses to confirm a finding that was never reproduced", () => {
    expect(canTransitionValidation("DRAFT", "CONFIRMED")).toBe(false);
    expect(canTransitionValidation("INVALID", "CONFIRMED")).toBe(false);
  });

  it("allows a confirmed finding to be disputed", () => {
    expect(canTransitionValidation("CONFIRMED", "DISPUTED")).toBe(true);
  });

  it("treats a no-op transition as valid", () => {
    expect(canTransitionValidation("CONFIRMED", "CONFIRMED")).toBe(true);
  });
});

describe("disclosure transitions", () => {
  it("follows the coordinated-disclosure path", () => {
    expect(canTransitionDisclosure("PRIVATE", "CONTACT_PREPARED")).toBe(true);
    expect(
      canTransitionDisclosure("CONTACT_PREPARED", "VENDOR_CONTACTED"),
    ).toBe(true);
    expect(canTransitionDisclosure("VENDOR_CONTACTED", "ACKNOWLEDGED")).toBe(
      true,
    );
    expect(canTransitionDisclosure("COORDINATING", "EMBARGOED")).toBe(true);
    expect(canTransitionDisclosure("EMBARGOED", "PUBLIC")).toBe(true);
  });

  it("treats PUBLIC as terminal", () => {
    expect(canTransitionDisclosure("PUBLIC", "EMBARGOED")).toBe(false);
    expect(canTransitionDisclosure("PUBLIC", "PRIVATE")).toBe(false);
  });

  it("refuses to skip straight from private to embargoed", () => {
    expect(canTransitionDisclosure("PRIVATE", "EMBARGOED")).toBe(false);
  });
});

describe("prior-art states", () => {
  it("reserves HUMAN_CONFIRMED_NOVEL for people", () => {
    expect(isHumanOnlyPriorArtState("HUMAN_CONFIRMED_NOVEL")).toBe(true);
  });

  it("leaves every other conclusion machine-assignable", () => {
    const machineAssignable = PRIOR_ART_STATES.filter(
      (state) => state !== "HUMAN_CONFIRMED_NOVEL",
    );

    for (const state of machineAssignable) {
      expect(isHumanOnlyPriorArtState(state)).toBe(false);
    }
  });
});

describe("report section review transitions", () => {
  it("allows an AI draft to be edited and approved", () => {
    expect(canTransitionReview("AI_DRAFT", "RESEARCHER_EDITED")).toBe(true);
    expect(canTransitionReview("RESEARCHER_EDITED", "APPROVED")).toBe(true);
  });

  it("refuses to approve an unreviewed AI draft directly", () => {
    expect(canTransitionReview("AI_DRAFT", "APPROVED")).toBe(false);
  });

  it("only reopens a locked section through review", () => {
    expect(canTransitionReview("LOCKED", "NEEDS_REVIEW")).toBe(true);
    expect(canTransitionReview("LOCKED", "RESEARCHER_EDITED")).toBe(false);
    expect(isSectionEditable("LOCKED")).toBe(false);
    expect(isSectionEditable("APPROVED")).toBe(true);
  });
});
