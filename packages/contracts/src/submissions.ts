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
  mailboxConnectionId: Type.Union([Uuid, Type.Null()]),
  replyToMessageId: Type.Union([Uuid, Type.Null()]),
  manualFields: Type.Record(
    Type.String({ pattern: "^[a-z][a-z0-9_]*$" }),
    Type.String({ maxLength: 200_000 }),
  ),
  attachments: Type.Array(SubmissionAttachment),
  currentApproval: Type.Union([SubmissionApproval, Type.Null()]),
  plannedNextContactAt: Type.Union([Timestamp, Type.Null()]),
  agreedDisclosureAt: Type.Union([Timestamp, Type.Null()]),
  vendorReference: Type.Union([Type.String({ maxLength: 300 }), Type.Null()]),
  coordinationNotes: Type.Union([
    Type.String({ maxLength: 20_000 }),
    Type.Null(),
  ]),
  snoozedUntil: Type.Union([Timestamp, Type.Null()]),
  snoozeReason: Type.Union([Type.String({ maxLength: 1_000 }), Type.Null()]),
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

export const UpdateSubmissionLifecycleRequest = Type.Object(
  {
    coordinationState: CoordinationStateSchema,
    plannedNextContactAt: Type.Union([Timestamp, Type.Null()]),
    agreedDisclosureAt: Type.Union([Timestamp, Type.Null()]),
    vendorReference: Type.Union([Type.String({ maxLength: 300 }), Type.Null()]),
    coordinationNotes: Type.Union([
      Type.String({ maxLength: 20_000 }),
      Type.Null(),
    ]),
    snoozedUntil: Type.Union([Timestamp, Type.Null()]),
    snoozeReason: Type.Union([Type.String({ maxLength: 1_000 }), Type.Null()]),
    expectedRevision: RevisionField,
  },
  { additionalProperties: false },
);

export type UpdateSubmissionLifecycleRequest = Static<
  typeof UpdateSubmissionLifecycleRequest
>;

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
    mailboxConnectionId: Type.Optional(Type.Union([Uuid, Type.Null()])),
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
    threading: Type.Union([
      Type.Object(
        {
          providerThreadId: Type.String({ minLength: 1, maxLength: 500 }),
          inReplyTo: Type.String({
            maxLength: 998,
            pattern: "^<[^\\r\\n<>]+>$",
          }),
          references: Type.Array(
            Type.String({ maxLength: 998, pattern: "^<[^\\r\\n<>]+>$" }),
            { maxItems: 100 },
          ),
        },
        { additionalProperties: false },
      ),
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
    senderAddress: Type.Union([Type.String({ maxLength: 320 }), Type.Null()]),
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

export const SubmissionSendIntent = Type.Object(
  {
    submissionId: Uuid,
    packageId: Uuid,
    from: Type.String({ maxLength: 320 }),
    to: Type.Array(Type.String({ maxLength: 320 }), { maxItems: 20 }),
    cc: Type.Array(Type.String({ maxLength: 320 }), { maxItems: 20 }),
    subject: MailSubject,
    bodyText: Type.String({ maxLength: 500_000 }),
    bodyUtf8Sha256: Sha256,
    attachments: Type.Array(SubmissionAttachment),
    cryptoMode: CryptoModeSchema,
    publicKeyFingerprint: Type.Union([
      Type.String({ pattern: "^(?:[0-9A-F]{40}|[0-9A-F]{64})$" }),
      Type.Null(),
    ]),
    packageSha256: Sha256,
    packageSizeBytes: Type.Integer({ minimum: 1 }),
    rfcMessageId: Type.String({ maxLength: 998, pattern: "^<[^\\r\\n<>]+>$" }),
  },
  { additionalProperties: false },
);

export type SubmissionSendIntent = Static<typeof SubmissionSendIntent>;

export const SubmissionDelivery = Type.Object(
  {
    id: Uuid,
    submissionId: Uuid,
    status: Type.Union(
      ["QUEUED", "SENDING", "SENT", "FAILED", "DELIVERY_UNKNOWN"].map((value) =>
        Type.Literal(value),
      ),
    ),
    providerMessageId: Type.Union([
      Type.String({ maxLength: 500 }),
      Type.Null(),
    ]),
    providerThreadId: Type.Union([
      Type.String({ maxLength: 500 }),
      Type.Null(),
    ]),
    errorCategory: Type.Union([Type.String({ maxLength: 100 }), Type.Null()]),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  },
  { additionalProperties: false },
);

export type SubmissionDelivery = Static<typeof SubmissionDelivery>;

export const CreateSubmissionReplyDraftRequest = Type.Object(
  {
    messageId: Type.Optional(Uuid),
    expectedRevision: RevisionField,
  },
  { additionalProperties: false },
);

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
    rawArtifactId: Type.Union([Uuid, Type.Null()]),
    attachments: Type.Array(SubmissionAttachment),
    classification: MessageClassificationSchema,
    receivedAt: Type.Union([Timestamp, Type.Null()]),
    sentAt: Type.Union([Timestamp, Type.Null()]),
    reviewedPlaintextSavedAt: Type.Union([Timestamp, Type.Null()]),
    createdAt: Timestamp,
    revision: RevisionField,
  },
  { additionalProperties: false },
);

export type CorrespondenceMessage = Static<typeof CorrespondenceMessage>;

export const CorrespondenceThread = Type.Object(
  {
    items: Type.Array(CorrespondenceMessage),
    linkedThread: Type.Union([
      Type.Object(
        {
          providerThreadId: Type.String({ minLength: 1, maxLength: 500 }),
          linkedAt: Timestamp,
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    sync: Type.Union([
      Type.Object({
        status: Type.String({ maxLength: 100 }),
        lastSuccessfulSyncAt: Type.Union([Timestamp, Type.Null()]),
        watchExpiresAt: Type.Union([Timestamp, Type.Null()]),
        errorCategory: Type.Union([
          Type.String({ maxLength: 100 }),
          Type.Null(),
        ]),
      }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

export type CorrespondenceThread = Static<typeof CorrespondenceThread>;

export const GmailThreadSearchRequest = Type.Object(
  {
    mailboxConnectionId: Uuid,
    query: Type.String({ minLength: 1, maxLength: 300 }),
  },
  { additionalProperties: false },
);

export const GmailThreadSearchResult = Type.Object(
  {
    providerThreadId: Type.String({ minLength: 1, maxLength: 500 }),
    subject: MailSubject,
    to: Type.Array(Type.String({ maxLength: 998 }), { maxItems: 100 }),
    occurredAt: Type.Union([Timestamp, Type.Null()]),
  },
  { additionalProperties: false },
);

export const GmailThreadSearchResults = Type.Object(
  {
    items: Type.Array(GmailThreadSearchResult, { maxItems: 20 }),
  },
  { additionalProperties: false },
);

export type GmailThreadSearchResults = Static<typeof GmailThreadSearchResults>;

export const GmailThreadReferenceRequest = Type.Object(
  {
    mailboxConnectionId: Uuid,
    threadReference: Type.String({ minLength: 1, maxLength: 2_048 }),
  },
  { additionalProperties: false },
);

export const GmailThreadPreviewMessage = Type.Object(
  {
    providerMessageId: Type.String({ minLength: 1, maxLength: 500 }),
    direction: CorrespondenceDirectionSchema,
    from: Type.String({ minLength: 1, maxLength: 998 }),
    to: Type.Array(Type.String({ maxLength: 998 }), { maxItems: 100 }),
    subject: MailSubject,
    occurredAt: Type.Union([Timestamp, Type.Null()]),
  },
  { additionalProperties: false },
);

export const GmailThreadPreview = Type.Object(
  {
    mailboxConnectionId: Uuid,
    mailboxAddress: Type.String({ minLength: 3, maxLength: 320 }),
    providerThreadId: Type.String({ minLength: 1, maxLength: 500 }),
    subject: MailSubject,
    messages: Type.Array(GmailThreadPreviewMessage, {
      minItems: 1,
      maxItems: 200,
    }),
    warnings: Type.Array(Type.String({ minLength: 1, maxLength: 1_000 }), {
      maxItems: 10,
    }),
  },
  { additionalProperties: false },
);

export type GmailThreadPreview = Static<typeof GmailThreadPreview>;

export const LinkExistingGmailThreadRequest = Type.Object(
  {
    ...GmailThreadReferenceRequest.properties,
    expectedRevision: RevisionField,
  },
  { additionalProperties: false },
);

export const UpdateCorrespondenceClassificationRequest = Type.Object(
  {
    classification: MessageClassificationSchema,
    expectedRevision: RevisionField,
  },
  { additionalProperties: false },
);

export const SaveReviewedPlaintextRequest = Type.Object(
  {
    bodyText: Type.String({ minLength: 1, maxLength: 1_000_000 }),
    expectedRevision: RevisionField,
  },
  { additionalProperties: false },
);

export const CorrespondenceDecryptIntent = Type.Object(
  {
    messageId: Uuid,
    subject: MailSubject,
    from: Type.String({ maxLength: 320 }),
    downloadUrl: Type.String({ minLength: 1, maxLength: 4_096 }),
    sha256: Sha256,
    sizeBytes: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export type CorrespondenceDecryptIntent = Static<
  typeof CorrespondenceDecryptIntent
>;
