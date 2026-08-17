import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AI_PROVIDER_CAPABILITIES,
  type AiRunProfile,
} from "@codevault/contracts";

import {
  DEFAULT_ENVIRONMENT_ALLOWLIST,
  redactSecrets,
  type AiRunInput,
  type AiRunResult,
  type LocalAiProvider,
  type ProviderDetection,
} from "./types.js";

/**
 * The Claude Code provider.
 *
 * Runs `claude -p` on the researcher's workstation. Every property of this
 * adapter is about the spawn being safe:
 *
 * - `shell: false`, always. The prompt contains attacker-influenced text taken
 *   from research targets. Going through a shell would make quoting the only
 *   thing standing between a captured HTTP body and command execution.
 * - The prompt is written to stdin rather than passed as an argument, so it
 *   never appears in the process list or a shell history.
 * - The child starts from an empty environment and receives only allow-listed
 *   variables, so it cannot read the workstation's other credentials.
 * - It runs in a fresh temporary directory, not the researcher's project, and
 *   with no tools at all, so there is nothing to read there either.
 * - Every argument is derived from a server-resolved profile of enums. Nothing
 *   in the vector is free text from the renderer.
 * - A timeout and a cancellation path both terminate the process group.
 */

const PROVIDER_ID = "claude-code";
const CAPABILITIES = AI_PROVIDER_CAPABILITIES[PROVIDER_ID];

/** Longest a detection call may take before the provider counts as absent. */
const DETECT_TIMEOUT_MS = 10_000;

export interface ClaudeCodeOptions {
  /** Resolved once in settings; defaults to looking `claude` up on PATH. */
  executablePath?: string;
}

export function createClaudeCodeProvider(
  options: ClaudeCodeOptions = {},
): LocalAiProvider {
  const executable = options.executablePath ?? "claude";

  return {
    id: PROVIDER_ID,
    ...CAPABILITIES,

    async detect(): Promise<ProviderDetection> {
      try {
        const result = await executeProviderProcess(executable, ["--version"], {
          timeoutMs: DETECT_TIMEOUT_MS,
          environmentAllowlist: [...DEFAULT_ENVIRONMENT_ALLOWLIST],
          cwd: tmpdir(),
        });

        if (result.exitCode !== 0) {
          return {
            available: false,
            detail:
              result.stderr.trim().slice(0, 200) ||
              `The executable exited with status ${result.exitCode}.`,
          };
        }

        return {
          available: true,
          version: result.stdout.trim().split("\n")[0] ?? "unknown",
          executable,
        };
      } catch (error: unknown) {
        return {
          available: false,
          detail:
            error instanceof Error
              ? `Claude Code was not found on this workstation (${error.message}).`
              : "Claude Code was not found on this workstation.",
        };
      }
    },

    async run(input: AiRunInput): Promise<AiRunResult> {
      const startedAt = Date.now();
      const workingDirectory =
        input.workingDirectory ??
        (await mkdtemp(join(tmpdir(), "codevault-ai-")));

      const detection = await this.detect();

      const result = await executeProviderProcess(
        executable,
        buildArgs(input.profile, input.outputSchema),
        {
          timeoutMs: input.profile.timeoutMs,
          environmentAllowlist: input.environmentAllowlist,
          cwd: workingDirectory,
          stdin: input.prompt,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        },
      );

      const envelope = parseEnvelope(result.stdout);

      return {
        stdout: redactSecrets(envelope.result),
        stderr: redactSecrets(result.stderr),
        exitCode: result.exitCode,
        durationMs: Date.now() - startedAt,
        version: detection.version ?? null,
        timedOut: result.timedOut,
        cancelled: result.cancelled,
        costUsd: envelope.costUsd,
        inputTokens: envelope.inputTokens,
        outputTokens: envelope.outputTokens,
        toolDenials: envelope.toolDenials,
        providerError: envelope.providerError,
      };
    },
  };
}

/** Tools each policy grants. `NONE` is an empty string, which grants none. */
const TOOLS_FOR_POLICY: Readonly<Record<AiRunProfile["toolPolicy"], string>> = {
  NONE: "",
  READ_ONLY: "Read,Glob,Grep",
};

/**
 * Builds the argument vector for one run.
 *
 * Exported for its tests. Every value here comes from a schema-validated enum
 * or from the action's own output schema — there is no path by which a string
 * chosen in the renderer becomes an argument.
 */
export function buildArgs(
  profile: AiRunProfile,
  outputSchema: unknown,
): string[] {
  const args = [
    // Non-interactive print mode.
    "-p",
    // A structured envelope rather than bare text, which is what carries the
    // cost and token counts back into the run record.
    "--output-format",
    "json",
    "--model",
    profile.model,
    "--effort",
    profile.effort,
    // Removes the capability rather than relying on the working directory being
    // uninteresting. A drafting action works from a prompt the server already
    // assembled; a filesystem or network call could only reach something it was
    // deliberately not given.
    "--tools",
    TOOLS_FOR_POLICY[profile.toolPolicy],
    "--json-schema",
    JSON.stringify(outputSchema),
  ];

  if (profile.isolated) {
    // No hooks, no plugins, no project-file discovery. A hook configured on
    // this workstation would otherwise run inside every CodeVault AI run.
    args.push("--bare");
  } else if (profile.settingSources.length > 0) {
    args.push("--setting-sources", profile.settingSources.join(","));
  } else {
    // An empty list means no settings at all, which the flag cannot express by
    // omission — omitting it would load every scope.
    args.push("--bare");
  }

  if (profile.maxBudgetUsd !== null) {
    args.push("--max-budget-usd", String(profile.maxBudgetUsd));
  }

  return args;
}

interface ProviderEnvelope {
  result: string;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  toolDenials: number;
  providerError: string | null;
}

/**
 * Reads the provider's result envelope.
 *
 * Tolerant on purpose: an envelope that cannot be parsed falls back to the raw
 * output, so a change in the tool's reporting format degrades the accounting
 * rather than failing runs. The server validates whatever comes out of here
 * against the action's schema regardless.
 */
export function parseEnvelope(stdout: string): ProviderEnvelope {
  const empty: ProviderEnvelope = {
    result: stdout,
    costUsd: null,
    inputTokens: null,
    outputTokens: null,
    toolDenials: 0,
    providerError: null,
  };

  let parsed: unknown;

  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return empty;
  }

  if (parsed === null || typeof parsed !== "object") {
    return empty;
  }

  const envelope = parsed as Record<string, unknown>;

  if (typeof envelope["result"] !== "string") {
    return empty;
  }

  const usage =
    typeof envelope["usage"] === "object" && envelope["usage"] !== null
      ? (envelope["usage"] as Record<string, unknown>)
      : {};

  const denials = envelope["permission_denials"];

  return {
    result: envelope["result"],
    costUsd: finiteOrNull(envelope["total_cost_usd"]),
    inputTokens: finiteOrNull(usage["input_tokens"]),
    outputTokens: finiteOrNull(usage["output_tokens"]),
    toolDenials: Array.isArray(denials) ? denials.length : 0,
    providerError:
      envelope["is_error"] === true
        ? // The envelope's `result` carries the provider's own message when it
          // failed, so it is the failure reason rather than an answer.
          envelope["result"].slice(0, 500) || "The provider reported an error."
        : null,
  };
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export interface ExecuteOptions {
  timeoutMs: number;
  environmentAllowlist: readonly string[];
  cwd: string;
  stdin?: string;
  signal?: AbortSignal;
}

export interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
}

/** Largest amount of provider output retained, to bound memory on a runaway. */
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

function buildEnvironment(
  allowlist: readonly string[],
): Record<string, string> {
  const environment: Record<string, string> = {};

  for (const name of allowlist) {
    const value = process.env[name];

    if (value !== undefined) {
      environment[name] = value;
    }
  }

  return environment;
}

export function executeProviderProcess(
  executable: string,
  args: readonly string[],
  options: ExecuteOptions,
): Promise<ExecuteResult> {
  return new Promise<ExecuteResult>((resolve, reject) => {
    const child = spawn(executable, [...args], {
      // Never through a shell. This is the single most important line in the
      // adapter: the prompt is untrusted text.
      shell: false,
      cwd: options.cwd,
      env: buildEnvironment(options.environmentAllowlist),
      stdio: ["pipe", "pipe", "pipe"],
      // Its own process group, so a timeout kills any children it spawned too.
      detached: process.platform !== "win32",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const terminate = (): void => {
      if (child.pid === undefined) {
        return;
      }

      try {
        if (process.platform === "win32") {
          child.kill("SIGKILL");
        } else {
          process.kill(-child.pid, "SIGKILL");
        }
      } catch {
        // The process already exited; nothing to terminate.
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs);

    const onAbort = (): void => {
      cancelled = true;
      terminate();
    };

    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < MAX_OUTPUT_BYTES) {
        stdout += chunk;
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < MAX_OUTPUT_BYTES) {
        stderr += chunk;
      }
    });

    child.on("error", (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });

    child.on("close", (code: number | null) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({ stdout, stderr, exitCode: code, timedOut, cancelled });
    });

    if (options.stdin !== undefined) {
      child.stdin.end(options.stdin, "utf8");
    } else {
      child.stdin.end();
    }
  });
}
