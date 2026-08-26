import { Type, type Static } from "@sinclair/typebox";

import {
  ActorSummary,
  ArtifactKindSchema,
  ContentVisibilitySchema,
  HumanReference,
  Markdown,
  PaginationQuery,
  PocStatusSchema,
  RevisionField,
  Sha256,
  ShortText,
  Timestamp,
  Uuid,
} from "./common.js";

/**
 * Evidence, artifact and proof-of-concept contracts.
 *
 * Bytes never travel through this API. The desktop client hashes and streams a
 * file straight to object storage using instructions the server hands back, and
 * these schemas describe only the metadata around that transfer.
 */

export const CreateUploadRequest = Type.Object({
  caseId: Uuid,
  findingId: Type.Optional(Uuid),
  filename: Type.String({ minLength: 1, maxLength: 300 }),
  mimeType: Type.String({ minLength: 1, maxLength: 200 }),
  sizeBytes: Type.Integer({ minimum: 0 }),
  sha256: Sha256,
  artifactKind: ArtifactKindSchema,
  visibility: ContentVisibilitySchema,
  capturedAt: Type.Optional(Timestamp),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export type CreateUploadRequest = Static<typeof CreateUploadRequest>;

/**
 * Presigned upload instructions.
 *
 * Small files receive a single PUT URL. Large files receive an ordered list of
 * part URLs plus the multipart upload ID to complete against.
 */
export const UploadInstructions = Type.Object({
  artifactId: Uuid,
  objectKey: Type.String(),
  strategy: Type.Union([Type.Literal("SINGLE"), Type.Literal("MULTIPART")]),
  url: Type.Union([Type.String(), Type.Null()]),
  multipartUploadId: Type.Union([Type.String(), Type.Null()]),
  partSizeBytes: Type.Integer({ minimum: 1 }),
  partUrls: Type.Array(Type.String()),
  requiredHeaders: Type.Record(Type.String(), Type.String()),
  expiresAt: Timestamp,
});

export type UploadInstructions = Static<typeof UploadInstructions>;

export const CompleteUploadRequest = Type.Object({
  /** ETags returned by object storage, in part order, for multipart uploads. */
  parts: Type.Optional(
    Type.Array(
      Type.Object({
        partNumber: Type.Integer({ minimum: 1 }),
        etag: Type.String({ minLength: 1, maxLength: 200 }),
      }),
    ),
  ),
});

export type CompleteUploadRequest = Static<typeof CompleteUploadRequest>;

export const PreviewRedactionRule = Type.Object(
  {
    match: Type.String({ minLength: 1, maxLength: 200 }),
    replacement: Type.String({ maxLength: 200 }),
  },
  { additionalProperties: false },
);

export const UpdatePreviewRedactionRequest = Type.Object(
  {
    rules: Type.Array(PreviewRedactionRule, { maxItems: 50 }),
    expectedRevision: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type UpdatePreviewRedactionRequest = Static<
  typeof UpdatePreviewRedactionRequest
>;

export const Artifact = Type.Object({
  id: Uuid,
  caseId: Uuid,
  findingId: Type.Union([Uuid, Type.Null()]),
  filename: Type.String(),
  mimeType: Type.String(),
  sizeBytes: Type.Integer({ minimum: 0 }),
  sha256: Sha256,
  artifactKind: ArtifactKindSchema,
  visibility: ContentVisibilitySchema,
  status: Type.Union([
    Type.Literal("PENDING"),
    Type.Literal("VERIFYING"),
    Type.Literal("STORED"),
    Type.Literal("QUARANTINED"),
    Type.Literal("REJECTED"),
    Type.Literal("DELETED"),
  ]),
  uploadedBy: ActorSummary,
  capturedAt: Type.Union([Timestamp, Type.Null()]),
  metadata: Type.Record(Type.String(), Type.Unknown()),
  /** Set once a preview job has produced a safe representation. */
  previewKind: Type.Union([
    Type.Literal("IMAGE_THUMBNAIL"),
    Type.Literal("TEXT_EXCERPT"),
    Type.Literal("NONE"),
    Type.Null(),
  ]),
  previewText: Type.Union([Type.String(), Type.Null()]),
  previewRedaction: Type.Union([
    Type.Object({
      rules: Type.Array(PreviewRedactionRule),
      revision: RevisionField,
      updatedAt: Timestamp,
    }),
    Type.Null(),
  ]),
  createdAt: Timestamp,
});

export type Artifact = Static<typeof Artifact>;

/** Short-lived download URL; artifacts are never served from a public bucket. */
export const ArtifactDownload = Type.Object({
  url: Type.String(),
  expiresAt: Timestamp,
  filename: Type.String(),
  sha256: Sha256,
});

export type ArtifactDownload = Static<typeof ArtifactDownload>;

export const Evidence = Type.Object({
  id: Uuid,
  ref: HumanReference,
  caseId: Uuid,
  findingId: Type.Union([Uuid, Type.Null()]),
  title: Type.String(),
  descriptionMarkdown: Type.Union([Markdown, Type.Null()]),
  visibility: ContentVisibilitySchema,
  capturedAt: Type.Union([Timestamp, Type.Null()]),
  artifacts: Type.Array(Artifact),
  createdBy: ActorSummary,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  revision: RevisionField,
});

export type Evidence = Static<typeof Evidence>;

export const CreateEvidenceRequest = Type.Object({
  caseId: Uuid,
  findingId: Type.Optional(Uuid),
  title: ShortText,
  descriptionMarkdown: Type.Optional(Markdown),
  visibility: ContentVisibilitySchema,
  capturedAt: Type.Optional(Timestamp),
  artifactIds: Type.Optional(Type.Array(Uuid)),
});

export type CreateEvidenceRequest = Static<typeof CreateEvidenceRequest>;

export const UpdateEvidenceRequest = Type.Object({
  title: Type.Optional(ShortText),
  descriptionMarkdown: Type.Optional(Type.Union([Markdown, Type.Null()])),
  visibility: Type.Optional(ContentVisibilitySchema),
  findingId: Type.Optional(Type.Union([Uuid, Type.Null()])),
  artifactIds: Type.Optional(Type.Array(Uuid)),
  expectedRevision: RevisionField,
});

export type UpdateEvidenceRequest = Static<typeof UpdateEvidenceRequest>;

export const ListEvidenceQuery = Type.Object({
  ...PaginationQuery.properties,
  caseId: Type.Optional(Uuid),
  findingId: Type.Optional(Uuid),
  visibility: Type.Optional(ContentVisibilitySchema),
  query: Type.Optional(Type.String({ maxLength: 200 })),
});

export type ListEvidenceQuery = Static<typeof ListEvidenceQuery>;

export const PocRun = Type.Object({
  id: Uuid,
  pocId: Uuid,
  /** Recorded outcome of a run a human performed; CodeVault runs nothing. */
  outcome: Type.Union([
    Type.Literal("SUCCESS"),
    Type.Literal("FAILURE"),
    Type.Literal("PARTIAL"),
  ]),
  notesMarkdown: Type.Union([Markdown, Type.Null()]),
  environment: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
  testedVersion: Type.Union([Type.String({ maxLength: 120 }), Type.Null()]),
  ranAt: Timestamp,
  ranBy: ActorSummary,
  createdAt: Timestamp,
});

export type PocRun = Static<typeof PocRun>;

export const Poc = Type.Object({
  id: Uuid,
  ref: HumanReference,
  findingId: Uuid,
  title: Type.String(),
  instructionsMarkdown: Markdown,
  preconditionsMarkdown: Type.Union([Markdown, Type.Null()]),
  expectedResultMarkdown: Type.Union([Markdown, Type.Null()]),
  status: PocStatusSchema,
  testedAssetId: Type.Union([Uuid, Type.Null()]),
  testedVersion: Type.Union([Type.String(), Type.Null()]),
  lastVerifiedAt: Type.Union([Timestamp, Type.Null()]),
  visibility: ContentVisibilitySchema,
  artifacts: Type.Array(Artifact),
  runs: Type.Array(PocRun),
  createdBy: ActorSummary,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  revision: RevisionField,
});

export type Poc = Static<typeof Poc>;

export const CreatePocRequest = Type.Object({
  findingId: Uuid,
  title: ShortText,
  instructionsMarkdown: Markdown,
  preconditionsMarkdown: Type.Optional(Markdown),
  expectedResultMarkdown: Type.Optional(Markdown),
  visibility: ContentVisibilitySchema,
  testedAssetId: Type.Optional(Uuid),
  testedVersion: Type.Optional(Type.String({ maxLength: 120 })),
  artifactIds: Type.Optional(Type.Array(Uuid)),
});

export type CreatePocRequest = Static<typeof CreatePocRequest>;

export const UpdatePocRequest = Type.Object({
  title: Type.Optional(ShortText),
  instructionsMarkdown: Type.Optional(Markdown),
  preconditionsMarkdown: Type.Optional(Type.Union([Markdown, Type.Null()])),
  expectedResultMarkdown: Type.Optional(Type.Union([Markdown, Type.Null()])),
  status: Type.Optional(PocStatusSchema),
  visibility: Type.Optional(ContentVisibilitySchema),
  testedAssetId: Type.Optional(Type.Union([Uuid, Type.Null()])),
  testedVersion: Type.Optional(
    Type.Union([Type.String({ maxLength: 120 }), Type.Null()]),
  ),
  artifactIds: Type.Optional(Type.Array(Uuid)),
  expectedRevision: RevisionField,
});

export type UpdatePocRequest = Static<typeof UpdatePocRequest>;

export const RecordPocRunRequest = Type.Object({
  outcome: Type.Union([
    Type.Literal("SUCCESS"),
    Type.Literal("FAILURE"),
    Type.Literal("PARTIAL"),
  ]),
  notesMarkdown: Type.Optional(Markdown),
  environment: Type.Optional(Type.String({ maxLength: 500 })),
  testedVersion: Type.Optional(Type.String({ maxLength: 120 })),
  ranAt: Type.Optional(Timestamp),
});

export type RecordPocRunRequest = Static<typeof RecordPocRunRequest>;
