import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  CONTENT_VISIBILITIES,
  DISCLOSURE_STATES,
  PRIOR_ART_STATES,
  REMEDIATION_STATES,
  VALIDATION_STATES,
} from "@codevault/core";
import { SEVERITY_RATINGS } from "@codevault/standards";

import { Select } from "./overlays.js";
import {
  severitySelectOptions,
  stateSelectOptions,
  visibilitySelectOptions,
} from "./selects.js";

/**
 * Picker tests.
 *
 * Two properties matter. A picker must never show a researcher the raw
 * `SCREAMING_CASE` the database stores, and it must never rely on colour to
 * say what an option is — every option carries its words, and the tone only
 * reinforces them.
 */

const KINDS = [
  ["validation", VALIDATION_STATES],
  ["remediation", REMEDIATION_STATES],
  ["disclosure", DISCLOSURE_STATES],
  ["priorArt", PRIOR_ART_STATES],
] as const;

describe("stateSelectOptions", () => {
  it.each(KINDS)("writes every %s state as words", (kind, states) => {
    for (const option of stateSelectOptions(kind, states)) {
      expect(option.label).not.toMatch(/_/);
      expect(option.label).toMatch(/^[A-Z]/);
      expect(option.icon).toBeDefined();
    }
  });

  it("keeps one option per state, in the vocabulary's own order", () => {
    expect(
      stateSelectOptions("validation", VALIDATION_STATES).map(
        (option) => option.value,
      ),
    ).toEqual([...VALIDATION_STATES]);
  });

  it("tones a confirmed finding differently from an invalid one", () => {
    const options = stateSelectOptions("validation", VALIDATION_STATES);
    const confirmed = options.find((option) => option.value === "CONFIRMED");
    const invalid = options.find((option) => option.value === "INVALID");

    expect(confirmed?.tone).toBe("success");
    expect(invalid?.tone).toBe("danger");
  });

  it("degrades an unknown state to neutral rather than throwing", () => {
    const [option] = stateSelectOptions("validation", ["INVENTED_LATER"]);

    expect(option?.tone).toBe("neutral");
    expect(option?.label).toBe("Invented later");
  });
});

describe("severitySelectOptions", () => {
  it("gives each rating its own tone", () => {
    const tones = severitySelectOptions(SEVERITY_RATINGS).map(
      (option) => option.tone,
    );

    expect(new Set(tones).size).toBe(SEVERITY_RATINGS.length);
  });

  it("says what NONE means, since on its own it reads as 'unset'", () => {
    const none = severitySelectOptions(SEVERITY_RATINGS).find(
      (option) => option.value === "NONE",
    );

    expect(none?.label).toContain("informational");
  });
});

describe("visibilitySelectOptions", () => {
  // Choosing the wrong visibility is how internal-only material reaches a
  // published advisory, so the consequence is on the option itself and not in
  // a tooltip somewhere else on the screen.
  it.each(CONTENT_VISIBILITIES)("explains what %s means", (visibility) => {
    const option = visibilitySelectOptions(CONTENT_VISIBILITIES).find(
      (entry) => entry.value === visibility,
    );

    expect(option?.description).toMatch(/\w/);
  });

  it("warns that internal content never leaves internal reports", () => {
    const internal = visibilitySelectOptions(CONTENT_VISIBILITIES).find(
      (option) => option.value === "INTERNAL",
    );

    expect(internal?.description).toContain("Never");
  });
});

describe("Select", () => {
  it("shows the selected option's words, not the value behind them", () => {
    render(
      <Select
        aria-label="Validation"
        value="PEER_REVIEWED"
        onValueChange={() => {}}
        options={stateSelectOptions("validation", VALIDATION_STATES)}
      />,
    );

    const trigger = screen.getByLabelText("Validation");

    expect(trigger).toHaveTextContent("Peer reviewed");
    expect(trigger).not.toHaveTextContent("PEER_REVIEWED");
  });

  it("falls back to the placeholder when nothing is chosen", () => {
    render(
      <Select
        aria-label="Severity"
        value={undefined}
        onValueChange={() => {}}
        placeholder="Leave unscored"
        options={severitySelectOptions(SEVERITY_RATINGS)}
      />,
    );

    expect(screen.getByLabelText("Severity")).toHaveTextContent(
      "Leave unscored",
    );
  });

  it("stays disabled when the researcher cannot edit", () => {
    render(
      <Select
        aria-label="Disclosure"
        value="EMBARGOED"
        onValueChange={() => {}}
        disabled
        options={stateSelectOptions("disclosure", DISCLOSURE_STATES)}
      />,
    );

    expect(screen.getByLabelText("Disclosure")).toBeDisabled();
  });
});
