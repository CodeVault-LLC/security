import { Type, type Static } from "@sinclair/typebox";

import {
  ActorSummary,
  ContentVisibilitySchema,
  enumOf,
  Markdown,
  Sha256,
  Timestamp,
  Uuid,
} from "./common.js";

/**
 * AI contracts.
 *
 * The renderer asks for an action ID and a target. It never sends a prompt, a
 * command, or free-form provider input, and every canonical change an AI wants
 * to make arrives as a proposal a human accepts, edits or rejects.
 */

export const AI_ACTION_IDS = [
  "FINDING_DRAFT_TITLE",
  "FINDING_DRAFT_SUMMARY",
  "FINDING_DRAFT_TECHNICAL",
  "FINDING_DRAFT_IMPACT",
  "FINDING_DRAFT_REMEDIATION",
  "FINDING_SUGGEST_CWE",
  "FINDING_SUGGEST_CVSS40",
  "FINDING_SUGGEST_CVSS31",
  "FINDING_FACT_CHECK",
  "FINDING_PRIOR_ART_SYNTHESIS",
  "REPORT_DRAFT_SECTION",
  "REPORT_POLISH_SECTION",
  "REPORT_CONSISTENCY_REVIEW",
  "REPORT_LEAK_REVIEW",
  "AFFECTED_VERSION_REVIEW",
] as const;

export type AiActionId = (typeof AI_ACTION_IDS)[number];

export const AiActionIdSchema = enumOf(AI_ACTION_IDS);

export const AI_TARGET_TYPES = [
  "FINDING",
  "SCORE",
  "CLAIM",
  "REPORT_SECTION",
] as const;

export const AiTargetTypeSchema = enumOf(AI_TARGET_TYPES);

export type AiTargetType = Static<typeof AiTargetTypeSchema>;

/** Fixed local adapters. Adding one requires a reviewed code change. */
export const AI_PROVIDER_IDS = ["claude-code", "codex-cli"] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const AiProviderIdSchema = enumOf(AI_PROVIDER_IDS);

/**
 * Models a run may use.
 *
 * Full identifiers rather than the provider's short aliases. An alias silently
 * re-points to a newer model, and "which model produced this proposal" has to
 * stay answerable a year after a researcher accepted it.
 */
export const AI_MODEL_IDS = [
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-haiku-4-5",
  "claude-fable-5",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
] as const;

export type AiModelId = (typeof AI_MODEL_IDS)[number];

export const AiModelIdSchema = enumOf(AI_MODEL_IDS);

/** Reasoning depth. Higher costs more and takes longer; it does not add tools. */
export const AI_EFFORT_LEVELS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type AiEffort = (typeof AI_EFFORT_LEVELS)[number];

export const AiEffortSchema = enumOf(AI_EFFORT_LEVELS);

/**
 * Reviewed capabilities of each fixed adapter.
 *
 * Shared by server policy validation and desktop detection so their model
 * menus cannot drift apart. This is data, not an executable registry.
 */
export const AI_PROVIDER_CAPABILITIES = {
  "claude-code": {
    displayName: "Claude Code",
    models: [
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5",
      "claude-fable-5",
    ],
    efforts: ["low", "medium", "high", "xhigh", "max"],
    defaultModel: "claude-opus-5",
  },
  "codex-cli": {
    displayName: "Codex CLI",
    models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
    efforts: ["low", "medium", "high", "xhigh", "max"],
    defaultModel: "gpt-5.6-sol",
  },
} as const satisfies Record<
  AiProviderId,
  {
    displayName: string;
    models: readonly AiModelId[];
    efforts: readonly AiEffort[];
    defaultModel: AiModelId;
  }
>;

export const AiProviderStatus = Type.Object({
  providerId: AiProviderIdSchema,
  displayName: Type.String(),
  available: Type.Boolean(),
  version: Type.Union([Type.String(), Type.Null()]),
  executablePath: Type.Union([Type.String(), Type.Null()]),
  /** Why the provider is unusable, when it is. */
  detail: Type.Union([Type.String(), Type.Null()]),
  models: Type.Array(AiModelIdSchema),
  efforts: Type.Array(AiEffortSchema),
  defaultModel: AiModelIdSchema,
});

export type AiProviderStatus = Static<typeof AiProviderStatus>;

/**
 * What the provider is allowed to reach for.
 *
 * A drafting action works from a prompt the server already assembled, so it
 * needs nothing: `NONE` removes the capability rather than relying on there
 * being nothing interesting nearby. `READ_ONLY` exists for actions that read a
 * researcher-chosen directory and can still neither execute nor write.
 */
export const AI_TOOL_POLICIES = ["NONE", "READ_ONLY"] as const;

export type AiToolPolicy = (typeof AI_TOOL_POLICIES)[number];

export const AiToolPolicySchema = enumOf(AI_TOOL_POLICIES);

/** Settings scopes the provider may load configuration from. */
export const AI_SETTING_SOURCES = ["user", "project", "local"] as const;

export type AiSettingSource = (typeof AI_SETTING_SOURCES)[number];

export const AiSettingSourceSchema = enumOf(AI_SETTING_SOURCES);

/**
 * How a run is executed.
 *
 * Resolved on the server from the action's declared needs and the workspace
 * policy, then handed to the desktop client. The client does not choose any of
 * it, and the renderer never sees a flag — this is the argument vector for a
 * local process, decided by the side that already owns context filtering.
 */
export const AiRunProfile = Type.Object({
  model: AiModelIdSchema,
  effort: AiEffortSchema,
  toolPolicy: AiToolPolicySchema,
  /** Settings scopes to load. Ignored when `isolated` is set. */
  settingSources: Type.Array(AiSettingSourceSchema, { maxItems: 3 }),
  /**
   * Skip hooks, plugins and project-file discovery entirely.
   *
   * Closes the hole where a hook in the researcher's own configuration runs
   * inside every CodeVault run, at the cost of requiring API-key authentication:
   * an isolated provider never reads OAuth credentials or the keychain.
   */
  isolated: Type.Boolean(),
  /** Hard spend ceiling for one run, in dollars. */
  maxBudgetUsd: Type.Union([
    Type.Number({ minimum: 0, maximum: 100 }),
    Type.Null(),
  ]),
  timeoutMs: Type.Integer({ minimum: 10_000, maximum: 1_800_000 }),
});

export type AiRunProfile = Static<typeof AiRunProfile>;

export const AiProviderPolicy = Type.Object({
  providerId: AiProviderIdSchema,
  enabled: Type.Boolean(),
  allowedVisibility: Type.Array(ContentVisibilitySchema),
  allowRestrictedCases: Type.Boolean(),
  /** Retain full prompts for audit instead of only an input manifest. */
  retainFullPrompts: Type.Boolean(),
  /** Models this provider may run. Empty means no run can be prepared. */
  allowedModels: Type.Array(AiModelIdSchema),
  /** Effort levels a researcher may select. Empty means no run can be prepared. */
  allowedEfforts: Type.Array(AiEffortSchema),
  /** Used when a researcher expresses no preference. */
  defaultModel: Type.Union([AiModelIdSchema, Type.Null()]),
  settingSources: Type.Array(AiSettingSourceSchema),
  isolated: Type.Boolean(),
  maxBudgetUsd: Type.Union([
    Type.Number({ minimum: 0, maximum: 100 }),
    Type.Null(),
  ]),
  updatedAt: Timestamp,
});

export type AiProviderPolicy = Static<typeof AiProviderPolicy>;

export const UpdateAiProviderPolicyRequest = Type.Object({
  enabled: Type.Optional(Type.Boolean()),
  allowedVisibility: Type.Optional(Type.Array(ContentVisibilitySchema)),
  allowRestrictedCases: Type.Optional(Type.Boolean()),
  retainFullPrompts: Type.Optional(Type.Boolean()),
  allowedModels: Type.Optional(Type.Array(AiModelIdSchema)),
  allowedEfforts: Type.Optional(Type.Array(AiEffortSchema)),
  defaultModel: Type.Optional(Type.Union([AiModelIdSchema, Type.Null()])),
  settingSources: Type.Optional(Type.Array(AiSettingSourceSchema)),
  isolated: Type.Optional(Type.Boolean()),
  maxBudgetUsd: Type.Optional(
    Type.Union([Type.Number({ minimum: 0, maximum: 100 }), Type.Null()]),
  ),
});

export type UpdateAiProviderPolicyRequest = Static<
  typeof UpdateAiProviderPolicyRequest
>;

/**
 * An entry in the context manifest.
 *
 * Each item is what the researcher sees in "View context being sent", and its
 * hash is what the audit trail keeps once the run is over.
 */
export const AiContextItem = Type.Object({
  kind: Type.String({ maxLength: 60 }),
  id: Type.String({ maxLength: 100 }),
  label: Type.String({ maxLength: 300 }),
  visibility: ContentVisibilitySchema,
  sha256: Sha256,
  /** Character count of the rendered text, so size is visible up front. */
  length: Type.Integer({ minimum: 0 }),
});

export type AiContextItem = Static<typeof AiContextItem>;

export const AiContextPreview = Type.Object({
  action: AiActionIdSchema,
  targetType: AiTargetTypeSchema,
  targetId: Uuid,
  audience: Type.Union([
    Type.Literal("INTERNAL"),
    Type.Literal("VENDOR"),
    Type.Literal("PUBLIC"),
  ]),
  items: Type.Array(AiContextItem),
  /** Full prompt text, shown to the researcher before they confirm the run. */
  promptText: Type.String(),
  /** How it would run, so the model and effort are visible before it does. */
  profile: AiRunProfile,
  /** Items excluded by policy, with the reason, so filtering is visible. */
  excluded: Type.Array(
    Type.Object({
      label: Type.String(),
      visibility: ContentVisibilitySchema,
      reason: Type.String(),
    }),
  ),
});

export type AiContextPreview = Static<typeof AiContextPreview>;

export const CreateAiRunRequest = Type.Object({
  action: AiActionIdSchema,
  targetType: AiTargetTypeSchema,
  targetId: Uuid,
  /** Optional researcher steer, appended as plain text, never as a command. */
  instruction: Type.Optional(Type.String({ maxLength: 2_000 })),
  providerId: Type.Optional(AiProviderIdSchema),
  /**
   * Researcher preferences, both bounded by the workspace policy.
   *
   * A preference outside the policy's allow-list is refused rather than
   * silently downgraded, so a researcher is never told a run used a model it
   * did not use.
   */
  model: Type.Optional(AiModelIdSchema),
  effort: Type.Optional(AiEffortSchema),
});

export type CreateAiRunRequest = Static<typeof CreateAiRunRequest>;

export const AiRun = Type.Object({
  id: Uuid,
  action: AiActionIdSchema,
  targetType: AiTargetTypeSchema,
  targetId: Uuid,
  caseId: Uuid,
  providerId: Type.String(),
  providerVersion: Type.Union([Type.String(), Type.Null()]),
  /**
   * The model and effort the run was prepared with.
   *
   * Null on runs recorded before profiles existed. `providerVersion` is the
   * command-line tool's version, which is a different question.
   */
  model: Type.Union([AiModelIdSchema, Type.Null()]),
  effort: Type.Union([AiEffortSchema, Type.Null()]),
  costUsd: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  inputTokens: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  outputTokens: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  status: Type.Union([
    Type.Literal("PREPARED"),
    Type.Literal("RUNNING"),
    Type.Literal("COMPLETED"),
    Type.Literal("FAILED"),
    Type.Literal("CANCELLED"),
  ]),
  /** Manifest of what was sent; full prompt only when policy retains it. */
  contextManifest: Type.Array(AiContextItem),
  promptSha256: Sha256,
  promptText: Type.Union([Type.String(), Type.Null()]),
  failureReason: Type.Union([Type.String(), Type.Null()]),
  startedBy: ActorSummary,
  startedAt: Timestamp,
  completedAt: Type.Union([Timestamp, Type.Null()]),
  durationMs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
});

export type AiRun = Static<typeof AiRun>;

/**
 * Raw provider output submitted by the desktop client.
 *
 * The server validates it against the action's output schema before any
 * proposal exists; malformed output is recorded as a failed run.
 */
export const SubmitAiRunResultRequest = Type.Object({
  status: Type.Union([
    Type.Literal("COMPLETED"),
    Type.Literal("FAILED"),
    Type.Literal("CANCELLED"),
  ]),
  providerVersion: Type.Optional(Type.String({ maxLength: 120 })),
  durationMs: Type.Optional(Type.Integer({ minimum: 0 })),
  /** Provider stdout, expected to contain the action's JSON output. */
  output: Type.Optional(Type.String({ maxLength: 500_000 })),
  failureReason: Type.Optional(Type.String({ maxLength: 2_000 })),
  costUsd: Type.Optional(Type.Number({ minimum: 0 })),
  inputTokens: Type.Optional(Type.Integer({ minimum: 0 })),
  outputTokens: Type.Optional(Type.Integer({ minimum: 0 })),
  /**
   * Tool calls the provider attempted and was refused.
   *
   * Expected to be zero: a drafting run is spawned with no tools at all. A
   * non-zero count means a model tried to reach outside its prompt, which is
   * worth having in the audit trail even though the attempt failed.
   */
  toolDenials: Type.Optional(Type.Integer({ minimum: 0 })),
});

export type SubmitAiRunResultRequest = Static<typeof SubmitAiRunResultRequest>;

export const AiProposal = Type.Object({
  id: Uuid,
  runId: Uuid,
  action: AiActionIdSchema,
  targetType: AiTargetTypeSchema,
  targetId: Uuid,
  /** Field-level changes; applied only after validation and permission checks. */
  patch: Type.Record(Type.String(), Type.Unknown()),
  rationaleMarkdown: Markdown,
  status: Type.Union([
    Type.Literal("PENDING"),
    Type.Literal("ACCEPTED"),
    Type.Literal("REJECTED"),
  ]),
  /** Target revision the proposal was computed against. */
  baseRevision: Type.Integer({ minimum: 1 }),
  reviewedBy: Type.Union([ActorSummary, Type.Null()]),
  reviewedAt: Type.Union([Timestamp, Type.Null()]),
  createdAt: Timestamp,
});

export type AiProposal = Static<typeof AiProposal>;

export const AcceptAiProposalRequest = Type.Object({
  /** Researcher-edited patch replacing the proposed one, when they edited it. */
  patch: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  expectedRevision: Type.Integer({ minimum: 1 }),
});

export type AcceptAiProposalRequest = Static<typeof AcceptAiProposalRequest>;

export const RejectAiProposalRequest = Type.Object({
  reason: Type.Optional(Type.String({ maxLength: 1_000 })),
});

export type RejectAiProposalRequest = Static<typeof RejectAiProposalRequest>;

/**
 * A prepared run.
 *
 * Carries the prompt so the desktop client can execute it locally. Returned
 * once, at preparation; the stored run keeps only the hash unless policy says
 * to retain the text.
 */
export const PreparedAiRun = Type.Object({
  ...AiRun.properties,
  promptText: Type.String(),
  /** How to execute it. Decided here, not by the client. */
  profile: AiRunProfile,
  /** JSON Schema the provider's output must satisfy. */
  outputSchema: Type.Unknown(),
});

export type PreparedAiRun = Static<typeof PreparedAiRun>;

export const AiRunWithProposals = Type.Object({
  ...AiRun.properties,
  proposals: Type.Array(AiProposal),
});

export type AiRunWithProposals = Static<typeof AiRunWithProposals>;
