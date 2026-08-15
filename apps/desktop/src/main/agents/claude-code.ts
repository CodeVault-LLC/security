import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
 * - It runs in a fresh temporary directory, not the researcher's project.
 * - A timeout and a cancellation path both terminate the process group.
 */

const PROVIDER_ID = "claude-code";

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
    displayName: "Claude Code",

    async detect(): Promise<ProviderDetection> {
      try {
        const result = await execute(executable, ["--version"], {
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

      const result = await execute(
        executable,
        // `-p` is Claude Code's non-interactive print mode. No other flags are
        // passed, and none are ever taken from the renderer.
        ["-p"],
        {
          timeoutMs: input.timeoutMs,
          environmentAllowlist: input.environmentAllowlist,
          cwd: workingDirectory,
          stdin: input.prompt,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        },
      );

      return {
        stdout: redactSecrets(result.stdout),
        stderr: redactSecrets(result.stderr),
        exitCode: result.exitCode,
        durationMs: Date.now() - startedAt,
        version: detection.version ?? null,
        timedOut: result.timedOut,
        cancelled: result.cancelled,
      };
    },
  };
}

interface ExecuteOptions {
  timeoutMs: number;
  environmentAllowlist: readonly string[];
  cwd: string;
  stdin?: string;
  signal?: AbortSignal;
}

interface ExecuteResult {
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

function execute(
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
