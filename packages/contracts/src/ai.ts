import { Type, type Static } from "@sinclair/typebox";

import {
  ActorSummary,
  ContentVisibilitySchema,
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

export const AiActionIdSchema = Type.Union(
  AI_ACTION_IDS.map((id) => Type.Literal(id)),
);

export const AiTargetTypeSchema = Type.Union([
  Type.Literal("FINDING"),
  Type.Literal("SCORE"),
  Type.Literal("CLAIM"),
  Type.Literal("REPORT_SECTION"),
]);

export type AiTargetType = Static<typeof AiTargetTypeSchema>;

export const AiProviderStatus = Type.Object({
  providerId: Type.String(),
  displayName: Type.String(),
  available: Type.Boolean(),
  version: Type.Union([Type.String(), Type.Null()]),
  executablePath: Type.Union([Type.String(), Type.Null()]),
  /** Why the provider is unusable, when it is. */
  detail: Type.Union([Type.String(), Type.Null()]),
});

export type AiProviderStatus = Static<typeof AiProviderStatus>;

export const AiProviderPolicy = Type.Object({
  providerId: Type.String(),
  enabled: Type.Boolean(),
  allowedVisibility: Type.Array(ContentVisibilitySchema),
  allowRestrictedCases: Type.Boolean(),
  /** Retain full prompts for audit instead of only an input manifest. */
  retainFullPrompts: Type.Boolean(),
  updatedAt: Timestamp,
});

export type AiProviderPolicy = Static<typeof AiProviderPolicy>;

export const UpdateAiProviderPolicyRequest = Type.Object({
  enabled: Type.Optional(Type.Boolean()),
  allowedVisibility: Type.Optional(Type.Array(ContentVisibilitySchema)),
  allowRestrictedCases: Type.Optional(Type.Boolean()),
  retainFullPrompts: Type.Optional(Type.Boolean()),
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
  providerId: Type.Optional(Type.String({ maxLength: 60 })),
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
});

export type SubmitAiRunResultRequest = Static<
  typeof SubmitAiRunResultRequest
>;

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

export const AiRunWithProposals = Type.Composite([
  AiRun,
  Type.Object({ proposals: Type.Array(AiProposal) }),
]);

export type AiRunWithProposals = Static<typeof AiRunWithProposals>;
