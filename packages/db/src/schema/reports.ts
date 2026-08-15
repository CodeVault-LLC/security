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

import type {
  ContentVisibility,
  ReportAudience,
  ReviewState,
} from "@codevault/core";
import type { TlpLabel } from "@codevault/standards";

import { artifacts } from "./evidence.js";
import { users } from "./auth.js";
import { cases } from "./cases.js";
import {
  createdAt,
  metadata,
  primaryId,
  revision,
  searchVector,
  timestampColumn,
  updatedAt,
} from "./columns.js";

/**
 * Report tables.
 *
 * Reports are projections of a case, not copies of it. A section holds the
 * Markdown a human approved plus the identifiers of the facts it relies on, so
 * that when one of those facts changes the section can be flagged for review
 * rather than quietly rewritten.
 */

export const reportTemplates = pgTable(
  "report_templates",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    audience: text("audience").$type<ReportAudience>().notNull(),
    defaultTlp: text("default_tlp").$type<TlpLabel>().notNull(),
    visibilityCeiling: text("visibility_ceiling")
      .$type<ContentVisibility>()
      .notNull(),
    /** Ordered section definitions, including prompts and required flags. */
    sections: jsonb("sections")
      .$type<
        {
          key: string;
          title: string;
          required: boolean;
          promptPurpose: string;
        }[]
      >()
      .notNull()
      .default([]),
    /** Version stamped onto every export produced from this template. */
    version: text("version").notNull(),
    builtIn: boolean("built_in").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("report_templates_audience_idx").on(table.audience)],
);

export const reports = pgTable(
  "reports",
  {
    id: primaryId(),
    ref: text("ref").notNull(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    audience: text("audience").$type<ReportAudience>().notNull(),
    templateId: text("template_id")
      .notNull()
      .references(() => reportTemplates.id),
    title: text("title").notNull(),
    tlp: text("tlp").$type<TlpLabel>().notNull(),
    visibilityCeiling: text("visibility_ceiling")
      .$type<ContentVisibility>()
      .notNull(),
    status: text("status")
      .$type<"DRAFT" | "IN_REVIEW" | "APPROVED" | "PUBLISHED">()
      .notNull()
      .default("DRAFT"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    revision: revision(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("reports_ref_key").on(table.ref),
    // One report per audience per case: the three tabs are the three reports.
    uniqueIndex("reports_case_audience_key").on(table.caseId, table.audience),
  ],
);

export const reportSections = pgTable(
  "report_sections",
  {
    id: primaryId(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    position: integer("position").notNull(),
    required: boolean("required").notNull().default(false),
    contentMarkdown: text("content_markdown").notNull().default(""),
    reviewState: text("review_state")
      .$type<ReviewState>()
      .notNull()
      .default("NOT_WRITTEN"),
    promptPurpose: text("prompt_purpose"),
    /**
     * Identifiers of the records this section's content depends on, such as
     * `finding:<id>` or `score:<id>`. Used to invalidate approval when a
     * source fact changes.
     */
    sourceRefs: jsonb("source_refs").$type<string[]>().notNull().default([]),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestampColumn("approved_at"),
    approvedRevision: integer("approved_revision"),
    lastEditedBy: uuid("last_edited_by").references(() => users.id),
    searchVector: searchVector(),
    revision: revision(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("report_sections_key").on(table.reportId, table.key),
    index("report_sections_report_idx").on(table.reportId, table.position),
  ],
);

/** Immutable history: every save writes one row and never edits an old one. */
export const reportRevisions = pgTable(
  "report_revisions",
  {
    id: primaryId(),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => reportSections.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    contentMarkdown: text("content_markdown").notNull(),
    reviewState: text("review_state").$type<ReviewState>().notNull(),
    authoredBy: uuid("authored_by")
      .notNull()
      .references(() => users.id),
    /** Set when this revision came from an accepted AI proposal. */
    aiRunId: uuid("ai_run_id"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("report_revisions_unique").on(table.sectionId, table.revision),
  ],
);

export const reportApprovals = pgTable(
  "report_approvals",
  {
    id: primaryId(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    approvedBy: uuid("approved_by")
      .notNull()
      .references(() => users.id),
    /** Report revision that was approved, so approval cannot drift silently. */
    approvedRevision: integer("approved_revision").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (table) => [index("report_approvals_report_idx").on(table.reportId)],
);

export const reportExports = pgTable(
  "report_exports",
  {
    id: primaryId(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    format: text("format").$type<"PDF" | "MARKDOWN">().notNull(),
    status: text("status")
      .$type<"QUEUED" | "RUNNING" | "COMPLETED" | "FAILED">()
      .notNull()
      .default("QUEUED"),
    /** The immutable snapshot; exports are artifacts like any other file. */
    artifactId: uuid("artifact_id").references(() => artifacts.id, {
      onDelete: "set null",
    }),
    sha256: text("sha256"),
    tlp: text("tlp").$type<TlpLabel>().notNull(),
    templateVersion: text("template_version").notNull(),
    /** Lint result at export time, retained as part of the record. */
    lintResult: metadata("lint_result"),
    failureReason: text("failure_reason"),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    completedAt: timestampColumn("completed_at"),
    createdAt: createdAt(),
  },
  (table) => [index("report_exports_report_idx").on(table.reportId)],
);

export const reportsRelations = relations(reports, ({ one, many }) => ({
  case: one(cases, { fields: [reports.caseId], references: [cases.id] }),
  template: one(reportTemplates, {
    fields: [reports.templateId],
    references: [reportTemplates.id],
  }),
  sections: many(reportSections),
  approvals: many(reportApprovals),
  exports: many(reportExports),
}));

export const reportSectionsRelations = relations(
  reportSections,
  ({ one, many }) => ({
    report: one(reports, {
      fields: [reportSections.reportId],
      references: [reports.id],
    }),
    revisions: many(reportRevisions),
  }),
);

export type ReportRow = typeof reports.$inferSelect;
export type ReportSectionRow = typeof reportSections.$inferSelect;
export type ReportExportRow = typeof reportExports.$inferSelect;
export type ReportTemplateRow = typeof reportTemplates.$inferSelect;
