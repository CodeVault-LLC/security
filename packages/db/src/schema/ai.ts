import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";

import type { ContentVisibility } from "@codevault/core";

import { users } from "./auth.js";
import { cases } from "./cases.js";
import { createdAt, primaryId, timestampColumn, updatedAt } from "./columns.js";

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
    /** Version of the command-line tool, not of the model. */
    providerVersion: text("provider_version"),
    /**
     * The model and reasoning depth the run was prepared with.
     *
     * Null on runs recorded before profiles existed; an unknown model on a
     * historical run is the honest value, not a guess at the default.
     */
    model: text("model"),
    effort: text("effort").$type<
      "low" | "medium" | "high" | "xhigh" | "max" | null
    >(),
    /** Reported by the provider once the run finishes. */
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
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
    patch: jsonb("patch").$type<Record<string, unknown>>().notNull(),
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
 * Decides which visibilities a provider may ever receive, whether restricted
 * cases may be sent at all, and how a run is executed. Checked before context
 * is built, not after.
 *
 * Every allow-list defaults to empty, and an empty allow-list disables rather
 * than permits. Forgetting to configure something must not be the same as
 * approving it.
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
  /** Models this provider may run. Empty means no run can be prepared. */
  allowedModels: jsonb("allowed_models")
    .$type<string[]>()
    .notNull()
    .default([]),
  /** Effort levels a researcher may select. Empty means no run can be prepared. */
  allowedEfforts: jsonb("allowed_efforts")
    .$type<string[]>()
    .notNull()
    .default([]),
  defaultModel: text("default_model"),
  /** Settings scopes the provider may load. Ignored when isolated. */
  settingSources: jsonb("setting_sources")
    .$type<string[]>()
    .notNull()
    .default(["user"]),
  /**
   * Run with no hooks, plugins or project-file discovery.
   *
   * Off by default because it requires API-key authentication: an isolated
   * provider never reads OAuth credentials or the keychain, so turning it on
   * for a workspace signed in with a subscription would disable AI entirely.
   */
  isolated: boolean("isolated").notNull().default(false),
  maxBudgetUsd: numeric("max_budget_usd", { precision: 8, scale: 4 }),
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
