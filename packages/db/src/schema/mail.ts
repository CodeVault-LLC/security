import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth.js";
import {
  createdAt,
  primaryId,
  revision,
  timestampColumn,
  updatedAt,
} from "./columns.js";

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
  fromDriver(value) {
    return new Uint8Array(value);
  },
  toDriver(value) {
    return Buffer.from(value);
  },
});

export const mailboxConnections = pgTable(
  "mailbox_connections",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").$type<"gmail" | "outlook" | "smtp">().notNull(),
    externalAccountId: text("external_account_id").notNull(),
    emailAddress: text("email_address").notNull(),
    capabilities: jsonb("capabilities")
      .$type<("SEND" | "TRACK_REPLIES")[]>()
      .notNull()
      .default([]),
    grantedScopes: jsonb("granted_scopes")
      .$type<string[]>()
      .notNull()
      .default([]),
    status: text("status")
      .$type<"ACTIVE" | "REAUTH_REQUIRED" | "WATCH_EXPIRED" | "ERROR">()
      .notNull()
      .default("ACTIVE"),
    refreshTokenCiphertext: bytea("refresh_token_ciphertext").notNull(),
    refreshTokenNonce: bytea("refresh_token_nonce").notNull(),
    refreshTokenAuthTag: bytea("refresh_token_auth_tag").notNull(),
    tokenKeyVersion: integer("token_key_version").notNull(),
    historyId: text("history_id"),
    watchExpiresAt: timestampColumn("watch_expires_at"),
    lastSuccessfulSyncAt: timestampColumn("last_successful_sync_at"),
    lastErrorCategory: text("last_error_category"),
    lastErrorAt: timestampColumn("last_error_at"),
    revision: revision(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("mailbox_connections_provider_account_key").on(
      table.provider,
      table.externalAccountId,
    ),
    index("mailbox_connections_user_idx").on(table.userId, table.provider),
    index("mailbox_connections_watch_idx").on(table.watchExpiresAt),
  ],
);

/** Minimal append-only facts from push/reconciliation, never mailbox content. */
export const mailboxSyncEvents = pgTable(
  "mailbox_sync_events",
  {
    id: primaryId(),
    mailboxConnectionId: uuid("mailbox_connection_id")
      .notNull()
      .references(() => mailboxConnections.id, { onDelete: "cascade" }),
    notificationId: text("notification_id"),
    emailAddressHash: text("email_address_hash"),
    historyId: text("history_id"),
    outcome: text("outcome")
      .$type<"ENQUEUED" | "DUPLICATE" | "PROCESSED" | "REJECTED" | "FAILED">()
      .notNull(),
    errorCategory: text("error_category"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("mailbox_sync_events_notification_key").on(
      table.mailboxConnectionId,
      table.notificationId,
    ),
    index("mailbox_sync_events_connection_idx").on(
      table.mailboxConnectionId,
      table.createdAt,
    ),
  ],
);

/** One-time OAuth transactions. PKCE verifiers are encrypted at rest. */
export const mailOauthStates = pgTable(
  "mail_oauth_states",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").$type<"gmail">().notNull(),
    capabilities: jsonb("capabilities")
      .$type<("SEND" | "TRACK_REPLIES")[]>()
      .notNull(),
    verifierCiphertext: bytea("verifier_ciphertext").notNull(),
    verifierNonce: bytea("verifier_nonce").notNull(),
    verifierAuthTag: bytea("verifier_auth_tag").notNull(),
    keyVersion: integer("key_version").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    expiresAt: timestampColumn("expires_at").notNull(),
    consumedAt: timestampColumn("consumed_at"),
    createdAt: createdAt(),
  },
  (table) => [index("mail_oauth_states_expiry_idx").on(table.expiresAt)],
);

export type MailboxConnectionRow = typeof mailboxConnections.$inferSelect;
export type NewMailboxConnectionRow = typeof mailboxConnections.$inferInsert;
export type MailboxSyncEventRow = typeof mailboxSyncEvents.$inferSelect;
export type MailOauthStateRow = typeof mailOauthStates.$inferSelect;
