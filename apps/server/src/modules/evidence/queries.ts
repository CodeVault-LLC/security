import { desc, eq, inArray } from "drizzle-orm";

import type { Artifact, Evidence, Poc } from "@codevault/contracts";
import { applyPreviewRedactions } from "@codevault/core";
import type { Database } from "@codevault/db";
import { schema } from "@codevault/db";

/**
 * Evidence read queries.
 *
 * Batched by identifier so a list endpoint issues a fixed number of queries
 * regardless of page size.
 */

export async function loadArtifacts(
  db: Database,
  artifactIds: readonly string[],
): Promise<Artifact[]> {
  if (artifactIds.length === 0) {
    return [];
  }

  const rows = await db
    .select({
      artifact: schema.artifacts,
      uploaderId: schema.users.id,
      uploaderName: schema.users.displayName,
      uploaderEmail: schema.users.email,
      previewRedaction: schema.artifactPreviewRedactions,
    })
    .from(schema.artifacts)
    .innerJoin(schema.users, eq(schema.users.id, schema.artifacts.uploadedBy))
    .leftJoin(
      schema.artifactPreviewRedactions,
      eq(schema.artifactPreviewRedactions.artifactId, schema.artifacts.id),
    )
    .where(inArray(schema.artifacts.id, [...artifactIds]));

  return rows.map(
    ({
      artifact,
      uploaderId,
      uploaderName,
      uploaderEmail,
      previewRedaction,
    }) => ({
      id: artifact.id,
      caseId: artifact.caseId,
      findingId: artifact.findingId,
      filename: artifact.filename,
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
      artifactKind: artifact.artifactKind,
      visibility: artifact.visibility,
      status: artifact.status,
      uploadedBy: {
        id: uploaderId,
        displayName: uploaderName,
        email: uploaderEmail,
      },
      capturedAt: artifact.capturedAt,
      metadata: artifact.metadata,
      previewKind: artifact.previewKind,
      previewText:
        artifact.previewText === null || previewRedaction === null
          ? artifact.previewText
          : applyPreviewRedactions(
              artifact.previewText,
              previewRedaction.rules,
            ),
      previewRedaction:
        previewRedaction === null
          ? null
          : {
              rules: previewRedaction.rules,
              revision: previewRedaction.revision,
              updatedAt: previewRedaction.updatedAt,
            },
      createdAt: artifact.createdAt,
    }),
  );
}

export async function loadEvidence(
  db: Database,
  evidenceIds: readonly string[],
): Promise<Evidence[]> {
  if (evidenceIds.length === 0) {
    return [];
  }

  const rows = await db
    .select({
      evidence: schema.evidence,
      authorId: schema.users.id,
      authorName: schema.users.displayName,
      authorEmail: schema.users.email,
    })
    .from(schema.evidence)
    .innerJoin(schema.users, eq(schema.users.id, schema.evidence.createdBy))
    .where(inArray(schema.evidence.id, [...evidenceIds]))
    .orderBy(desc(schema.evidence.updatedAt));

  const links = await db
    .select()
    .from(schema.evidenceArtifacts)
    .where(inArray(schema.evidenceArtifacts.evidenceId, [...evidenceIds]));

  const artifacts = await loadArtifacts(
    db,
    links.map((link) => link.artifactId),
  );
  const artifactsById = new Map(artifacts.map((item) => [item.id, item]));

  return rows.map(({ evidence, authorId, authorName, authorEmail }) => ({
    id: evidence.id,
    ref: evidence.ref,
    caseId: evidence.caseId,
    findingId: evidence.findingId,
    title: evidence.title,
    descriptionMarkdown: evidence.descriptionMarkdown,
    visibility: evidence.visibility,
    capturedAt: evidence.capturedAt,
    artifacts: links
      .filter((link) => link.evidenceId === evidence.id)
      .map((link) => artifactsById.get(link.artifactId))
      .filter((item): item is Artifact => item !== undefined),
    createdBy: {
      id: authorId,
      displayName: authorName,
      email: authorEmail,
    },
    createdAt: evidence.createdAt,
    updatedAt: evidence.updatedAt,
    revision: evidence.revision,
  }));
}

export async function loadPoc(
  db: Database,
  pocId: string,
): Promise<Poc | null> {
  const rows = await db
    .select({
      poc: schema.pocs,
      authorId: schema.users.id,
      authorName: schema.users.displayName,
      authorEmail: schema.users.email,
    })
    .from(schema.pocs)
    .innerJoin(schema.users, eq(schema.users.id, schema.pocs.createdBy))
    .where(eq(schema.pocs.id, pocId))
    .limit(1);

  const row = rows[0];

  if (row === undefined) {
    return null;
  }

  const links = await db
    .select()
    .from(schema.pocArtifacts)
    .where(eq(schema.pocArtifacts.pocId, pocId));

  const artifacts = await loadArtifacts(
    db,
    links.map((link) => link.artifactId),
  );

  const runRows = await db
    .select({
      run: schema.pocRuns,
      userId: schema.users.id,
      userName: schema.users.displayName,
      userEmail: schema.users.email,
    })
    .from(schema.pocRuns)
    .innerJoin(schema.users, eq(schema.users.id, schema.pocRuns.ranBy))
    .where(eq(schema.pocRuns.pocId, pocId))
    .orderBy(desc(schema.pocRuns.ranAt));

  return {
    id: row.poc.id,
    ref: row.poc.ref,
    findingId: row.poc.findingId,
    title: row.poc.title,
    instructionsMarkdown: row.poc.instructionsMarkdown,
    preconditionsMarkdown: row.poc.preconditionsMarkdown,
    expectedResultMarkdown: row.poc.expectedResultMarkdown,
    status: row.poc.status,
    testedAssetId: row.poc.testedAssetId,
    testedVersion: row.poc.testedVersion,
    lastVerifiedAt: row.poc.lastVerifiedAt,
    visibility: row.poc.visibility,
    artifacts,
    runs: runRows.map(({ run, userId, userName, userEmail }) => ({
      id: run.id,
      pocId: run.pocId,
      outcome: run.outcome,
      notesMarkdown: run.notesMarkdown,
      environment: run.environment,
      testedVersion: run.testedVersion,
      ranAt: run.ranAt,
      ranBy: { id: userId, displayName: userName, email: userEmail },
      createdAt: run.createdAt,
    })),
    createdBy: {
      id: row.authorId,
      displayName: row.authorName,
      email: row.authorEmail,
    },
    createdAt: row.poc.createdAt,
    updatedAt: row.poc.updatedAt,
    revision: row.poc.revision,
  };
}
