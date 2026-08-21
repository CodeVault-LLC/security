import { Type, type Static } from "@sinclair/typebox";

import { Sha256, Uuid } from "./common.js";

export const CaseArchiveArtifactTransfer = Type.Object({
  sourceId: Uuid,
  url: Type.String({ minLength: 1, maxLength: 4_096 }),
  expiresAt: Type.String({ format: "date-time" }),
  filename: Type.String(),
  sizeBytes: Type.Integer({ minimum: 0 }),
  sha256: Sha256,
});
export type CaseArchiveArtifactTransfer = Static<
  typeof CaseArchiveArtifactTransfer
>;

export const CaseArchiveSnapshot = Type.Object({
  manifest: Type.Record(Type.String(), Type.Unknown()),
  records: Type.Record(Type.String(), Type.Unknown()),
  artifacts: Type.Array(CaseArchiveArtifactTransfer),
});
export type CaseArchiveSnapshot = Static<typeof CaseArchiveSnapshot>;

export const PrepareCaseArchiveImportRequest = Type.Object(
  {
    manifest: Type.Record(Type.String(), Type.Unknown()),
    records: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);
export type PrepareCaseArchiveImportRequest = Static<
  typeof PrepareCaseArchiveImportRequest
>;

const ArchiveUpload = Type.Object({
  sourceId: Uuid,
  strategy: Type.Union([Type.Literal("SINGLE"), Type.Literal("MULTIPART")]),
  url: Type.Union([Type.String(), Type.Null()]),
  multipartUploadId: Type.Union([Type.String(), Type.Null()]),
  partSizeBytes: Type.Integer({ minimum: 0 }),
  partUrls: Type.Array(Type.String()),
  requiredHeaders: Type.Record(Type.String(), Type.String()),
  expiresAt: Type.String({ format: "date-time" }),
});

export const PrepareCaseArchiveImportResult = Type.Object({
  importId: Uuid,
  expiresAt: Type.String({ format: "date-time" }),
  uploads: Type.Array(ArchiveUpload),
});
export type PrepareCaseArchiveImportResult = Static<
  typeof PrepareCaseArchiveImportResult
>;

export const CommitCaseArchiveImportRequest = Type.Object({
  uploads: Type.Array(
    Type.Object({
      sourceId: Uuid,
      parts: Type.Array(
        Type.Object({
          partNumber: Type.Integer({ minimum: 1 }),
          etag: Type.String({ minLength: 1, maxLength: 200 }),
        }),
      ),
    }),
    { maxItems: 10_000 },
  ),
});
export type CommitCaseArchiveImportRequest = Static<
  typeof CommitCaseArchiveImportRequest
>;

export const ImportCaseArchiveRequest = Type.Object(
  {
    manifest: Type.Record(Type.String(), Type.Unknown()),
    records: Type.Record(Type.String(), Type.Unknown()),
    artifactMappings: Type.Array(
      Type.Object({ sourceId: Uuid, artifactId: Uuid }),
      { maxItems: 10_000 },
    ),
  },
  { additionalProperties: false },
);
export type ImportCaseArchiveRequest = Static<typeof ImportCaseArchiveRequest>;

export const ImportCaseArchiveResult = Type.Object({
  caseId: Uuid,
  caseRef: Type.String(),
  recordCounts: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
});
export type ImportCaseArchiveResult = Static<typeof ImportCaseArchiveResult>;
