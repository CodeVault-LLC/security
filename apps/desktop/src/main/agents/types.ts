import type {
  AiActionId,
  AiEffort,
  AiModelId,
  AiProviderId,
  AiRunProfile,
} from "@codevault/contracts";

/**
 * Local AI provider interface.
 *
 * Providers run on the researcher's own workstation. The contract is narrow on
 * purpose: a provider receives a prompt the server built and returns text. It
 * cannot choose what data it is given, and it has no route back into CodeVault
 * except the run result the desktop client submits for validation.
 */

export interface ProviderDetection {
  available: boolean;
  version?: string;
  executable?: string;
  /** Why the provider is unusable, when it is. */
  detail?: string;
}

export interface AiRunInput {
  action: AiActionId;
  prompt: string;
  /**
   * How to execute the run.
   *
   * Resolved on the server against the workspace policy and handed here whole.
   * Neither this process nor the renderer chooses a model, a reasoning depth or
   * a tool capability — they are decided where context filtering already
   * happens, and this side only carries them out.
   */
  profile: AiRunProfile;
  /**
   * JSON Schema the output must satisfy.
   *
   * Passed to the provider so a well-formed run is not recorded as a failure
   * over a missing field. It is a convenience, never a control: the server
   * validates the output again and its verdict is the only one that counts.
   */
  outputSchema: unknown;
  /**
   * Directory the provider runs in.
   *
   * Defaults to a temporary directory rather than the researcher's project, so
   * a provider that reads its surroundings finds nothing of consequence.
   */
  workingDirectory?: string;
  /**
   * Environment variables the child process is allowed to inherit.
   *
   * The child starts from an empty environment and receives only these. Passing
   * the researcher's whole environment to a subprocess would hand it every API
   * key on the workstation.
   */
  environmentAllowlist: string[];
  signal?: AbortSignal;
}

export interface AiRunResult {
  /** The provider's answer, unwrapped from its result envelope. */
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  version: string | null;
  /** True when the run was stopped by the timeout rather than finishing. */
  timedOut: boolean;
  /** True when the researcher cancelled it. */
  cancelled: boolean;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /**
   * Tool calls the provider attempted and was refused.
   *
   * Expected to be zero: a drafting run is spawned with no tools at all. A
   * non-zero count means the model tried to reach outside its prompt, and that
   * belongs in the audit trail even though nothing came of it.
   */
  toolDenials: number;
  /** Set when the provider reported a failure of its own. */
  providerError: string | null;
}

export interface LocalAiProvider {
  id: AiProviderId;
  displayName: string;
  models: readonly AiModelId[];
  efforts: readonly AiEffort[];
  defaultModel: AiModelId;
  detect(): Promise<ProviderDetection>;
  run(input: AiRunInput): Promise<AiRunResult>;
}

/**
 * Environment variables a provider may inherit by default.
 *
 * Enough to find its own configuration and a home directory; nothing that
 * carries a credential for anything else.
 */
export const DEFAULT_ENVIRONMENT_ALLOWLIST: readonly string[] = [
  "HOME",
  "PATH",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "SystemRoot",
  "TEMP",
];

/**
 * Patterns whose values are removed from captured output before it is stored.
 *
 * Provider stdout is uploaded to the server as part of the run record, so
 * anything credential-shaped that a provider happens to echo is masked first.
 */
export const SECRET_PATTERNS: readonly RegExp[] = [
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END [^-]*-----/g,
];

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce(
    (result, pattern) => result.replace(pattern, "[redacted]"),
    text,
  );
}
