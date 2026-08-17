import { describe, expect, it } from "vitest";

import type { AiProviderStatus } from "@codevault/contracts";

import { normalizeAiProviderStatuses } from "./ai-providers.js";

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
