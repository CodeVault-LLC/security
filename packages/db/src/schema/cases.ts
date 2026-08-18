import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { CaseAccess, CaseProfile, CaseStatus } from "@codevault/core";

import { users } from "./auth.js";
import { organizations } from "./organizations.js";
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
 * Research case tables.
 *
 * The case is the unit of access control: membership, policy packs, disclosure
 * state and reports all hang off it, and a restricted case is invisible to
 * anyone not named on it.
 */

export const cases = pgTable(
  "cases",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    /** Human reference such as `CASE-2026-0001`. Never a primary key. */
    ref: text("ref").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    profile: text("profile").$type<CaseProfile>().notNull(),
    status: text("status").$type<CaseStatus>().notNull().default("OPEN"),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    restricted: boolean("restricted").notNull().default(false),
    /** Shows the Disclosure tab for cases that need coordination. */
    disclosureEnabled: boolean("disclosure_enabled").notNull().default(false),
    metadata: metadata(),
    searchVector: searchVector(),
    archivedAt: timestampColumn("archived_at"),
    revision: revision(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("cases_ref_key").on(table.ref),
    index("cases_owner_idx").on(table.ownerId),
    index("cases_status_idx").on(table.status),
    index("cases_organization_idx").on(table.organizationId),
  ],
);

export const caseMembers = pgTable(
  "case_members",
  {
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    access: text("access").$type<CaseAccess>().notNull(),
    addedBy: uuid("added_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.caseId, table.userId] }),
    index("case_members_user_idx").on(table.userId),
  ],
);

export const caseNotes = pgTable(
  "case_notes",
  {
    id: primaryId(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    title: text("title"),
    bodyMarkdown: text("body_markdown").notNull(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    searchVector: searchVector(),
    revision: revision(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("case_notes_case_idx").on(table.caseId)],
);

/** Associates an asset with a case without duplicating the asset record. */
export const caseAssets = pgTable(
  "case_assets",
  {
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.caseId, table.assetId] }),
    index("case_assets_asset_idx").on(table.assetId),
  ],
);

/**
 * Policy packs.
 *
 * Built-in packs are seeded as rows so a deployment can add its own without a
 * code change, while the defaults stay under source control.
 */
export const policyPacks = pgTable(
  "policy_packs",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    profile: text("profile").$type<CaseProfile>().notNull(),
    /** Serialised `PolicyPackRequirements`. */
    requirements: metadata("requirements"),
    builtIn: boolean("built_in").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("policy_packs_profile_idx").on(table.profile)],
);

export const casePolicyPacks = pgTable(
  "case_policy_packs",
  {
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    policyPackId: text("policy_pack_id")
      .notNull()
      .references(() => policyPacks.id),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.caseId, table.policyPackId] })],
);

/**
 * Human-reference sequences.
 *
 * Allocation happens inside the writing transaction with `UPDATE ... RETURNING`
 * so two concurrent creates can never receive `FIND-2026-0007` twice.
 */
export const referenceSequences = pgTable(
  "reference_sequences",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** Zero for flat sequences such as assets and evidence. */
    year: integer("year").notNull(),
    value: integer("value").notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.kind, table.year],
    }),
  ],
);

export const casesRelations = relations(cases, ({ one, many }) => ({
  owner: one(users, { fields: [cases.ownerId], references: [users.id] }),
  members: many(caseMembers),
  notes: many(caseNotes),
  policyPacks: many(casePolicyPacks),
}));

export const caseMembersRelations = relations(caseMembers, ({ one }) => ({
  case: one(cases, { fields: [caseMembers.caseId], references: [cases.id] }),
  user: one(users, { fields: [caseMembers.userId], references: [users.id] }),
}));

export type CaseRow = typeof cases.$inferSelect;
export type NewCaseRow = typeof cases.$inferInsert;
export type CaseMemberRow = typeof caseMembers.$inferSelect;
