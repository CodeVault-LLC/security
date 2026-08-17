import { describe, expect, it } from "vitest";

import type { AiRunProfile } from "@codevault/contracts";

import { buildArgs, parseEnvelope } from "./claude-code.js";

/**
 * The provider argument vector.
 *
 * These tests exist because the argument vector is a security boundary: it is
 * what decides whether a model running on a researcher's workstation can touch
 * the filesystem, load a hook someone else wrote, or spend without a ceiling.
 * The values all come from a server-resolved profile of enums, and these assert
 * they arrive intact.
 */

const PROFILE: AiRunProfile = {
  model: "claude-opus-5",
  effort: "xhigh",
  toolPolicy: "NONE",
  settingSources: ["user"],
  isolated: false,
  maxBudgetUsd: null,
  timeoutMs: 300_000,
};

const SCHEMA = { type: "object", properties: { title: { type: "string" } } };

function valueAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);

  return index === -1 ? undefined : args[index + 1];
}

describe("buildArgs", () => {
  it("passes the model and effort the server resolved", () => {
    const args = buildArgs(PROFILE, SCHEMA);

    expect(valueAfter(args, "--model")).toBe("claude-opus-5");
    expect(valueAfter(args, "--effort")).toBe("xhigh");
  });

  it("grants no tools under the NONE policy", () => {
    // The empty value is the documented way to disable every tool. This is the
    // control that keeps a drafting run away from the workstation, rather than
    // the working directory happening to be empty.
    expect(valueAfter(buildArgs(PROFILE, SCHEMA), "--tools")).toBe("");
  });

  it("grants only reading tools under READ_ONLY", () => {
    const args = buildArgs({ ...PROFILE, toolPolicy: "READ_ONLY" }, SCHEMA);
    const tools = valueAfter(args, "--tools") ?? "";

    expect(tools.split(",").sort()).toEqual(["Glob", "Grep", "Read"]);
    expect(tools).not.toMatch(/Bash|Write|Edit|WebFetch|WebSearch/);
  });

  it("passes the output schema so the provider constrains its own output", () => {
    const args = buildArgs(PROFILE, SCHEMA);

    expect(JSON.parse(valueAfter(args, "--json-schema") ?? "null")).toEqual(
      SCHEMA,
    );
  });

  it("asks for the structured envelope", () => {
    expect(valueAfter(buildArgs(PROFILE, SCHEMA), "--output-format")).toBe(
      "json",
    );
  });

  it("narrows settings to the allowed scopes", () => {
    const args = buildArgs({ ...PROFILE, settingSources: ["user"] }, SCHEMA);

    expect(valueAfter(args, "--setting-sources")).toBe("user");
    expect(args).not.toContain("--bare");
  });

  it("isolates from workstation configuration when policy says to", () => {
    const args = buildArgs({ ...PROFILE, isolated: true }, SCHEMA);

    expect(args).toContain("--bare");
    expect(args).not.toContain("--setting-sources");
  });

  it("isolates rather than loading everything when no scope is allowed", () => {
    // Omitting the flag would load every scope, so an empty list has to become
    // an explicit isolation. An empty allow-list must never mean "allow all".
    const args = buildArgs({ ...PROFILE, settingSources: [] }, SCHEMA);

    expect(args).toContain("--bare");
  });

  it("passes a spend ceiling when one is set, and omits it otherwise", () => {
    expect(
      valueAfter(
        buildArgs({ ...PROFILE, maxBudgetUsd: 2.5 }, SCHEMA),
        "--max-budget-usd",
      ),
    ).toBe("2.5");
    expect(buildArgs(PROFILE, SCHEMA)).not.toContain("--max-budget-usd");
  });

  it("never places a bare value where a flag is expected", () => {
    // The tools flag is variadic, so a value that is not followed by another
    // option would swallow the arguments after it.
    const args = buildArgs(PROFILE, SCHEMA);
    const toolsIndex = args.indexOf("--tools");
    const next = args[toolsIndex + 2];

    expect(next === undefined || next.startsWith("--")).toBe(true);
  });
});

describe("parseEnvelope", () => {
  const ENVELOPE = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: '{"title":"Unauthenticated SQL injection in the export endpoint"}',
    total_cost_usd: 0.0141,
    usage: { input_tokens: 9, output_tokens: 51 },
    permission_denials: [],
  });

  it("unwraps the answer and the accounting", () => {
    const parsed = parseEnvelope(ENVELOPE);

    expect(JSON.parse(parsed.result)).toEqual({
      title: "Unauthenticated SQL injection in the export endpoint",
    });
    expect(parsed.costUsd).toBeCloseTo(0.0141);
    expect(parsed.inputTokens).toBe(9);
    expect(parsed.outputTokens).toBe(51);
    expect(parsed.providerError).toBeNull();
  });

  it("counts refused tool calls", () => {
    // Expected to be zero under the NONE policy. A non-zero count means the
    // model reached for something it was not given, which belongs in the audit
    // trail even though the attempt failed.
    const parsed = parseEnvelope(
      JSON.stringify({
        result: "{}",
        permission_denials: [{ tool_name: "Bash" }, { tool_name: "Read" }],
      }),
    );

    expect(parsed.toolDenials).toBe(2);
  });

  it("reports a provider-side failure", () => {
    const parsed = parseEnvelope(
      JSON.stringify({ is_error: true, result: "Credit balance too low." }),
    );

    expect(parsed.providerError).toBe("Credit balance too low.");
  });

  it("falls back to the raw output when the envelope is unrecognised", () => {
    // A change in the tool's reporting format should degrade the accounting,
    // not fail runs. The server validates whatever comes out of here anyway.
    const parsed = parseEnvelope('{"title":"Direct JSON, no envelope"}');

    expect(parsed.result).toBe('{"title":"Direct JSON, no envelope"}');
    expect(parsed.costUsd).toBeNull();
  });

  it("falls back on output that is not JSON at all", () => {
    expect(parseEnvelope("command not found").result).toBe("command not found");
  });
});
