import { relations } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  AffectedRangeKind,
  AffectedStatus,
  ClaimSourceType,
  ConfidenceLevel,
  ContentVisibility,
  DisclosureState,
  ExternalIdState,
  PriorArtCheckStatus,
  PriorArtState,
  RemediationState,
  ValidationState,
} from "@codevault/core";
import type { SeverityRating } from "@codevault/standards";

import { assets } from "./assets.js";
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
 * Finding tables.
 *
 * Validation, remediation, disclosure, external identifier and prior-art
 * progress are five independent columns. Collapsing them into one status would
 * make it impossible to express the most common real state of a finding:
 * confirmed, unfixed, under embargo, CVE reserved, prior art unchecked.
 */

export const findings = pgTable(
  "findings",
  {
    id: primaryId(),
    ref: text("ref").notNull(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    title: text("title").notNull(),

    summaryMarkdown: text("summary_markdown"),
    technicalMarkdown: text("technical_markdown"),
    preconditionsMarkdown: text("preconditions_markdown"),
    attackPathMarkdown: text("attack_path_markdown"),
    impactMarkdown: text("impact_markdown"),
    reproductionMarkdown: text("reproduction_markdown"),
    remediationMarkdown: text("remediation_markdown"),
    researcherNotesMarkdown: text("researcher_notes_markdown"),

    validationState: text("validation_state")
      .$type<ValidationState>()
      .notNull()
      .default("DRAFT"),
    remediationState: text("remediation_state")
      .$type<RemediationState>()
      .notNull()
      .default("UNKNOWN"),
    disclosureState: text("disclosure_state")
      .$type<DisclosureState>()
      .notNull()
      .default("PRIVATE"),
    externalIdState: text("external_id_state")
      .$type<ExternalIdState>()
      .notNull()
      .default("NONE"),
    priorArtState: text("prior_art_state")
      .$type<PriorArtState>()
      .notNull()
      .default("UNCHECKED"),

    visibility: text("visibility")
      .$type<ContentVisibility>()
      .notNull()
      .default("INTERNAL"),
    cweIds: jsonb("cwe_ids").$type<string[]>().notNull().default([]),

    /**
     * Denormalised headline severity, derived from the approved score.
     *
     * Kept on the row so list views and dashboards do not join every score
     * record; it is written only by the scoring module.
     */
    severity: text("severity").$type<SeverityRating>(),
    score: doublePrecision("score"),

    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    searchVector: searchVector(),
    revision: revision(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("findings_ref_key").on(table.ref),
    index("findings_case_idx").on(table.caseId),
    index("findings_validation_idx").on(table.validationState),
    index("findings_disclosure_idx").on(table.disclosureState),
    index("findings_prior_art_idx").on(table.priorArtState),
    index("findings_severity_idx").on(table.severity),
  ],
);

export const findingAssets = pgTable(
  "finding_assets",
  {
    findingId: uuid("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    /** At most one primary asset per finding, enforced by a partial index. */
    primary: boolean("primary").notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.findingId, table.assetId] }),
    index("finding_assets_asset_idx").on(table.assetId),
  ],
);

export const affectedRanges = pgTable(
  "affected_ranges",
  {
    id: primaryId(),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    kind: text("kind").$type<AffectedRangeKind>().notNull(),
    /** `1.2.3`, `>=4.0.0 <4.1.7`, or a vendor's own range expression. */
    expression: text("expression").notNull(),
    status: text("status").$type<AffectedStatus>().notNull(),
    fixedIn: text("fixed_in"),
    /** How the conclusion was reached: tested, inferred, or vendor-stated. */
    evidenceNote: text("evidence_note"),
    verifiedAt: timestampColumn("verified_at"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("affected_ranges_finding_idx").on(table.findingId),
    index("affected_ranges_asset_idx").on(table.assetId),
  ],
);

export const findingIdentifiers = pgTable(
  "finding_identifiers",
  {
    id: primaryId(),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),
    scheme: text("scheme").notNull(),
    value: text("value").notNull(),
    url: text("url"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("finding_identifiers_unique").on(
      table.findingId,
      table.scheme,
      table.value,
    ),
    index("finding_identifiers_value_idx").on(table.value),
  ],
);

/**
 * Score records.
 *
 * One table serves CVSS 4.0, CVSS 3.1, EPSS, KEV and anything added later:
 * calculable schemes carry a vector CodeVault scores itself, and intelligence
 * schemes carry a retrieved value with its source and timestamp. The two are
 * never multiplied together into a house risk number.
 */
export const findingScores = pgTable(
  "finding_scores",
  {
    id: primaryId(),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),
    scheme: text("scheme").notNull(),
    vector: text("vector"),
    score: doublePrecision("score"),
    severity: text("severity").$type<SeverityRating>(),
    metrics: metadata("metrics"),
    source: text("source")
      .$type<"HUMAN" | "AI_PROPOSAL" | "EXTERNAL">()
      .notNull(),
    reasoningMarkdown: text("reasoning_markdown"),
    reviewState: text("review_state")
      .$type<"PROPOSED" | "APPROVED" | "SUPERSEDED">()
      .notNull()
      .default("PROPOSED"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestampColumn("reviewed_at"),
    /** Provenance for retrieved intelligence such as EPSS or KEV. */
    sourceName: text("source_name"),
    retrievedAt: timestampColumn("retrieved_at"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    index("finding_scores_finding_idx").on(table.findingId, table.scheme),
    index("finding_scores_review_idx").on(table.reviewState),
  ],
);

export const claims = pgTable(
  "claims",
  {
    id: primaryId(),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),
    /** Stable key such as `vendor.fixed_version` so claims can be looked up. */
    key: text("key").notNull(),
    statementMarkdown: text("statement_markdown").notNull(),
    value: jsonb("value").$type<unknown>(),
    sourceType: text("source_type").$type<ClaimSourceType>().notNull(),
    /** Evidence ID, reference ID, URL or AI run ID, depending on source type. */
    sourceRef: text("source_ref"),
    confidence: text("confidence").$type<ConfidenceLevel>().notNull(),
    visibility: text("visibility").$type<ContentVisibility>().notNull(),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    retrievedAt: timestampColumn("retrieved_at"),
    /** When a retrieved fact should be treated as stale. */
    expiresAt: timestampColumn("expires_at"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("claims_finding_idx").on(table.findingId),
    index("claims_key_idx").on(table.key),
  ],
);

/**
 * External references.
 *
 * Named `external_references` rather than `references` because REFERENCES is
 * reserved in SQL, and a table that must be quoted everywhere is a permanent
 * source of small mistakes.
 */
export const externalReferences = pgTable(
  "external_references",
  {
    id: primaryId(),
    ref: text("ref").notNull(),
    findingId: uuid("finding_id").references(() => findings.id, {
      onDelete: "cascade",
    }),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    url: text("url").notNull(),
    publisher: text("publisher"),
    publishedAt: timestampColumn("published_at"),
    retrievedAt: timestampColumn("retrieved_at"),
    visibility: text("visibility")
      .$type<ContentVisibility>()
      .notNull()
      .default("INTERNAL"),
    note: text("note"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("external_references_ref_key").on(table.ref),
    index("external_references_finding_idx").on(table.findingId),
  ],
);

export const priorArtChecks = pgTable(
  "prior_art_checks",
  {
    id: primaryId(),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<PriorArtCheckStatus>()
      .notNull()
      .default("QUEUED"),
    /** Providers queried, their exact queries, counts and any errors. */
    sourcesChecked: jsonb("sources_checked")
      .$type<
        {
          provider: string;
          queries: string[];
          resultCount: number;
          error: string | null;
          retrievedAt: string | null;
        }[]
      >()
      .notNull()
      .default([]),
    /** Advisory AI synthesis; never the recorded conclusion by itself. */
    analysis: jsonb("analysis").$type<Record<string, unknown> | null>(),
    humanConclusion: text("human_conclusion").$type<PriorArtState>(),
    concludedBy: uuid("concluded_by").references(() => users.id),
    concludedAt: timestampColumn("concluded_at"),
    conclusionNote: text("conclusion_note"),
    failureReason: text("failure_reason"),
    startedBy: uuid("started_by")
      .notNull()
      .references(() => users.id),
    startedAt: createdAt(),
    completedAt: timestampColumn("completed_at"),
  },
  (table) => [
    index("prior_art_checks_finding_idx").on(table.findingId, table.startedAt),
  ],
);

export const priorArtMatches = pgTable(
  "prior_art_matches",
  {
    id: primaryId(),
    checkId: uuid("check_id")
      .notNull()
      .references(() => priorArtChecks.id, { onDelete: "cascade" }),
    origin: text("origin").$type<"INTERNAL" | "EXTERNAL">().notNull(),
    provider: text("provider").notNull(),
    externalId: text("external_id"),
    /** Set when the candidate is another CodeVault finding. */
    matchedFindingId: uuid("matched_finding_id").references(() => findings.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    url: text("url"),
    publisher: text("publisher"),
    publishedAt: timestampColumn("published_at"),
    affectedIdentity: text("affected_identity"),
    summary: text("summary").notNull(),
    /** Exact query text that produced this result, kept for auditability. */
    query: text("query").notNull(),
    retrievedAt: timestampColumn("retrieved_at").notNull(),
    similarity: real("similarity").notNull().default(0),
    aiRelationship: text("ai_relationship").$type<
      "SAME" | "RELATED" | "DIFFERENT"
    >(),
    aiReasoning: text("ai_reasoning"),
    createdAt: createdAt(),
  },
  (table) => [
    index("prior_art_matches_check_idx").on(table.checkId),
    index("prior_art_matches_external_idx").on(table.externalId),
  ],
);

export const findingsRelations = relations(findings, ({ one, many }) => ({
  case: one(cases, { fields: [findings.caseId], references: [cases.id] }),
  owner: one(users, { fields: [findings.ownerId], references: [users.id] }),
  assets: many(findingAssets),
  affectedRanges: many(affectedRanges),
  identifiers: many(findingIdentifiers),
  scores: many(findingScores),
  claims: many(claims),
  references: many(externalReferences),
  priorArtChecks: many(priorArtChecks),
}));

export const findingAssetsRelations = relations(findingAssets, ({ one }) => ({
  finding: one(findings, {
    fields: [findingAssets.findingId],
    references: [findings.id],
  }),
  asset: one(assets, {
    fields: [findingAssets.assetId],
    references: [assets.id],
  }),
}));

export const priorArtChecksRelations = relations(
  priorArtChecks,
  ({ one, many }) => ({
    finding: one(findings, {
      fields: [priorArtChecks.findingId],
      references: [findings.id],
    }),
    matches: many(priorArtMatches),
  }),
);

export const priorArtMatchesRelations = relations(
  priorArtMatches,
  ({ one }) => ({
    check: one(priorArtChecks, {
      fields: [priorArtMatches.checkId],
      references: [priorArtChecks.id],
    }),
  }),
);

export type FindingRow = typeof findings.$inferSelect;
export type NewFindingRow = typeof findings.$inferInsert;
export type FindingScoreRow = typeof findingScores.$inferSelect;
export type ClaimRow = typeof claims.$inferSelect;
export type PriorArtCheckRow = typeof priorArtChecks.$inferSelect;
export type PriorArtMatchRow = typeof priorArtMatches.$inferSelect;
