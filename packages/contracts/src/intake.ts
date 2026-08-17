import { Type, type Static } from "@sinclair/typebox";

import {
  ActorSummary,
  Markdown,
  RevisionField,
  Sha256,
  Timestamp,
  Uuid,
  enumOf,
} from "./common.js";

export const INTAKE_SOURCES = [
  "MANUAL",
  "FOLDER_SCAN",
  "EXTERNAL_AGENT",
] as const;
export const IntakeSourceSchema = enumOf(INTAKE_SOURCES);
export type IntakeSource = Static<typeof IntakeSourceSchema>;

export const INTAKE_ITEM_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "REJECTED",
  "MERGED",
] as const;
export const IntakeItemStatusSchema = enumOf(INTAKE_ITEM_STATUSES);
export type IntakeItemStatus = Static<typeof IntakeItemStatusSchema>;

export const INTAKE_CONFIDENCE_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export const IntakeConfidenceSchema = enumOf(INTAKE_CONFIDENCE_LEVELS);
export type IntakeConfidence = Static<typeof IntakeConfidenceSchema>;

export const IntakeAffectedVersion = Type.Object(
  {
    assetLabel: Type.String({ minLength: 1, maxLength: 300 }),
    expression: Type.String({ minLength: 1, maxLength: 500 }),
    evidenceNote: Type.Optional(Type.String({ maxLength: 2_000 })),
  },
  { additionalProperties: false },
);
export type IntakeAffectedVersion = Static<typeof IntakeAffectedVersion>;

export const IntakeDraft = Type.Object(
  {
    title: Type.String({ minLength: 8, maxLength: 200 }),
    summaryMarkdown: Type.Optional(Markdown),
    technicalMarkdown: Type.Optional(Markdown),
    impactMarkdown: Type.Optional(Markdown),
    remediationMarkdown: Type.Optional(Markdown),
    suggestedCweIds: Type.Array(
      Type.String({ pattern: "^CWE-[1-9][0-9]*$", maxLength: 20 }),
      { maxItems: 25 },
    ),
    affectedVersions: Type.Array(IntakeAffectedVersion, { maxItems: 100 }),
    uncertainties: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), {
        maxItems: 100,
      }),
    ),
  },
  { additionalProperties: false },
);
export type IntakeDraft = Static<typeof IntakeDraft>;

const FileCitation = Type.Object(
  {
    kind: Type.Literal("FILE"),
    path: Type.String({ minLength: 1, maxLength: 1_024 }),
    sha256: Sha256,
    startLine: Type.Optional(Type.Integer({ minimum: 1 })),
    endLine: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

const ArtifactCitation = Type.Object(
  {
    kind: Type.Literal("ARTIFACT"),
    artifactId: Uuid,
    label: Type.String({ minLength: 1, maxLength: 300 }),
  },
  { additionalProperties: false },
);

export const IntakeCitation = Type.Union([FileCitation, ArtifactCitation]);
export type IntakeCitation = Static<typeof IntakeCitation>;

export const IntakeBatch = Type.Object({
  id: Uuid,
  caseId: Uuid,
  source: IntakeSourceSchema,
  sourceLabel: Type.String(),
  runId: Type.Union([Uuid, Type.Null()]),
  manifest: Type.Record(Type.String(), Type.Unknown()),
  createdBy: ActorSummary,
  createdAt: Timestamp,
});
export type IntakeBatch = Static<typeof IntakeBatch>;

export const IntakeItem = Type.Object({
  id: Uuid,
  batch: IntakeBatch,
  status: IntakeItemStatusSchema,
  draft: IntakeDraft,
  citations: Type.Array(IntakeCitation),
  confidence: Type.Union([IntakeConfidenceSchema, Type.Null()]),
  createdFindingId: Type.Union([Uuid, Type.Null()]),
  mergedIntoFindingId: Type.Union([Uuid, Type.Null()]),
  reviewedBy: Type.Union([ActorSummary, Type.Null()]),
  reviewedAt: Type.Union([Timestamp, Type.Null()]),
  rejectionReason: Type.Union([Type.String(), Type.Null()]),
  revision: RevisionField,
  createdAt: Timestamp,
});
export type IntakeItem = Static<typeof IntakeItem>;

export const CreateManualIntakeRequest = Type.Object(
  {
    caseId: Uuid,
    sourceLabel: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    draft: IntakeDraft,
    citations: Type.Optional(Type.Array(IntakeCitation, { maxItems: 200 })),
    confidence: Type.Optional(IntakeConfidenceSchema),
  },
  { additionalProperties: false },
);
export type CreateManualIntakeRequest = Static<
  typeof CreateManualIntakeRequest
>;

export const UpdateIntakeItemRequest = Type.Object(
  { draft: IntakeDraft, expectedRevision: RevisionField },
  { additionalProperties: false },
);
export type UpdateIntakeItemRequest = Static<typeof UpdateIntakeItemRequest>;

export const DecideIntakeItemRequest = Type.Object(
  { expectedRevision: RevisionField },
  { additionalProperties: false },
);
export type DecideIntakeItemRequest = Static<typeof DecideIntakeItemRequest>;

export const RejectIntakeItemRequest = Type.Object(
  {
    expectedRevision: RevisionField,
    reason: Type.String({ minLength: 1, maxLength: 1_000 }),
  },
  { additionalProperties: false },
);
export type RejectIntakeItemRequest = Static<typeof RejectIntakeItemRequest>;

export const MergeIntakeItemRequest = Type.Object(
  { expectedRevision: RevisionField, findingId: Uuid },
  { additionalProperties: false },
);
export type MergeIntakeItemRequest = Static<typeof MergeIntakeItemRequest>;

export const ListIntakeQuery = Type.Object({
  caseId: Uuid,
  status: Type.Optional(IntakeItemStatusSchema),
});
export type ListIntakeQuery = Static<typeof ListIntakeQuery>;
