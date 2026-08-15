import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";

import type { ContentVisibility } from "@codevault/core";

import { users } from "./auth.js";
import { cases } from "./cases.js";
import {
  createdAt,
  primaryId,
  timestampColumn,
  updatedAt,
} from "./columns.js";

/**
 * AI tables.
 *
 * Every run records what was sent, as a manifest of item identifiers and
 * hashes. Full prompt text is retained only when the workspace policy says to,
 * because a prompt about a restricted case is itself restricted material.
 */

export const aiRuns = pgTable(
  "ai_runs",
  {
    id: primaryId(),
    action: text("action").notNull(),
    targetType: text("target_type")
      .$type<"FINDING" | "SCORE" | "CLAIM" | "REPORT_SECTION">()
      .notNull(),
    targetId: uuid("target_id").notNull(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    providerVersion: text("provider_version"),
    status: text("status")
      .$type<"PREPARED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED">()
      .notNull()
      .default("PREPARED"),
    /** What was sent, as `{kind, id, label, visibility, sha256, length}`. */
    contextManifest: jsonb("context_manifest")
      .$type<
        {
          kind: string;
          id: string;
          label: string;
          visibility: ContentVisibility;
          sha256: string;
          length: number;
        }[]
      >()
      .notNull()
      .default([]),
    /** Always stored; proves what was sent without storing the text itself. */
    promptSha256: text("prompt_sha256").notNull(),
    /** Retained only when the provider policy explicitly allows it. */
    promptText: text("prompt_text"),
    /** Raw provider output, kept for auditing a disputed proposal. */
    rawOutput: text("raw_output"),
    failureReason: text("failure_reason"),
    durationMs: integer("duration_ms"),
    startedBy: uuid("started_by")
      .notNull()
      .references(() => users.id),
    completedAt: timestampColumn("completed_at"),
    createdAt: createdAt(),
  },
  (table) => [
    index("ai_runs_case_idx").on(table.caseId, table.createdAt),
    index("ai_runs_target_idx").on(table.targetType, table.targetId),
  ],
);

/**
 * Proposals.
 *
 * A proposal is the only route from a model to canonical data. It carries the
 * target revision it was computed against, so accepting a stale proposal fails
 * loudly instead of overwriting newer human work.
 */
export const aiProposals = pgTable(
  "ai_proposals",
  {
    id: primaryId(),
    runId: uuid("run_id")
      .notNull()
      .references(() => aiRuns.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    targetType: text("target_type")
      .$type<"FINDING" | "SCORE" | "CLAIM" | "REPORT_SECTION">()
      .notNull(),
    targetId: uuid("target_id").notNull(),
    patch: jsonb("patch")
      .$type<Record<string, unknown>>()
      .notNull(),
    rationaleMarkdown: text("rationale_markdown").notNull(),
    status: text("status")
      .$type<"PENDING" | "ACCEPTED" | "REJECTED">()
      .notNull()
      .default("PENDING"),
    baseRevision: integer("base_revision").notNull(),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestampColumn("reviewed_at"),
    rejectionReason: text("rejection_reason"),
    createdAt: createdAt(),
  },
  (table) => [
    index("ai_proposals_target_idx").on(
      table.targetType,
      table.targetId,
      table.status,
    ),
    index("ai_proposals_run_idx").on(table.runId),
  ],
);

/**
 * Workspace provider policy.
 *
 * Decides which visibilities a provider may ever receive and whether restricted
 * cases may be sent at all. Checked before context is built, not after.
 */
export const aiProviderPolicies = pgTable("ai_provider_policies", {
  providerId: text("provider_id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  allowedVisibility: jsonb("allowed_visibility")
    .$type<ContentVisibility[]>()
    .notNull()
    .default([]),
  allowRestrictedCases: boolean("allow_restricted_cases")
    .notNull()
    .default(false),
  retainFullPrompts: boolean("retain_full_prompts").notNull().default(false),
  updatedBy: uuid("updated_by").references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const aiRunsRelations = relations(aiRuns, ({ one, many }) => ({
  case: one(cases, { fields: [aiRuns.caseId], references: [cases.id] }),
  startedByUser: one(users, {
    fields: [aiRuns.startedBy],
    references: [users.id],
  }),
  proposals: many(aiProposals),
}));

export const aiProposalsRelations = relations(aiProposals, ({ one }) => ({
  run: one(aiRuns, { fields: [aiProposals.runId], references: [aiRuns.id] }),
}));

export type AiRunRow = typeof aiRuns.$inferSelect;
export type AiProposalRow = typeof aiProposals.$inferSelect;
export type AiProviderPolicyRow = typeof aiProviderPolicies.$inferSelect;
