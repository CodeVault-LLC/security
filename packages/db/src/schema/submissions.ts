import { relations } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  ContentVisibility,
  CoordinationState,
  CryptoMode,
  MessageClassification,
  SubmissionStatus,
} from "@codevault/core";

import { aiRuns } from "./ai.js";
import { users } from "./auth.js";
import { cases } from "./cases.js";
import {
  createdAt,
  metadata,
  primaryId,
  revision,
  timestampColumn,
  updatedAt,
} from "./columns.js";
import { artifacts } from "./evidence.js";
import { mailboxConnections } from "./mail.js";
import { reportExports } from "./reports.js";
import { vendorRoutes, vendors } from "./vendors.js";

export interface StoredRouteSnapshot {
  routeId: string;
  routeRevision: number;
  vendorId: string;
  capturedAt: string;
  route: Record<string, unknown>;
}

export const submissions = pgTable(
  "submissions",
  {
    id: primaryId(),
    ref: text("ref").notNull(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    routeId: uuid("route_id")
      .notNull()
      .references(() => vendorRoutes.id),
    routeSnapshot: jsonb("route_snapshot")
      .$type<StoredRouteSnapshot>()
      .notNull(),
    mailboxConnectionId: uuid("mailbox_connection_id").references(
      () => mailboxConnections.id,
      { onDelete: "set null" },
    ),
    reportExportId: uuid("report_export_id").references(
      () => reportExports.id,
      { onDelete: "set null" },
    ),
    status: text("status").$type<SubmissionStatus>().notNull().default("DRAFT"),
    coordinationState: text("coordination_state")
      .$type<CoordinationState>()
      .notNull()
      .default("PREPARING"),
    cryptoMode: text("crypto_mode")
      .$type<CryptoMode>()
      .notNull()
      .default("PLAIN"),
    subject: text("subject").notNull().default(""),
    bodyMarkdown: text("body_markdown").notNull().default(""),
    manualFields: metadata("manual_fields"),
    plannedNextContactAt: timestampColumn("planned_next_contact_at"),
    agreedDisclosureAt: timestampColumn("agreed_disclosure_at"),
    vendorReference: text("vendor_reference"),
    coordinationNotes: text("coordination_notes"),
    snoozedUntil: timestampColumn("snoozed_until"),
    snoozeReason: text("snooze_reason"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    lastEditedBy: uuid("last_edited_by")
      .notNull()
      .references(() => users.id),
    revision: revision(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("submissions_ref_key").on(table.ref),
    index("submissions_case_idx").on(table.caseId, table.createdAt),
    index("submissions_vendor_idx").on(table.vendorId, table.createdAt),
    index("submissions_attention_idx").on(
      table.coordinationState,
      table.plannedNextContactAt,
    ),
  ],
);

export const submissionRevisions = pgTable(
  "submission_revisions",
  {
    id: primaryId(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id),
    revision: integer("revision").notNull(),
    subject: text("subject").notNull(),
    bodyMarkdown: text("body_markdown").notNull(),
    manualFields: metadata("manual_fields"),
    cryptoMode: text("crypto_mode").$type<CryptoMode>().notNull(),
    authoredBy: uuid("authored_by")
      .notNull()
      .references(() => users.id),
    aiRunId: uuid("ai_run_id").references(() => aiRuns.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("submission_revisions_unique").on(
      table.submissionId,
      table.revision,
    ),
  ],
);

export const submissionAttachments = pgTable(
  "submission_attachments",
  {
    id: primaryId(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id),
    position: integer("position").notNull(),
    sourceRevision: integer("source_revision"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("submission_attachments_artifact_key").on(
      table.submissionId,
      table.artifactId,
    ),
    uniqueIndex("submission_attachments_position_key").on(
      table.submissionId,
      table.position,
    ),
  ],
);

export const submissionApprovals = pgTable(
  "submission_approvals",
  {
    id: primaryId(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id),
    submissionRevision: integer("submission_revision").notNull(),
    approvedBy: uuid("approved_by")
      .notNull()
      .references(() => users.id),
    note: text("note"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("submission_approvals_revision_key").on(
      table.submissionId,
      table.submissionRevision,
    ),
  ],
);

/** One-time, short-lived authority to upload one exact package manifest. */
export const submissionSealIntents = pgTable(
  "submission_seal_intents",
  {
    id: primaryId(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id),
    submissionRevision: integer("submission_revision").notNull(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id),
    manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
    manifestSha256: text("manifest_sha256").notNull(),
    expiresAt: timestampColumn("expires_at").notNull(),
    consumedAt: timestampColumn("consumed_at"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    index("submission_seal_intents_submission_idx").on(
      table.submissionId,
      table.createdAt,
    ),
  ],
);

export const submissionPackages = pgTable(
  "submission_packages",
  {
    id: primaryId(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id),
    intentId: uuid("intent_id").notNull(),
    manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
    manifestSha256: text("manifest_sha256").notNull(),
    packageSha256: text("package_sha256").notNull(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    rfcMessageId: text("rfc_message_id"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("submission_packages_intent_key").on(table.intentId),
    uniqueIndex("submission_packages_sha256_key").on(table.packageSha256),
    index("submission_packages_submission_idx").on(
      table.submissionId,
      table.createdAt,
    ),
  ],
);

export const submissionDeliveries = pgTable(
  "submission_deliveries",
  {
    id: primaryId(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id),
    packageId: uuid("package_id")
      .notNull()
      .references(() => submissionPackages.id),
    mailboxConnectionId: uuid("mailbox_connection_id").references(
      () => mailboxConnections.id,
      { onDelete: "set null" },
    ),
    provider: text("provider"),
    status: text("status")
      .$type<
        | "QUEUED"
        | "SENDING"
        | "SENT"
        | "FAILED"
        | "DELIVERY_UNKNOWN"
        | "RECORDED_MANUALLY"
      >()
      .notNull(),
    providerMessageId: text("provider_message_id"),
    providerThreadId: text("provider_thread_id"),
    senderAddress: text("sender_address"),
    recipients: jsonb("recipients")
      .$type<{ to: string[]; cc: string[] }>()
      .notNull()
      .default({ to: [], cc: [] }),
    routeSnapshot: jsonb("route_snapshot")
      .$type<StoredRouteSnapshot>()
      .notNull(),
    sentAt: timestampColumn("sent_at"),
    responseSizeBytes: bigint("response_size_bytes", { mode: "number" }),
    errorCategory: text("error_category"),
    errorMessage: text("error_message"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    revision: revision(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("submission_deliveries_submission_idx").on(
      table.submissionId,
      table.createdAt,
    ),
    index("submission_deliveries_provider_thread_idx").on(
      table.mailboxConnectionId,
      table.providerThreadId,
    ),
  ],
);

export const submissionDeliveryAttempts = pgTable(
  "submission_delivery_attempts",
  {
    id: primaryId(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => submissionDeliveries.id),
    attemptNumber: integer("attempt_number").notNull(),
    outcome: text("outcome")
      .$type<"SENDING" | "SENT" | "FAILED" | "DELIVERY_UNKNOWN">()
      .notNull(),
    providerRequestId: text("provider_request_id"),
    errorCategory: text("error_category"),
    errorMessage: text("error_message"),
    startedAt: timestampColumn("started_at").notNull(),
    completedAt: timestampColumn("completed_at"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("submission_delivery_attempts_number_key").on(
      table.deliveryId,
      table.attemptNumber,
    ),
  ],
);

export const correspondenceMessages = pgTable(
  "correspondence_messages",
  {
    id: primaryId(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id),
    deliveryId: uuid("delivery_id").references(() => submissionDeliveries.id),
    mailboxConnectionId: uuid("mailbox_connection_id").references(
      () => mailboxConnections.id,
      { onDelete: "set null" },
    ),
    direction: text("direction").$type<"OUTBOUND" | "INBOUND">().notNull(),
    providerMessageId: text("provider_message_id"),
    providerThreadId: text("provider_thread_id"),
    rfcMessageId: text("rfc_message_id").notNull(),
    inReplyTo: text("in_reply_to"),
    references: jsonb("references").$type<string[]>().notNull().default([]),
    fromAddress: text("from_address").notNull(),
    toAddresses: jsonb("to_addresses").$type<string[]>().notNull().default([]),
    ccAddresses: jsonb("cc_addresses").$type<string[]>().notNull().default([]),
    subject: text("subject").notNull(),
    bodyText: text("body_text"),
    bodyEncrypted: text("body_encrypted")
      .$type<"PLAIN" | "OPENPGP">()
      .notNull()
      .default("PLAIN"),
    rawArtifactId: uuid("raw_artifact_id")
      .notNull()
      .references(() => artifacts.id),
    classification: text("classification")
      .$type<MessageClassification>()
      .notNull()
      .default("UNREVIEWED"),
    visibility: text("visibility")
      .$type<ContentVisibility>()
      .notNull()
      .default("VENDOR"),
    receivedAt: timestampColumn("received_at"),
    sentAt: timestampColumn("sent_at"),
    reviewedPlaintextSavedAt: timestampColumn("reviewed_plaintext_saved_at"),
    revision: revision(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("correspondence_messages_provider_key").on(
      table.mailboxConnectionId,
      table.providerMessageId,
    ),
    index("correspondence_messages_submission_idx").on(
      table.submissionId,
      table.createdAt,
    ),
    index("correspondence_messages_thread_idx").on(
      table.mailboxConnectionId,
      table.providerThreadId,
    ),
  ],
);

export const submissionsRelations = relations(submissions, ({ one, many }) => ({
  case: one(cases, { fields: [submissions.caseId], references: [cases.id] }),
  vendor: one(vendors, {
    fields: [submissions.vendorId],
    references: [vendors.id],
  }),
  route: one(vendorRoutes, {
    fields: [submissions.routeId],
    references: [vendorRoutes.id],
  }),
  revisions: many(submissionRevisions),
  attachments: many(submissionAttachments),
  approvals: many(submissionApprovals),
  sealIntents: many(submissionSealIntents),
  packages: many(submissionPackages),
  deliveries: many(submissionDeliveries),
  messages: many(correspondenceMessages),
}));

export type SubmissionRow = typeof submissions.$inferSelect;
export type NewSubmissionRow = typeof submissions.$inferInsert;
export type SubmissionPackageRow = typeof submissionPackages.$inferSelect;
export type SubmissionDeliveryRow = typeof submissionDeliveries.$inferSelect;
export type CorrespondenceMessageRow =
  typeof correspondenceMessages.$inferSelect;
