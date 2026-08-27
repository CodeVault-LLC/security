import { Type, type Static } from "@sinclair/typebox";

import { EmailAddress, RevisionField, Timestamp, Uuid } from "./common.js";

export const MAIL_PROVIDER_IDS = ["gmail", "outlook", "smtp"] as const;
export const MAIL_CAPABILITIES = ["SEND", "TRACK_REPLIES"] as const;
export const MAILBOX_CONNECTION_STATUSES = [
  "ACTIVE",
  "REAUTH_REQUIRED",
  "WATCH_EXPIRED",
  "ERROR",
] as const;

const MailProviderIdSchema = Type.Union(
  MAIL_PROVIDER_IDS.map((value) => Type.Literal(value)),
);
const MailCapabilitySchema = Type.Union(
  MAIL_CAPABILITIES.map((value) => Type.Literal(value)),
);
const MailboxConnectionStatusSchema = Type.Union(
  MAILBOX_CONNECTION_STATUSES.map((value) => Type.Literal(value)),
);

export const MailboxConnection = Type.Object(
  {
    id: Uuid,
    provider: MailProviderIdSchema,
    emailAddress: EmailAddress,
    status: MailboxConnectionStatusSchema,
    capabilities: Type.Array(MailCapabilitySchema, {
      maxItems: MAIL_CAPABILITIES.length,
      uniqueItems: true,
    }),
    lastSuccessfulSyncAt: Type.Union([Timestamp, Type.Null()]),
    watchExpiresAt: Type.Union([Timestamp, Type.Null()]),
    errorCategory: Type.Union([
      Type.String({ maxLength: 100, pattern: "^[A-Z0-9_]+$" }),
      Type.Null(),
    ]),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    revision: RevisionField,
  },
  { additionalProperties: false },
);

export type MailboxConnection = Static<typeof MailboxConnection>;

export const StartGmailConnectionRequest = Type.Object(
  {
    enableReplyTracking: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const GmailAuthorization = Type.Object(
  {
    authorizationUrl: Type.String({
      minLength: 1,
      maxLength: 4_096,
      pattern: "^https://",
    }),
    expiresAt: Timestamp,
  },
  { additionalProperties: false },
);

export type GmailAuthorization = Static<typeof GmailAuthorization>;

export const CompleteGmailConnectionRequest = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 4_096 }),
    state: Type.String({ minLength: 32, maxLength: 4_096 }),
  },
  { additionalProperties: false },
);

export const MailProviderMessageMetadata = Type.Object(
  {
    providerMessageId: Type.String({ minLength: 1, maxLength: 500 }),
    providerThreadId: Type.String({ minLength: 1, maxLength: 500 }),
    labelIds: Type.Array(Type.String({ maxLength: 200 }), { maxItems: 100 }),
  },
  { additionalProperties: false },
);

export type MailProviderMessageMetadata = Static<
  typeof MailProviderMessageMetadata
>;

export const MAILBOX_FOLDERS = ["INBOX", "SENT", "TRACKED"] as const;
export const MailboxFolder = Type.Union(
  MAILBOX_FOLDERS.map((value) => Type.Literal(value)),
);
export type MailboxFolder = Static<typeof MailboxFolder>;

export const MailThreadTracking = Type.Object(
  {
    submissionId: Uuid,
    submissionRef: Type.String({ minLength: 1, maxLength: 100 }),
    caseRef: Type.String({ minLength: 1, maxLength: 100 }),
    caseTitle: Type.String({ minLength: 1, maxLength: 500 }),
    vendorName: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { additionalProperties: false },
);
export type MailThreadTracking = Static<typeof MailThreadTracking>;

export const MailThreadSummary = Type.Object(
  {
    providerMessageId: Type.String({ minLength: 1, maxLength: 500 }),
    providerThreadId: Type.String({ minLength: 1, maxLength: 500 }),
    subject: Type.String({ minLength: 1, maxLength: 300 }),
    participants: Type.Array(Type.String({ minLength: 1, maxLength: 998 }), {
      maxItems: 100,
    }),
    occurredAt: Type.Union([Timestamp, Type.Null()]),
    unread: Type.Boolean(),
    tracking: Type.Union([MailThreadTracking, Type.Null()]),
  },
  { additionalProperties: false },
);
export type MailThreadSummary = Static<typeof MailThreadSummary>;

export const MailThreadPage = Type.Object(
  {
    items: Type.Array(MailThreadSummary, { maxItems: 50 }),
    nextPageToken: Type.Union([
      Type.String({ minLength: 1, maxLength: 2_000 }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);
export type MailThreadPage = Static<typeof MailThreadPage>;

export const MailThreadAttachmentPreview = Type.Object(
  {
    filename: Type.String({ minLength: 1, maxLength: 200 }),
    contentType: Type.String({ minLength: 1, maxLength: 200 }),
    sizeBytes: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const MailThreadMessagePreview = Type.Object(
  {
    providerMessageId: Type.String({ minLength: 1, maxLength: 500 }),
    direction: Type.Union([Type.Literal("INBOUND"), Type.Literal("OUTBOUND")]),
    from: Type.String({ minLength: 1, maxLength: 998 }),
    to: Type.Array(EmailAddress, { maxItems: 100 }),
    cc: Type.Array(EmailAddress, { maxItems: 100 }),
    subject: Type.String({ minLength: 1, maxLength: 300 }),
    bodyText: Type.Union([Type.String({ maxLength: 1_000_000 }), Type.Null()]),
    encrypted: Type.Boolean(),
    previewUnavailable: Type.Boolean(),
    occurredAt: Timestamp,
    attachments: Type.Array(MailThreadAttachmentPreview, { maxItems: 100 }),
  },
  { additionalProperties: false },
);
export type MailThreadMessagePreview = Static<typeof MailThreadMessagePreview>;

export const MailThreadDetail = Type.Object(
  {
    mailboxConnectionId: Uuid,
    mailboxAddress: EmailAddress,
    providerThreadId: Type.String({ minLength: 1, maxLength: 500 }),
    subject: Type.String({ minLength: 1, maxLength: 300 }),
    messages: Type.Array(MailThreadMessagePreview, { maxItems: 100 }),
    tooLarge: Type.Boolean(),
    tracking: Type.Union([MailThreadTracking, Type.Null()]),
  },
  { additionalProperties: false },
);
export type MailThreadDetail = Static<typeof MailThreadDetail>;

export const MailTrackingTarget = Type.Object(
  {
    submissionId: Uuid,
    submissionRef: Type.String({ minLength: 1, maxLength: 100 }),
    revision: RevisionField,
    subject: Type.String({ maxLength: 300 }),
    caseRef: Type.String({ minLength: 1, maxLength: 100 }),
    caseTitle: Type.String({ minLength: 1, maxLength: 500 }),
    vendorName: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { additionalProperties: false },
);
export type MailTrackingTarget = Static<typeof MailTrackingTarget>;

export const MailTrackingTargets = Type.Object(
  { items: Type.Array(MailTrackingTarget, { maxItems: 200 }) },
  { additionalProperties: false },
);
export type MailTrackingTargets = Static<typeof MailTrackingTargets>;
