import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { UserRole } from "@codevault/core";

import {
  createdAt,
  primaryId,
  timestampColumn,
  updatedAt,
} from "./columns.js";

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
    role: text("role").$type<UserRole>().notNull().default("MEMBER"),
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

export const invites = pgTable(
  "invites",
  {
    id: primaryId(),
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
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_key").on(table.tokenHash),
    index("sessions_user_id_idx").on(table.userId),
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
}));

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
