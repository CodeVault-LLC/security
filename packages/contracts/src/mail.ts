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
