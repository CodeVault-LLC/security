import { describe, expect, it } from "vitest";

import type { AiProviderPolicy, AiProviderStatus } from "@codevault/contracts";

import {
  configuredAiProviderStatuses,
  normalizeAiProviderStatuses,
} from "./ai-providers.js";

const UPDATED_AT = "2026-08-19T00:00:00.000Z";

function policy(
  providerId: AiProviderPolicy["providerId"],
  overrides: Partial<AiProviderPolicy> = {},
): AiProviderPolicy {
  return {
    providerId,
    enabled: true,
    allowedVisibility: ["INTERNAL"],
    allowRestrictedCases: false,
    retainFullPrompts: false,
    allowedModels:
      providerId === "claude-code" ? ["claude-opus-5"] : ["gpt-5.6-sol"],
    allowedEfforts: ["medium"],
    defaultModel:
      providerId === "claude-code" ? "claude-opus-5" : "gpt-5.6-sol",
    settingSources: ["user"],
    isolated: false,
    maxBudgetUsd: null,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function provider(
  providerId: AiProviderStatus["providerId"],
  available = true,
): AiProviderStatus {
  return {
    providerId,
    displayName: providerId === "claude-code" ? "Claude Code" : "Codex CLI",
    available,
    version: available ? "1.0.0" : null,
    executablePath: available ? `/usr/bin/${providerId}` : null,
    detail: available ? null : "Executable not found",
    models: providerId === "claude-code" ? ["claude-opus-5"] : ["gpt-5.6-sol"],
    efforts: ["medium"],
    defaultModel:
      providerId === "claude-code" ? "claude-opus-5" : "gpt-5.6-sol",
  };
}

describe("normalizeAiProviderStatuses", () => {
  it("fills provider capabilities omitted by an older Electron main process", () => {
    const legacyStatus = {
      providerId: "claude-code",
      displayName: "Claude Code",
      available: true,
      version: "1.0.0",
      executablePath: "/usr/bin/claude",
      detail: null,
    } as AiProviderStatus;

    expect(normalizeAiProviderStatuses([legacyStatus])).toEqual([
      {
        ...legacyStatus,
        models: [
          "claude-opus-5",
          "claude-sonnet-5",
          "claude-haiku-4-5",
          "claude-fable-5",
        ],
        efforts: ["low", "medium", "high", "xhigh", "max"],
        defaultModel: "claude-opus-5",
      },
    ]);
  });

  it("preserves capabilities reported by the current main process", () => {
    const currentStatus: AiProviderStatus = {
      providerId: "codex-cli",
      displayName: "Codex CLI",
      available: true,
      version: "1.2.3",
      executablePath: "/usr/bin/codex",
      detail: null,
      models: ["gpt-5.6-luna"],
      efforts: ["high"],
      defaultModel: "gpt-5.6-luna",
    };

    expect(normalizeAiProviderStatuses([currentStatus])).toEqual([
      currentStatus,
    ]);
  });
});

describe("configuredAiProviderStatuses", () => {
  it("keeps only detected providers with a runnable organization policy", () => {
    const providers = [provider("claude-code", false), provider("codex-cli")];
    const policies = [
      policy("claude-code"),
      policy("codex-cli", { enabled: false }),
    ];

    expect(configuredAiProviderStatuses(providers, policies)).toEqual([]);
  });

  it("allows the configured provider even when the first provider is unusable", () => {
    const providers = [provider("claude-code", false), provider("codex-cli")];
    const policies = [policy("claude-code"), policy("codex-cli")];

    expect(configuredAiProviderStatuses(providers, policies)).toEqual([
      providers[1],
    ]);
  });

  it("rejects policies without a model or effort level", () => {
    const providers = [provider("claude-code")];

    expect(
      configuredAiProviderStatuses(providers, [
        policy("claude-code", { allowedModels: [] }),
      ]),
    ).toEqual([]);
    expect(
      configuredAiProviderStatuses(providers, [
        policy("claude-code", { allowedEfforts: [] }),
      ]),
    ).toEqual([]);
  });
});
