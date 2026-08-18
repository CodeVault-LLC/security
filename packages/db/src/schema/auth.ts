import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { UserRole } from "@codevault/core";

import { createdAt, primaryId, timestampColumn, updatedAt } from "./columns.js";
import { organizations } from "./organizations.js";

/**
 * Authentication tables.
 *
 * Nothing here stores a secret in a recoverable form: passwords are Argon2id
 * hashes, and session and invite tokens exist only as SHA-256 digests. A dump of
 * this schema cannot be used to log in as anyone.
 */

export const users = pgTable(
  "users",
  {
    id: primaryId(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    /** Argon2id encoded hash, including its parameters and salt. */
    passwordHash: text("password_hash").notNull(),
    disabled: boolean("disabled").notNull().default(false),
    lastLoginAt: timestampColumn("last_login_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Emails are compared case-insensitively; the unique index is on the
    // lower-cased form, created in SQL alongside this table.
    uniqueIndex("users_email_key").on(table.email),
  ],
);

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<UserRole>().notNull(),
    joinedAt: timestampColumn("joined_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    uniqueIndex("organization_memberships_user_key").on(table.userId),
  ],
);

export const invites = pgTable(
  "invites",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").$type<UserRole>().notNull(),
    /** SHA-256 of the raw invite token; the raw value is shown once. */
    tokenHash: text("token_hash").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    expiresAt: timestampColumn("expires_at").notNull(),
    acceptedAt: timestampColumn("accepted_at"),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id),
    revokedAt: timestampColumn("revoked_at"),
    revokedBy: uuid("revoked_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("invites_token_hash_key").on(table.tokenHash),
    index("invites_email_idx").on(table.email),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the raw bearer token. Indexed for constant-time lookup. */
    tokenHash: text("token_hash").notNull(),
    /** Free-form client description, e.g. "CodeVault Desktop on linux". */
    userAgent: text("user_agent"),
    expiresAt: timestampColumn("expires_at").notNull(),
    revokedAt: timestampColumn("revoked_at"),
    lastSeenAt: timestampColumn("last_seen_at"),
    mfaVerifiedAt: timestampColumn("mfa_verified_at").notNull(),
    mfaMethod: text("mfa_method").$type<"TOTP">().notNull().default("TOTP"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_key").on(table.tokenHash),
    index("sessions_user_id_idx").on(table.userId),
  ],
);

export const totpCredentials = pgTable("totp_credentials", {
  id: primaryId(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  keyId: text("key_id").notNull(),
  nonce: text("nonce").notNull(),
  ciphertext: text("ciphertext").notNull(),
  authTag: text("auth_tag").notNull(),
  lastAcceptedCounter: bigint("last_accepted_counter", { mode: "number" }),
  enrolledAt: createdAt(),
  replacedAt: timestampColumn("replaced_at"),
});

export const mfaRecoveryCodes = pgTable(
  "mfa_recovery_codes",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    keyId: text("key_id").notNull(),
    digest: text("digest").notNull(),
    usedAt: timestampColumn("used_at"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("mfa_recovery_codes_user_digest_key").on(
      table.userId,
      table.digest,
    ),
    index("mfa_recovery_codes_user_idx").on(table.userId),
  ],
);

export type MfaChallengePurpose =
  "LOGIN" | "MIGRATED_ENROLLMENT" | "STEP_UP" | "RECOVERY";

export const mfaChallenges = pgTable(
  "mfa_challenges",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").$type<MfaChallengePurpose>().notNull(),
    tokenHash: text("token_hash").notNull(),
    sourceKey: text("source_key").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    expiresAt: timestampColumn("expires_at").notNull(),
    consumedAt: timestampColumn("consumed_at"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("mfa_challenges_token_hash_key").on(table.tokenHash),
    index("mfa_challenges_user_idx").on(table.userId, table.createdAt),
  ],
);

export const inviteEnrollments = pgTable(
  "invite_enrollments",
  {
    id: primaryId(),
    inviteId: uuid("invite_id")
      .notNull()
      .unique()
      .references(() => invites.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    keyId: text("key_id").notNull(),
    nonce: text("nonce").notNull(),
    ciphertext: text("ciphertext").notNull(),
    authTag: text("auth_tag").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    expiresAt: timestampColumn("expires_at").notNull(),
    consumedAt: timestampColumn("consumed_at"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("invite_enrollments_token_hash_key").on(table.tokenHash),
  ],
);

export const mfaRecoveryEnrollments = pgTable(
  "mfa_recovery_enrollments",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    keyId: text("key_id").notNull(),
    nonce: text("nonce").notNull(),
    ciphertext: text("ciphertext").notNull(),
    authTag: text("auth_tag").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    expiresAt: timestampColumn("expires_at").notNull(),
    consumedAt: timestampColumn("consumed_at"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("mfa_recovery_enrollments_token_hash_key").on(table.tokenHash),
  ],
);

export const securityNotifications = pgTable(
  "security_notifications",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    details: jsonb("details")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
    occurredAt: createdAt(),
    readAt: timestampColumn("read_at"),
  },
  (table) => [
    index("security_notifications_user_unread_idx").on(
      table.userId,
      table.readAt,
      table.occurredAt,
    ),
  ],
);

/**
 * Login throttling state.
 *
 * Attempts are counted per account and per source so a spray against many
 * accounts is slowed as effectively as a guess against one.
 */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: primaryId(),
    email: text("email").notNull(),
    sourceKey: text("source_key").notNull(),
    successful: boolean("successful").notNull(),
    attemptedAt: createdAt(),
  },
  (table) => [
    index("login_attempts_email_idx").on(table.email, table.attemptedAt),
    index("login_attempts_source_idx").on(table.sourceKey, table.attemptedAt),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  invitesCreated: many(invites),
  memberships: many(organizationMemberships),
}));

export const organizationMembershipsRelations = relations(
  organizationMemberships,
  ({ one }) => ({
    user: one(users, {
      fields: [organizationMemberships.userId],
      references: [users.id],
    }),
    organization: one(organizations, {
      fields: [organizationMemberships.organizationId],
      references: [organizations.id],
    }),
  }),
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const invitesRelations = relations(invites, ({ one }) => ({
  createdByUser: one(users, {
    fields: [invites.createdBy],
    references: [users.id],
  }),
}));

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type InviteRow = typeof invites.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type OrganizationMembershipRow =
  typeof organizationMemberships.$inferSelect;
export type TotpCredentialRow = typeof totpCredentials.$inferSelect;
