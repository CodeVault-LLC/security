import { relations } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { ContentVisibility, DisclosureEventType } from "@codevault/core";

import { users } from "./auth.js";
import { cases } from "./cases.js";
import {
  createdAt,
  primaryId,
  revision,
  timestampColumn,
  updatedAt,
} from "./columns.js";
import { findings } from "./findings.js";

/**
 * Disclosure coordination tables.
 *
 * The timeline is structured events rather than prose, so the same history can
 * be rendered into a vendor report and a public advisory without anyone
 * retyping dates that then disagree with each other.
 */

export const stakeholders = pgTable(
  "stakeholders",
  {
    id: primaryId(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    organisation: text("organisation"),
    role: text("role")
      .$type<
        | "VENDOR_SECURITY"
        | "VENDOR_ENGINEERING"
        | "CNA"
        | "CERT"
        | "PROGRAM"
        | "OTHER"
      >()
      .notNull(),
    email: text("email"),
    /** PGP fingerprint or other secure-channel detail. */
    secureChannel: text("secure_channel"),
    notes: text("notes"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("stakeholders_case_idx").on(table.caseId)],
);

export const disclosureEvents = pgTable(
  "disclosure_events",
  {
    id: primaryId(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    findingId: uuid("finding_id").references(() => findings.id, {
      onDelete: "set null",
    }),
    type: text("type").$type<DisclosureEventType>().notNull(),
    /** Required for CUSTOM events; a display override elsewhere. */
    label: text("label"),
    occurredAt: timestampColumn("occurred_at").notNull(),
    detailMarkdown: text("detail_markdown"),
    stakeholderId: uuid("stakeholder_id").references(() => stakeholders.id, {
      onDelete: "set null",
    }),
    /** Correspondence attached as proof of this step. */
    artifactIds: jsonb("artifact_ids").$type<string[]>().notNull().default([]),
    visibility: text("visibility")
      .$type<ContentVisibility>()
      .notNull()
      .default("INTERNAL"),
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    index("disclosure_events_case_idx").on(table.caseId, table.occurredAt),
    index("disclosure_events_finding_idx").on(table.findingId),
  ],
);

export const embargoes = pgTable(
  "embargoes",
  {
    id: primaryId(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    startsAt: timestampColumn("starts_at"),
    endsAt: timestampColumn("ends_at"),
    plannedDisclosureAt: timestampColumn("planned_disclosure_at"),
    expectedResponseAt: timestampColumn("expected_response_at"),
    agreementNote: text("agreement_note"),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id),
    revision: revision(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // One embargo per case; changes are recorded as audit events, not new rows.
  (table) => [uniqueIndex("embargoes_case_key").on(table.caseId)],
);

export const stakeholdersRelations = relations(stakeholders, ({ one }) => ({
  case: one(cases, { fields: [stakeholders.caseId], references: [cases.id] }),
}));

export const disclosureEventsRelations = relations(
  disclosureEvents,
  ({ one }) => ({
    case: one(cases, {
      fields: [disclosureEvents.caseId],
      references: [cases.id],
    }),
    stakeholder: one(stakeholders, {
      fields: [disclosureEvents.stakeholderId],
      references: [stakeholders.id],
    }),
  }),
);

export type StakeholderRow = typeof stakeholders.$inferSelect;
export type DisclosureEventRow = typeof disclosureEvents.$inferSelect;
export type EmbargoRow = typeof embargoes.$inferSelect;
