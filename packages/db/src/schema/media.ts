import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth.js";
import { createdAt, primaryId, timestampColumn, updatedAt } from "./columns.js";
import { organizations } from "./organizations.js";

export type AvatarStatus =
  | "AWAITING_UPLOAD"
  | "QUARANTINED"
  | "PROCESSING"
  | "READY"
  | "REJECTED"
  | "SUPERSEDED";
export type AvatarTarget = "ORGANIZATION" | "USER";
export type MediaJobPurpose =
  "AVATAR_SANITIZE" | "ARTIFACT_INTEGRITY" | "ARTIFACT_PREVIEW";
export type MediaJobState = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";

export const avatarImages = pgTable(
  "avatar_images",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    target: text("target").$type<AvatarTarget>().notNull(),
    targetUserId: uuid("target_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    targetOrganizationId: uuid("target_organization_id").references(
      () => organizations.id,
      { onDelete: "cascade" },
    ),
    status: text("status")
      .$type<AvatarStatus>()
      .notNull()
      .default("AWAITING_UPLOAD"),
    originalFilename: text("original_filename").notNull(),
    declaredSizeBytes: bigint("declared_size_bytes", {
      mode: "number",
    }).notNull(),
    declaredSha256: text("declared_sha256").notNull(),
    observedSizeBytes: bigint("observed_size_bytes", { mode: "number" }),
    observedSha256: text("observed_sha256"),
    quarantineObjectKey: text("quarantine_object_key").notNull(),
    sanitizedObjectKey: text("sanitized_object_key"),
    sanitizedSha256: text("sanitized_sha256"),
    width: integer("width"),
    height: integer("height"),
    rejectionCode: text("rejection_code"),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    expiresAt: timestampColumn("expires_at").notNull(),
    readyAt: timestampColumn("ready_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      "avatar_images_target_shape_check",
      sql`(${table.target} = 'USER' AND ${table.targetUserId} IS NOT NULL AND ${table.targetOrganizationId} IS NULL) OR (${table.target} = 'ORGANIZATION' AND ${table.targetUserId} IS NULL AND ${table.targetOrganizationId} IS NOT NULL)`,
    ),
    uniqueIndex("avatar_images_ready_user_key")
      .on(table.targetUserId)
      .where(
        sql`${table.status} = 'READY' AND ${table.targetUserId} IS NOT NULL`,
      ),
    uniqueIndex("avatar_images_ready_organization_key")
      .on(table.targetOrganizationId)
      .where(
        sql`${table.status} = 'READY' AND ${table.targetOrganizationId} IS NOT NULL`,
      ),
    uniqueIndex("avatar_images_quarantine_object_key").on(
      table.quarantineObjectKey,
    ),
    index("avatar_images_organization_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

export const mediaJobs = pgTable(
  "media_jobs",
  {
    id: primaryId(),
    purpose: text("purpose").$type<MediaJobPurpose>().notNull(),
    targetId: uuid("target_id").notNull(),
    state: text("state").$type<MediaJobState>().notNull().default("QUEUED"),
    inputObjectKey: text("input_object_key").notNull(),
    outputObjectKey: text("output_object_key"),
    attemptCount: integer("attempt_count").notNull().default(0),
    leaseOwner: text("lease_owner"),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestampColumn("lease_expires_at"),
    failureCode: text("failure_code"),
    availableAt: timestampColumn("available_at").notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("media_jobs_active_target_key")
      .on(table.purpose, table.targetId)
      .where(sql`${table.state} IN ('QUEUED', 'RUNNING')`),
    index("media_jobs_claim_idx").on(table.state, table.availableAt),
    check(
      "media_jobs_attempt_count_check",
      sql`${table.attemptCount} BETWEEN 0 AND 3`,
    ),
  ],
);

export type AvatarImageRow = typeof avatarImages.$inferSelect;
export type MediaJobRow = typeof mediaJobs.$inferSelect;
