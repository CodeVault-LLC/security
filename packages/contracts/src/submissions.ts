import { Type, type Static } from "@sinclair/typebox";

import {
  ActorSummary,
  ContentVisibilitySchema,
  CoordinationStateSchema,
  CryptoModeSchema,
  MailSubject,
  Markdown,
  MessageClassificationSchema,
  RevisionField,
  Sha256,
  SubmissionStatusSchema,
  Timestamp,
  Uuid,
} from "./common.js";
import { CreateVendorRouteRequest, VendorSummary } from "./vendors.js";

export const SUBMISSION_VALIDATION_SEVERITIES = [
  "BLOCKING",
  "WARNING",
  "INFO",
] as const;

const SubmissionValidationSeveritySchema = Type.Union(
  SUBMISSION_VALIDATION_SEVERITIES.map((value) => Type.Literal(value)),
);

export const SubmissionValidationFinding = Type.Object(
  {
    severity: SubmissionValidationSeveritySchema,
    code: Type.String({ pattern: "^[A-Z][A-Z0-9_]{2,79}$" }),
    field: Type.Union([
      Type.String({ minLength: 1, maxLength: 200 }),
      Type.Null(),
    ]),
    message: Type.String({ minLength: 1, maxLength: 1_000 }),
  },
  { additionalProperties: false },
);

export type SubmissionValidationFinding = Static<
  typeof SubmissionValidationFinding
>;

export const SubmissionAttachment = Type.Object(
  {
    artifactId: Uuid,
    filename: Type.String({ minLength: 1, maxLength: 300 }),
    mimeType: Type.String({ minLength: 1, maxLength: 200 }),
    visibility: ContentVisibilitySchema,
    status: Type.Union([
      Type.Literal("STORED"),
      Type.Literal("QUARANTINED"),
      Type.Literal("DELETED"),
    ]),
    sizeBytes: Type.Integer({ minimum: 0 }),
    sha256: Sha256,
    sourceRevision: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);

export type SubmissionAttachment = Static<typeof SubmissionAttachment>;

export const SubmissionRouteSnapshot = Type.Object(
  {
    routeId: Uuid,
    routeRevision: RevisionField,
    vendorId: Uuid,
    capturedAt: Timestamp,
    route: CreateVendorRouteRequest,
  },
  { additionalProperties: false },
);

export type SubmissionRouteSnapshot = Static<typeof SubmissionRouteSnapshot>;

export const SubmissionSummary = Type.Object({
  id: Uuid,
  ref: Type.String({ minLength: 3, maxLength: 32 }),
  caseId: Uuid,
  vendor: VendorSummary,
  routeId: Uuid,
  status: SubmissionStatusSchema,
  coordinationState: CoordinationStateSchema,
  cryptoMode: CryptoModeSchema,
  subject: MailSubject,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  revision: RevisionField,
});

export type SubmissionSummary = Static<typeof SubmissionSummary>;

export const SubmissionApproval = Type.Object({
  id: Uuid,
  submissionRevision: RevisionField,
  approvedBy: ActorSummary,
  approvedAt: Timestamp,
  note: Type.Union([Type.String({ maxLength: 1_000 }), Type.Null()]),
});

export const SubmissionDetail = Type.Object({
  ...SubmissionSummary.properties,
  routeSnapshot: SubmissionRouteSnapshot,
  bodyMarkdown: Markdown,
  reportExportId: Type.Union([Uuid, Type.Null()]),
  manualFields: Type.Record(
    Type.String({ pattern: "^[a-z][a-z0-9_]*$" }),
    Type.String({ maxLength: 200_000 }),
  ),
  attachments: Type.Array(SubmissionAttachment),
  currentApproval: Type.Union([SubmissionApproval, Type.Null()]),
  plannedNextContactAt: Type.Union([Timestamp, Type.Null()]),
  agreedDisclosureAt: Type.Union([Timestamp, Type.Null()]),
  vendorReference: Type.Union([Type.String({ maxLength: 300 }), Type.Null()]),
  latestPackage: Type.Union([
    Type.Object(
      {
        id: Uuid,
        manifestSha256: Sha256,
        packageSha256: Sha256,
        sizeBytes: Type.Integer({ minimum: 1 }),
        createdAt: Timestamp,
      },
      { additionalProperties: false },
    ),
    Type.Null(),
  ]),
});

export type SubmissionDetail = Static<typeof SubmissionDetail>;

export const CreateSubmissionRequest = Type.Object(
  {
    vendorId: Uuid,
    routeId: Uuid,
    cryptoMode: CryptoModeSchema,
  },
  { additionalProperties: false },
);

export type CreateSubmissionRequest = Static<typeof CreateSubmissionRequest>;

export const UpdateSubmissionRequest = Type.Object(
  {
    subject: Type.Optional(MailSubject),
    bodyMarkdown: Type.Optional(Markdown),
    manualFields: Type.Optional(
      Type.Record(
        Type.String({ pattern: "^[a-z][a-z0-9_]*$" }),
        Type.String({ maxLength: 200_000 }),
      ),
    ),
    cryptoMode: Type.Optional(CryptoModeSchema),
    expectedRevision: RevisionField,
  },
  { additionalProperties: false },
);

export type UpdateSubmissionRequest = Static<typeof UpdateSubmissionRequest>;

export const SetSubmissionAttachmentsRequest = Type.Object(
  {
    artifactIds: Type.Array(Uuid, { maxItems: 100, uniqueItems: true }),
    reportExportId: Type.Union([Uuid, Type.Null()]),
    expectedRevision: RevisionField,
  },
  { additionalProperties: false },
);

export type SetSubmissionAttachmentsRequest = Static<
  typeof SetSubmissionAttachmentsRequest
>;

export const ReviewSubmissionRequest = Type.Object(
  { expectedRevision: RevisionField },
  { additionalProperties: false },
);

export const ApproveSubmissionRequest = Type.Object(
  {
    expectedRevision: RevisionField,
    note: Type.Optional(Type.String({ maxLength: 1_000 })),
  },
  { additionalProperties: false },
);

export const PackageSourceReference = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("SUBMISSION"),
      Type.Literal("REPORT_EXPORT"),
      Type.Literal("ARTIFACT"),
      Type.Literal("VENDOR_ROUTE"),
      Type.Literal("VENDOR_KEY"),
    ]),
    id: Uuid,
    revision: Type.Union([RevisionField, Type.Null()]),
    sha256: Type.Union([Sha256, Type.Null()]),
  },
  { additionalProperties: false },
);

export const SubmissionPackageManifest = Type.Object(
  {
    version: Type.Literal(1),
    submissionId: Uuid,
    submissionRevision: RevisionField,
    routeSnapshot: SubmissionRouteSnapshot,
    subject: MailSubject,
    bodyUtf8Sha256: Sha256,
    attachments: Type.Array(SubmissionAttachment),
    cryptoMode: CryptoModeSchema,
    publicKeyFingerprint: Type.Union([
      Type.String({ pattern: "^(?:[0-9A-F]{40}|[0-9A-F]{64})$" }),
      Type.Null(),
    ]),
    sources: Type.Array(PackageSourceReference),
    createdAt: Timestamp,
  },
  { additionalProperties: false },
);

export type SubmissionPackageManifest = Static<
  typeof SubmissionPackageManifest
>;

export const SubmissionSealIntent = Type.Object(
  {
    id: Uuid,
    submissionId: Uuid,
    expiresAt: Timestamp,
    subject: MailSubject,
    bodyText: Type.String({ maxLength: 500_000 }),
    manualFields: Type.Record(Type.String(), Type.String()),
    attachments: Type.Array(
      Type.Object({
        ...SubmissionAttachment.properties,
        downloadUrl: Type.String({ minLength: 1, maxLength: 4_096 }),
      }),
    ),
    cryptoMode: CryptoModeSchema,
    publicKey: Type.Union([
      Type.Object({
        armoredKey: Type.String({ maxLength: 2_000_000 }),
        fingerprint: Type.String({
          pattern: "^(?:[0-9A-F]{40}|[0-9A-F]{64})$",
        }),
      }),
      Type.Null(),
    ]),
    manifest: SubmissionPackageManifest,
    manifestSha256: Sha256,
    uploadUrl: Type.String({ minLength: 1, maxLength: 4_096 }),
  },
  { additionalProperties: false },
);

export type SubmissionSealIntent = Static<typeof SubmissionSealIntent>;

export const CompleteSubmissionSealRequest = Type.Object(
  {
    intentId: Uuid,
    sha256: Sha256,
    sizeBytes: Type.Integer({ minimum: 1, maximum: 100 * 1024 * 1024 }),
    rfcMessageId: Type.Union([
      Type.String({ maxLength: 998, pattern: "^<[^\\r\\n<>]+>$" }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

export const SubmissionPackage = Type.Object({
  id: Uuid,
  submissionId: Uuid,
  manifest: SubmissionPackageManifest,
  manifestSha256: Sha256,
  packageSha256: Sha256,
  sizeBytes: Type.Integer({ minimum: 1 }),
  rfcMessageId: Type.Union([Type.String(), Type.Null()]),
  createdBy: ActorSummary,
  createdAt: Timestamp,
});

export type SubmissionPackage = Static<typeof SubmissionPackage>;

export const SubmissionValidationResult = Type.Object({
  submissionId: Uuid,
  revision: RevisionField,
  findings: Type.Array(SubmissionValidationFinding),
  blocking: Type.Boolean(),
  checkedAt: Timestamp,
});

export type SubmissionValidationResult = Static<
  typeof SubmissionValidationResult
>;

export const RecordManualDeliveryRequest = Type.Object(
  {
    packageId: Uuid,
    deliveredAt: Timestamp,
    destinationUrl: Type.String({ maxLength: 2_048 }),
    externalReference: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);

export const CORRESPONDENCE_DIRECTIONS = ["OUTBOUND", "INBOUND"] as const;

const CorrespondenceDirectionSchema = Type.Union(
  CORRESPONDENCE_DIRECTIONS.map((value) => Type.Literal(value)),
);

export const CorrespondenceMessage = Type.Object(
  {
    id: Uuid,
    submissionId: Uuid,
    direction: CorrespondenceDirectionSchema,
    providerMessageId: Type.Union([
      Type.String({ maxLength: 500 }),
      Type.Null(),
    ]),
    providerThreadId: Type.Union([
      Type.String({ maxLength: 500 }),
      Type.Null(),
    ]),
    rfcMessageId: Type.String({ maxLength: 998 }),
    inReplyTo: Type.Union([Type.String({ maxLength: 998 }), Type.Null()]),
    references: Type.Array(Type.String({ maxLength: 998 }), { maxItems: 100 }),
    from: Type.String({ maxLength: 320 }),
    to: Type.Array(Type.String({ maxLength: 320 }), { maxItems: 20 }),
    cc: Type.Array(Type.String({ maxLength: 320 }), { maxItems: 20 }),
    subject: MailSubject,
    bodyText: Type.Union([Type.String({ maxLength: 1_000_000 }), Type.Null()]),
    encrypted: Type.Boolean(),
    classification: MessageClassificationSchema,
    receivedAt: Type.Union([Timestamp, Type.Null()]),
    sentAt: Type.Union([Timestamp, Type.Null()]),
    createdAt: Timestamp,
    revision: RevisionField,
  },
  { additionalProperties: false },
);

export type CorrespondenceMessage = Static<typeof CorrespondenceMessage>;
