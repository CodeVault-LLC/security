CREATE TABLE "case_archive_imports" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "status" text DEFAULT 'PREPARED' NOT NULL,
  "manifest" jsonb NOT NULL,
  "records" jsonb NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "case_archive_imports_expiry_idx" ON "case_archive_imports" ("status", "expires_at");

CREATE TABLE "case_archive_import_artifacts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "import_id" uuid NOT NULL REFERENCES "case_archive_imports"("id") ON DELETE CASCADE,
  "source_id" uuid NOT NULL,
  "object_key" text NOT NULL UNIQUE,
  "filename" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "sha256" text NOT NULL,
  "artifact_kind" text NOT NULL,
  "visibility" text NOT NULL,
  "captured_at" timestamptz,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "multipart_upload_id" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "case_archive_import_artifacts_import_idx" ON "case_archive_import_artifacts" ("import_id");
