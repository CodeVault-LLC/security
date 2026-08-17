import { describe, expect, it } from "vitest";

import { AI_ACTIONS } from "./actions.js";
import { ProviderPolicyError } from "./context.js";
import { resolveRunProfile, type ProviderProfilePolicy } from "./profiles.js";

/**
 * Run profile resolution.
 *
 * Two properties matter here. A workspace that has not chosen a model has not
 * approved every model, and a researcher preference outside the allow-list is
 * refused rather than quietly downgraded — a run that claims one model and used
 * another would make the audit trail lie.
 */

const PERMISSIVE: ProviderProfilePolicy = {
  allowedModels: ["claude-opus-5", "claude-sonnet-5"],
  allowedEfforts: ["low", "medium", "high", "xhigh", "max"],
  defaultModel: "claude-opus-5",
  settingSources: ["user"],
  isolated: false,
  maxBudgetUsd: 5,
};

describe("resolveRunProfile", () => {
  it("uses the workspace default model and the action's effort", () => {
    const profile = resolveRunProfile(
      "claude-code",
      "FINDING_SUGGEST_CVSS40",
      PERMISSIVE,
    );

    expect(profile.model).toBe("claude-opus-5");
    expect(profile.effort).toBe("xhigh");
  });

  it("gives cheap actions less thinking than expensive ones", () => {
    const title = resolveRunProfile(
      "claude-code",
      "FINDING_DRAFT_TITLE",
      PERMISSIVE,
    );
    const leak = resolveRunProfile(
      "claude-code",
      "REPORT_LEAK_REVIEW",
      PERMISSIVE,
    );

    expect(title.effort).toBe("low");
    expect(leak.effort).toBe("xhigh");
  });

  it("refuses to run when no model is allow-listed", () => {
    // Forgetting to configure a provider must not be the same as approving
    // every model for it.
    expect(() =>
      resolveRunProfile("claude-code", "FINDING_DRAFT_TITLE", {
        ...PERMISSIVE,
        allowedModels: [],
        defaultModel: null,
      }),
    ).toThrow(ProviderPolicyError);
  });

  it("refuses a researcher preference outside the allow-list", () => {
    expect(() =>
      resolveRunProfile("claude-code", "FINDING_DRAFT_TITLE", PERMISSIVE, {
        model: "claude-fable-5",
      }),
    ).toThrow(ProviderPolicyError);
  });

  it("refuses an effort outside the allow-list", () => {
    expect(() =>
      resolveRunProfile(
        "claude-code",
        "FINDING_DRAFT_TITLE",
        { ...PERMISSIVE, allowedEfforts: ["low", "medium"] },
        { effort: "max" },
      ),
    ).toThrow(ProviderPolicyError);
  });

  it("refuses a default model that was dropped from the allow-list", () => {
    expect(() =>
      resolveRunProfile("claude-code", "FINDING_DRAFT_TITLE", {
        ...PERMISSIVE,
        allowedModels: ["claude-sonnet-5"],
        defaultModel: "claude-opus-5",
      }),
    ).toThrow(ProviderPolicyError);
  });

  it("caps an action's effort at the highest the workspace permits", () => {
    // The workspace has chosen to spend less. The action gets a shallower
    // answer rather than an error, and the run records what actually ran.
    const profile = resolveRunProfile("claude-code", "REPORT_LEAK_REVIEW", {
      ...PERMISSIVE,
      allowedEfforts: ["low", "medium"],
    });

    expect(profile.effort).toBe("medium");
  });

  it("takes the tool policy from the action, not the request", () => {
    const profile = resolveRunProfile(
      "claude-code",
      "FINDING_DRAFT_SUMMARY",
      PERMISSIVE,
      {
        // Nothing in the override type can widen it; this asserts the resolved
        // value comes from the registry rather than anywhere a caller controls.
        effort: "low",
      },
    );

    expect(profile.toolPolicy).toBe("NONE");
  });

  it("gives every registered action a tool policy of NONE", () => {
    // A context-out action works from a prompt the server already assembled.
    // If this ever fails, an action gained the ability to reach outside its
    // prompt and the security document needs revising with it.
    for (const definition of Object.values(AI_ACTIONS)) {
      expect(definition.toolPolicy).toBe("NONE");
    }
  });

  it("clamps the timeout into a sane range", () => {
    expect(
      resolveRunProfile("claude-code", "FINDING_DRAFT_TITLE", PERMISSIVE, {
        timeoutMs: 5,
      }).timeoutMs,
    ).toBe(10_000);
    expect(
      resolveRunProfile("claude-code", "FINDING_DRAFT_TITLE", PERMISSIVE, {
        timeoutMs: 99_000_000,
      }).timeoutMs,
    ).toBe(1_800_000);
  });

  it("rejects a model that belongs to another provider", () => {
    expect(() =>
      resolveRunProfile("codex-cli", "FINDING_DRAFT_TITLE", {
        ...PERMISSIVE,
        allowedModels: ["claude-opus-5"],
      }),
    ).toThrow(ProviderPolicyError);
  });
});
