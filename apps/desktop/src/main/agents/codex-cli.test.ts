import { describe, expect, it } from "vitest";

import type { AiRunProfile } from "@codevault/contracts";

import { buildCodexArgs, parseCodexEvents } from "./codex-cli.js";

const PROFILE: AiRunProfile = {
  model: "gpt-5.6-sol",
  effort: "high",
  toolPolicy: "NONE",
  settingSources: [],
  isolated: true,
  maxBudgetUsd: null,
  timeoutMs: 300_000,
};

function valueAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

describe("buildCodexArgs", () => {
  it("uses the resolved model and reasoning effort", () => {
    const args = buildCodexArgs(
      PROFILE,
      "/tmp/schema.json",
      "/tmp/result.json",
    );

    expect(valueAfter(args, "--model")).toBe("gpt-5.6-sol");
    expect(args).toContain('model_reasoning_effort="high"');
  });

  it("runs ephemerally in a read-only sandbox without user rules", () => {
    const args = buildCodexArgs(
      PROFILE,
      "/tmp/schema.json",
      "/tmp/result.json",
    );

    expect(valueAfter(args, "--sandbox")).toBe("read-only");
    expect(args).toContain("--ephemeral");
    expect(args).toContain("--ignore-user-config");
    expect(args).toContain("--ignore-rules");
    expect(args).toContain("--skip-git-repo-check");
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("writes only to explicit temporary schema and result paths", () => {
    const args = buildCodexArgs(
      PROFILE,
      "/tmp/schema.json",
      "/tmp/result.json",
    );

    expect(valueAfter(args, "--output-schema")).toBe("/tmp/schema.json");
    expect(valueAfter(args, "--output-last-message")).toBe("/tmp/result.json");
    expect(args.at(-1)).toBe("-");
  });
});

describe("parseCodexEvents", () => {
  it("extracts token usage from the completed turn", () => {
    const parsed = parseCodexEvents(
      [
        JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
        JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 123, output_tokens: 45 },
        }),
      ].join("\n"),
    );

    expect(parsed.inputTokens).toBe(123);
    expect(parsed.outputTokens).toBe(45);
    expect(parsed.providerError).toBeNull();
  });

  it("reports a provider-side error without treating JSONL as the answer", () => {
    const parsed = parseCodexEvents(
      JSON.stringify({ type: "error", message: "Authentication required" }),
    );

    expect(parsed.providerError).toBe("Authentication required");
  });

  it("ignores malformed event lines", () => {
    expect(parseCodexEvents("not-json\n").inputTokens).toBeNull();
  });
});
