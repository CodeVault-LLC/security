import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AI_PROVIDER_CAPABILITIES,
  type AiRunProfile,
} from "@codevault/contracts";

import { executeProviderProcess } from "./claude-code.js";
import {
  DEFAULT_ENVIRONMENT_ALLOWLIST,
  redactSecrets,
  type AiRunInput,
  type AiRunResult,
  type LocalAiProvider,
  type ProviderDetection,
} from "./types.js";

const PROVIDER_ID = "codex-cli";
const CAPABILITIES = AI_PROVIDER_CAPABILITIES[PROVIDER_ID];
const DETECT_TIMEOUT_MS = 10_000;

export interface CodexCliOptions {
  executablePath?: string;
}

export function createCodexCliProvider(
  options: CodexCliOptions = {},
): LocalAiProvider {
  const executable = options.executablePath ?? "codex";

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
              ? `Codex CLI was not found on this workstation (${error.message}).`
              : "Codex CLI was not found on this workstation.",
        };
      }
    },

    async run(input: AiRunInput): Promise<AiRunResult> {
      const startedAt = Date.now();
      const workingDirectory =
        input.workingDirectory ??
        (await mkdtemp(join(tmpdir(), "codevault-codex-")));
      const schemaPath = join(workingDirectory, "output-schema.json");
      const resultPath = join(workingDirectory, "last-message.json");

      await writeFile(schemaPath, JSON.stringify(input.outputSchema), {
        encoding: "utf8",
        mode: 0o600,
      });

      const detection = await this.detect();
      const result = await executeProviderProcess(
        executable,
        buildCodexArgs(input.profile, schemaPath, resultPath),
        {
          timeoutMs: input.profile.timeoutMs,
          environmentAllowlist: input.environmentAllowlist,
          cwd: workingDirectory,
          stdin: input.prompt,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        },
      );
      const events = parseCodexEvents(result.stdout);
      const answer = await readFile(resultPath, "utf8").catch(() => "");

      return {
        stdout: redactSecrets(answer),
        stderr: redactSecrets(result.stderr),
        exitCode: result.exitCode,
        durationMs: Date.now() - startedAt,
        version: detection.version ?? null,
        timedOut: result.timedOut,
        cancelled: result.cancelled,
        costUsd: null,
        inputTokens: events.inputTokens,
        outputTokens: events.outputTokens,
        toolDenials: 0,
        providerError:
          events.providerError ??
          (result.exitCode === 0
            ? null
            : result.stderr.trim().slice(0, 500) ||
              "Codex CLI exited without producing a result."),
      };
    },
  };
}

export function buildCodexArgs(
  profile: AiRunProfile,
  schemaPath: string,
  resultPath: string,
): string[] {
  return [
    "exec",
    "--model",
    profile.model,
    "--config",
    `model_reasoning_effort="${profile.effort}"`,
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--output-schema",
    schemaPath,
    "--output-last-message",
    resultPath,
    "--json",
    "-",
  ];
}

interface CodexEventSummary {
  inputTokens: number | null;
  outputTokens: number | null;
  providerError: string | null;
}

export function parseCodexEvents(stdout: string): CodexEventSummary {
  const summary: CodexEventSummary = {
    inputTokens: null,
    outputTokens: null,
    providerError: null,
  };

  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (parsed === null || typeof parsed !== "object") continue;
    const event = parsed as Record<string, unknown>;

    if (event["type"] === "error" && typeof event["message"] === "string") {
      summary.providerError = event["message"].slice(0, 500);
    }

    if (event["type"] === "turn.completed") {
      const usage =
        event["usage"] !== null && typeof event["usage"] === "object"
          ? (event["usage"] as Record<string, unknown>)
          : {};
      summary.inputTokens = finiteIntegerOrNull(usage["input_tokens"]);
      summary.outputTokens = finiteIntegerOrNull(usage["output_tokens"]);
    }
  }

  return summary;
}

function finiteIntegerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}
