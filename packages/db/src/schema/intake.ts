import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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
import { findings } from "./findings.js";

type IntakeSource = "MANUAL" | "FOLDER_SCAN" | "EXTERNAL_AGENT";
type IntakeItemStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "MERGED";
type IntakeConfidence = "LOW" | "MEDIUM" | "HIGH";
type ScannerSyncFormat = "JSON" | "CSV" | "SARIF";
type ScannerSyncDeduplication = "STAGE_ALL" | "SKIP_MATCHING_TITLES";
type IntakeDraft = {
  title: string;
  summaryMarkdown?: string;
  technicalMarkdown?: string;
  impactMarkdown?: string;
  remediationMarkdown?: string;
  suggestedCweIds: string[];
  affectedVersions: Array<{
    assetLabel: string;
    expression: string;
    evidenceNote?: string;
  }>;
  uncertainties?: string[];
};
type IntakeCitation =
  | {
      kind: "FILE";
      path: string;
      sha256: string;
      startLine?: number;
      endLine?: number;
    }
  | { kind: "ARTIFACT"; artifactId: string; label: string };

export const aiIntakeBatches = pgTable(
  "ai_intake_batches",
  {
    id: primaryId(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    source: text("source").$type<IntakeSource>().notNull(),
    sourceLabel: text("source_label").notNull(),
    runId: uuid("run_id").references(() => aiRuns.id, {
      onDelete: "set null",
    }),
    manifest: metadata("manifest"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    index("ai_intake_batches_case_idx").on(table.caseId, table.createdAt),
    index("ai_intake_batches_run_idx").on(table.runId),
  ],
);

export const scannerSyncProfiles = pgTable(
  "scanner_sync_profiles",
  {
    id: primaryId(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    format: text("format").$type<ScannerSyncFormat>().notNull(),
    sourceLabel: text("source_label").notNull(),
    deduplicationPolicy: text("deduplication_policy")
      .$type<ScannerSyncDeduplication>()
      .notNull(),
    cadenceHours: integer("cadence_hours").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    nextRunAt: timestampColumn("next_run_at").notNull(),
    lastRunAt: timestampColumn("last_run_at"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    revision: revision(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("scanner_sync_profiles_case_name_key").on(
      table.caseId,
      table.name,
    ),
    index("scanner_sync_profiles_due_idx").on(table.enabled, table.nextRunAt),
    index("scanner_sync_profiles_case_idx").on(table.caseId, table.createdAt),
  ],
);

export const aiIntakeItems = pgTable(
  "ai_intake_items",
  {
    id: primaryId(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => aiIntakeBatches.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<IntakeItemStatus>()
      .notNull()
      .default("PENDING"),
    draft: jsonb("draft").$type<IntakeDraft>().notNull(),
    citations: jsonb("citations").$type<IntakeCitation[]>().notNull(),
    confidence: text("confidence").$type<IntakeConfidence>(),
    createdFindingId: uuid("created_finding_id").references(() => findings.id, {
      onDelete: "set null",
    }),
    mergedIntoFindingId: uuid("merged_into_finding_id").references(
      () => findings.id,
      { onDelete: "set null" },
    ),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestampColumn("reviewed_at"),
    rejectionReason: text("rejection_reason"),
    revision: revision(),
    createdAt: createdAt(),
  },
  (table) => [
    index("ai_intake_items_batch_idx").on(table.batchId, table.createdAt),
    index("ai_intake_items_status_idx").on(table.status),
    index("ai_intake_items_created_finding_idx").on(table.createdFindingId),
    index("ai_intake_items_merged_finding_idx").on(table.mergedIntoFindingId),
  ],
);

export const aiIntakeBatchesRelations = relations(
  aiIntakeBatches,
  ({ one, many }) => ({
    researchCase: one(cases, {
      fields: [aiIntakeBatches.caseId],
      references: [cases.id],
    }),
    creator: one(users, {
      fields: [aiIntakeBatches.createdBy],
      references: [users.id],
    }),
    run: one(aiRuns, {
      fields: [aiIntakeBatches.runId],
      references: [aiRuns.id],
    }),
    items: many(aiIntakeItems),
  }),
);

export const aiIntakeItemsRelations = relations(aiIntakeItems, ({ one }) => ({
  batch: one(aiIntakeBatches, {
    fields: [aiIntakeItems.batchId],
    references: [aiIntakeBatches.id],
  }),
  reviewer: one(users, {
    fields: [aiIntakeItems.reviewedBy],
    references: [users.id],
  }),
  createdFinding: one(findings, {
    fields: [aiIntakeItems.createdFindingId],
    references: [findings.id],
    relationName: "intakeCreatedFinding",
  }),
  mergedFinding: one(findings, {
    fields: [aiIntakeItems.mergedIntoFindingId],
    references: [findings.id],
    relationName: "intakeMergedFinding",
  }),
}));
