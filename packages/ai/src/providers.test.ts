import { describe, expect, it } from "vitest";

import { ProviderPolicyError } from "./context.js";
import {
  assertProviderEffort,
  assertProviderModel,
  providerDefinition,
} from "./providers.js";

describe("AI provider definitions", () => {
  it("keeps Claude and Codex model namespaces independent", () => {
    expect(() => assertProviderModel("claude-code", "gpt-5.6-sol")).toThrow(
      ProviderPolicyError,
    );
    expect(() => assertProviderModel("codex-cli", "claude-opus-5")).toThrow(
      ProviderPolicyError,
    );
  });

  it("accepts each provider's reviewed model IDs", () => {
    expect(assertProviderModel("claude-code", "claude-opus-5")).toBe(
      "claude-opus-5",
    );
    expect(assertProviderModel("codex-cli", "gpt-5.6-sol")).toBe("gpt-5.6-sol");
  });

  it("validates each provider's reviewed effort support", () => {
    expect(assertProviderEffort("claude-code", "max")).toBe("max");
    expect(assertProviderEffort("codex-cli", "max")).toBe("max");
  });

  it("refuses unknown providers", () => {
    expect(() => providerDefinition("arbitrary-command")).toThrow(
      ProviderPolicyError,
    );
  });
});
