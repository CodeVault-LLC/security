import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SEVERITY_RATINGS, TLP_LABELS } from "@codevault/standards";
import { PRIOR_ART_STATES, VALIDATION_STATES } from "@codevault/core";

import {
  humaniseState,
  PriorArtBadge,
  SeverityBadge,
  StateBadge,
  TlpBadge,
  VisibilityBadge,
} from "./badges.js";

/**
 * Badge tests.
 *
 * The property that matters is that meaning never depends on colour: every
 * badge must render its state as text, in every state, so a greyscale print or
 * a screenshot in a vendor email still says what it means.
 */

describe("SeverityBadge", () => {
  it.each(SEVERITY_RATINGS)("renders %s as text", (severity) => {
    render(<SeverityBadge severity={severity} />);

    expect(screen.getByText(severity)).toBeInTheDocument();
  });

  it("shows the score alongside the rating", () => {
    render(<SeverityBadge severity="HIGH" score={8.5} />);

    expect(screen.getByText("8.5")).toBeInTheDocument();
  });

  it("says so explicitly when nothing has been scored", () => {
    render(<SeverityBadge severity={null} />);

    expect(screen.getByText("Unscored")).toBeInTheDocument();
  });
});

describe("TlpBadge", () => {
  it.each(TLP_LABELS)("renders %s with its sharing rule", (label) => {
    render(<TlpBadge label={label} />);

    const badge = screen.getByText(label);

    expect(badge).toBeInTheDocument();
    expect(badge.getAttribute("title")).toMatch(/\w/);
  });
});

describe("StateBadge", () => {
  it.each(VALIDATION_STATES)("renders validation state %s", (state) => {
    render(<StateBadge kind="validation" state={state} />);

    expect(screen.getByText(humaniseState(state))).toBeInTheDocument();
  });
});

describe("PriorArtBadge", () => {
  it.each(PRIOR_ART_STATES)("renders %s with an explanation", (state) => {
    render(<PriorArtBadge state={state} />);

    expect(screen.getByText(humaniseState(state))).toBeInTheDocument();
  });

  it("explains that no prior art found is date-bound, not absolute", () => {
    render(<PriorArtBadge state="NO_PRIOR_ART_FOUND" />);

    const badge = screen.getByText("No prior art found");

    expect(badge.getAttribute("title")).toContain("checked");
    expect(badge.getAttribute("title")).toContain("date");
  });

  it("attributes a novel conclusion to a person", () => {
    render(<PriorArtBadge state="HUMAN_CONFIRMED_NOVEL" />);

    expect(
      screen.getByText("Human confirmed novel").getAttribute("title"),
    ).toContain("researcher");
  });
});

describe("VisibilityBadge", () => {
  it("warns that internal content never leaves internal reports", () => {
    render(<VisibilityBadge visibility="INTERNAL" />);

    expect(screen.getByText("Internal").getAttribute("title")).toContain(
      "Never",
    );
  });
});

describe("humaniseState", () => {
  it("turns screaming snake case into a sentence", () => {
    expect(humaniseState("PEER_REVIEWED")).toBe("Peer reviewed");
    expect(humaniseState("FIX_VERIFIED")).toBe("Fix verified");
  });
});
