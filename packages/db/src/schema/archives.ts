import { bigint, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth.js";
import { createdAt, primaryId, timestampColumn } from "./columns.js";
import { organizations } from "./organizations.js";

export const caseArchiveImports = pgTable(
  "case_archive_imports",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<"PREPARED" | "COMMITTED" | "CANCELLED" | "FAILED">()
      .notNull()
      .default("PREPARED"),
    manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
    records: jsonb("records").$type<Record<string, unknown>>().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    expiresAt: timestampColumn("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("case_archive_imports_expiry_idx").on(table.status, table.expiresAt),
  ],
);

export const caseArchiveImportArtifacts = pgTable(
  "case_archive_import_artifacts",
  {
    id: primaryId(),
    importId: uuid("import_id")
      .notNull()
      .references(() => caseArchiveImports.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").notNull(),
    objectKey: text("object_key").notNull().unique(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    artifactKind: text("artifact_kind").notNull(),
    visibility: text("visibility").notNull(),
    capturedAt: timestampColumn("captured_at"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    multipartUploadId: text("multipart_upload_id"),
    createdAt: createdAt(),
  },
  (table) => [
    index("case_archive_import_artifacts_import_idx").on(table.importId),
  ],
);
