import { relations } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  ArtifactKind,
  ContentVisibility,
  PocStatus,
} from "@codevault/core";

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
import { findings } from "./findings.js";

/**
 * Evidence, artifact and proof-of-concept tables.
 *
 * File bytes never enter PostgreSQL. An artifact row is the metadata around an
 * object in storage: its opaque key, its digest, who uploaded it, and what it
 * may be shown to. The original filename is data, never part of a path.
 */

export const artifacts = pgTable(
  "artifacts",
  {
    id: primaryId(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    findingId: uuid("finding_id").references(() => findings.id, {
      onDelete: "set null",
    }),
    /** Attacker-controlled; stored for display only. */
    filename: text("filename").notNull(),
    /** Opaque object-storage key. Never derived from the filename. */
    objectKey: text("object_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    artifactKind: text("artifact_kind").$type<ArtifactKind>().notNull(),
    visibility: text("visibility")
      .$type<ContentVisibility>()
      .notNull()
      .default("INTERNAL"),
    status: text("status")
      .$type<
        | "PENDING"
        | "VERIFYING"
        | "STORED"
        | "QUARANTINED"
        | "REJECTED"
        | "DELETED"
      >()
      .notNull()
      .default("PENDING"),
    /** Multipart upload ID while an upload is in flight. */
    uploadId: text("upload_id"),
    capturedAt: timestampColumn("captured_at"),
    metadata: metadata(),
    /** Result of the safe-preview job, when one could be produced. */
    previewKind: text("preview_kind").$type<
      "IMAGE_THUMBNAIL" | "TEXT_EXCERPT" | "NONE"
    >(),
    previewObjectKey: text("preview_object_key"),
    previewText: text("preview_text"),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    deletedAt: timestampColumn("deleted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("artifacts_object_key_key").on(table.objectKey),
    index("artifacts_case_idx").on(table.caseId),
    index("artifacts_finding_idx").on(table.findingId),
    index("artifacts_sha256_idx").on(table.sha256),
  ],
);

export const artifactPreviewRedactions = pgTable(
  "artifact_preview_redactions",
  {
    artifactId: uuid("artifact_id")
      .primaryKey()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    rules: jsonb("rules")
      .$type<Array<{ match: string; replacement: string }>>()
      .notNull()
      .default([]),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id),
    revision: integer("revision").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
);

export const evidence = pgTable(
  "evidence",
  {
    id: primaryId(),
    ref: text("ref").notNull(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    findingId: uuid("finding_id").references(() => findings.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    descriptionMarkdown: text("description_markdown"),
    visibility: text("visibility")
      .$type<ContentVisibility>()
      .notNull()
      .default("INTERNAL"),
    capturedAt: timestampColumn("captured_at"),
    searchVector: searchVector(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    revision: revision(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("evidence_ref_key").on(table.ref),
    index("evidence_case_idx").on(table.caseId),
    index("evidence_finding_idx").on(table.findingId),
  ],
);

export const evidenceCustodyEvents = pgTable(
  "evidence_custody_events",
  {
    id: primaryId(),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "cascade" }),
    artifactId: uuid("artifact_id").references(() => artifacts.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type")
      .$type<"COLLECTED" | "TRANSFERRED" | "VERIFIED" | "SEALED" | "RELEASED">()
      .notNull(),
    custodian: text("custodian").notNull(),
    note: text("note"),
    occurredAt: timestampColumn("occurred_at").notNull(),
    previousEventHash: text("previous_event_hash"),
    eventHash: text("event_hash").notNull(),
    attestedBy: uuid("attested_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("evidence_custody_events_hash_key").on(table.eventHash),
    index("evidence_custody_events_evidence_idx").on(
      table.evidenceId,
      table.occurredAt,
    ),
  ],
);

export const evidenceArtifacts = pgTable(
  "evidence_artifacts",
  {
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "cascade" }),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.evidenceId, table.artifactId] })],
);

/**
 * Proof-of-concept records.
 *
 * A PoC is instructions, preconditions, an expected result and a verification
 * history — not an attachment and not an execution engine. CodeVault records
 * that a human ran it; it never runs anything itself.
 */
export const pocs = pgTable(
  "pocs",
  {
    id: primaryId(),
    ref: text("ref").notNull(),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    instructionsMarkdown: text("instructions_markdown").notNull(),
    preconditionsMarkdown: text("preconditions_markdown"),
    expectedResultMarkdown: text("expected_result_markdown"),
    status: text("status").$type<PocStatus>().notNull().default("DRAFT"),
    testedAssetId: uuid("tested_asset_id").references(() => assets.id, {
      onDelete: "set null",
    }),
    testedVersion: text("tested_version"),
    lastVerifiedAt: timestampColumn("last_verified_at"),
    visibility: text("visibility")
      .$type<ContentVisibility>()
      .notNull()
      .default("INTERNAL"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    revision: revision(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("pocs_ref_key").on(table.ref),
    index("pocs_finding_idx").on(table.findingId),
  ],
);

export const pocArtifacts = pgTable(
  "poc_artifacts",
  {
    pocId: uuid("poc_id")
      .notNull()
      .references(() => pocs.id, { onDelete: "cascade" }),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.pocId, table.artifactId] })],
);

export const pocRuns = pgTable(
  "poc_runs",
  {
    id: primaryId(),
    pocId: uuid("poc_id")
      .notNull()
      .references(() => pocs.id, { onDelete: "cascade" }),
    outcome: text("outcome")
      .$type<"SUCCESS" | "FAILURE" | "PARTIAL">()
      .notNull(),
    notesMarkdown: text("notes_markdown"),
    environment: text("environment"),
    testedVersion: text("tested_version"),
    ranAt: timestampColumn("ran_at").notNull(),
    ranBy: uuid("ran_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [index("poc_runs_poc_idx").on(table.pocId, table.ranAt)],
);

export const artifactsRelations = relations(artifacts, ({ one }) => ({
  case: one(cases, { fields: [artifacts.caseId], references: [cases.id] }),
  uploader: one(users, {
    fields: [artifacts.uploadedBy],
    references: [users.id],
  }),
}));

export const evidenceRelations = relations(evidence, ({ one, many }) => ({
  case: one(cases, { fields: [evidence.caseId], references: [cases.id] }),
  finding: one(findings, {
    fields: [evidence.findingId],
    references: [findings.id],
  }),
  artifacts: many(evidenceArtifacts),
}));

export const pocsRelations = relations(pocs, ({ one, many }) => ({
  finding: one(findings, {
    fields: [pocs.findingId],
    references: [findings.id],
  }),
  artifacts: many(pocArtifacts),
  runs: many(pocRuns),
}));

export type ArtifactRow = typeof artifacts.$inferSelect;
export type NewArtifactRow = typeof artifacts.$inferInsert;
export type EvidenceRow = typeof evidence.$inferSelect;
export type PocRow = typeof pocs.$inferSelect;
export type PocRunRow = typeof pocRuns.$inferSelect;
