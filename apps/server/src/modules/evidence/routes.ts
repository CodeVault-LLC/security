import type { AppInstance } from "../../http/app-instance.js";
import { and, desc, eq, inArray, lt, or, sql, type SQL } from "drizzle-orm";

import {
  Artifact,
  ArtifactDownload,
  CompleteUploadRequest,
  CreateEvidenceRequest,
  CreateUploadRequest,
  ErrorResponse,
  Evidence,
  IdParam,
  ListEvidenceQuery,
  PaginatedResponse,
  UpdateEvidenceRequest,
  UploadInstructions,
} from "@codevault/contracts";
import {
  DomainError,
  isSha256,
  notFound,
  validationError,
} from "@codevault/core";
import { generateObjectKey } from "@codevault/core/crypto";
import { allocateReference, schema } from "@codevault/db";

import { assertRevision } from "../../http/concurrency.js";
import { actingUser, principalOf, requireAuthor } from "../../http/guards.js";
import { decodeCursor, pageSize, paginate } from "../../http/pagination.js";
import { JOB_QUEUES } from "../../services/jobs.js";
import {
  requireCaseRead,
  requireCaseWrite,
} from "../../services/case-access.js";
import { loadArtifacts, loadEvidence } from "./queries.js";

/**
 * Evidence and artifact routes.
 *
 * No file bytes pass through this API. An upload is three steps: register the
 * metadata and receive presigned instructions, stream to object storage from
 * the desktop client, then confirm. Confirmation verifies the object actually
 * exists and is the size that was declared, so a record can never point at
 * something that was never uploaded.
 */

const EvidenceListResponse = PaginatedResponse(Evidence);

export async function registerEvidenceRoutes(app: AppInstance): Promise<void> {
  app.post(
    "/v1/uploads",
    {
      schema: {
        body: CreateUploadRequest,
        response: { 200: UploadInstructions, 400: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const body = request.body;

      await requireCaseWrite(app.db, user, body.caseId);

      if (!isSha256(body.sha256)) {
        throw validationError("The digest must be a SHA-256 hex string.");
      }

      if (body.sizeBytes > app.config.storage.maxUploadBytes) {
        throw validationError(
          `Files above ${app.config.storage.maxUploadBytes} bytes are not accepted.`,
        );
      }

      const artifactId = crypto.randomUUID();
      // The object key is opaque and derived from identifiers we control. The
      // uploaded filename is stored as data and never becomes part of a path.
      const objectKey = generateObjectKey(body.caseId, artifactId);

      const instructions = await app.storage.createUpload(
        objectKey,
        body.mimeType,
        body.sizeBytes,
        body.sha256,
      );

      await app.db.insert(schema.artifacts).values({
        id: artifactId,
        caseId: body.caseId,
        findingId: body.findingId ?? null,
        filename: body.filename,
        objectKey,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes,
        sha256: body.sha256,
        artifactKind: body.artifactKind,
        visibility: body.visibility,
        status: "PENDING",
        uploadId: instructions.multipartUploadId,
        capturedAt: body.capturedAt ?? null,
        metadata: body.metadata ?? {},
        uploadedBy: user.id,
      });

      await app.audit.write(
        app.db,
        {
          actorId: user.id,
          sessionId: principal.session.id,
          requestId: request.requestId,
        },
        {
          action: "artifact.upload_started",
          entityType: "artifact",
          entityId: artifactId,
          caseId: body.caseId,
          after: {
            filename: body.filename,
            sizeBytes: body.sizeBytes,
            sha256: body.sha256,
            visibility: body.visibility,
          },
        },
      );

      return {
        artifactId,
        objectKey,
        strategy: instructions.strategy,
        url: instructions.url,
        multipartUploadId: instructions.multipartUploadId,
        partSizeBytes: instructions.partSizeBytes,
        partUrls: instructions.partUrls,
        requiredHeaders: instructions.requiredHeaders,
        expiresAt: instructions.expiresAt,
      };
    },
  );

  app.post(
    "/v1/uploads/:id/complete",
    {
      schema: {
        params: IdParam,
        body: CompleteUploadRequest,
        response: { 200: Artifact, 400: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);

      const rows = await app.db
        .select()
        .from(schema.artifacts)
        .where(eq(schema.artifacts.id, request.params.id))
        .limit(1);

      const artifact = rows[0];

      if (artifact === undefined) {
        throw notFound("Upload");
      }

      await requireCaseWrite(app.db, user, artifact.caseId);

      if (artifact.status !== "PENDING") {
        throw validationError("That upload has already been completed.");
      }

      if (artifact.uploadId !== null) {
        const parts = request.body.parts ?? [];

        if (parts.length === 0) {
          throw validationError(
            "A multipart upload must be completed with its parts.",
          );
        }

        await app.storage.completeMultipartUpload(
          artifact.objectKey,
          artifact.uploadId,
          parts,
        );
      }

      // The size is re-read from storage rather than trusted from the client:
      // an artifact record has to describe the object that actually exists.
      const stored = await app.storage.head(artifact.objectKey);

      if (stored === null) {
        throw new DomainError(
          "UPLOAD_FAILED",
          "The uploaded object could not be found in storage.",
        );
      }

      if (stored.sizeBytes !== artifact.sizeBytes) {
        await app.db
          .update(schema.artifacts)
          .set({ status: "QUARANTINED", updatedAt: sql`now()` })
          .where(eq(schema.artifacts.id, artifact.id));

        throw new DomainError(
          "UPLOAD_FAILED",
          `The stored object is ${stored.sizeBytes} bytes but ${artifact.sizeBytes} were declared.`,
        );
      }

      await app.db
        .update(schema.artifacts)
        .set({ status: "VERIFYING", uploadId: null, updatedAt: sql`now()` })
        .where(eq(schema.artifacts.id, artifact.id));

      await app.audit.write(
        app.db,
        {
          actorId: user.id,
          sessionId: principal.session.id,
          requestId: request.requestId,
        },
        {
          action: "artifact.verification_started",
          entityType: "artifact",
          entityId: artifact.id,
          caseId: artifact.caseId,
          after: { sha256: artifact.sha256, sizeBytes: artifact.sizeBytes },
        },
      );

      await app.jobs.send(JOB_QUEUES.artifactIntegrity, {
        artifactId: artifact.id,
        caseId: artifact.caseId,
      });

      const [result] = await loadArtifacts(app.db, [artifact.id]);

      if (result === undefined) {
        throw notFound("Artifact");
      }

      return result;
    },
  );

  app.get(
    "/v1/artifacts/:id",
    {
      schema: {
        params: IdParam,
        response: { 200: ArtifactDownload, 404: ErrorResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      const principal = principalOf(request);

      const rows = await app.db
        .select()
        .from(schema.artifacts)
        .where(eq(schema.artifacts.id, request.params.id))
        .limit(1);

      const artifact = rows[0];

      if (artifact === undefined) {
        throw notFound("Artifact");
      }

      const access = await requireCaseRead(app.db, user, artifact.caseId);

      if (artifact.status !== "STORED") {
        throw validationError("That artifact is not available for download.");
      }

      const download = await app.storage.createDownloadUrl(
        artifact.objectKey,
        artifact.filename,
      );

      if (access.restricted) {
        // Downloads from a restricted case are individually audited: knowing
        // who took a copy of an embargoed PoC matters later.
        await app.audit.write(
          app.db,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "artifact.downloaded",
            entityType: "artifact",
            entityId: artifact.id,
            caseId: artifact.caseId,
            after: { filename: artifact.filename, sha256: artifact.sha256 },
          },
        );
      }

      return {
        url: download.url,
        expiresAt: download.expiresAt,
        filename: artifact.filename,
        sha256: artifact.sha256,
      };
    },
  );

  app.get(
    "/v1/evidence",
    {
      schema: {
        querystring: ListEvidenceQuery,
        response: { 200: EvidenceListResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      const size = pageSize(request.query.limit);
      const cursor = decodeCursor(request.query.cursor);
      const filters: SQL[] = [];

      if (request.query.caseId !== undefined) {
        await requireCaseRead(app.db, user, request.query.caseId);
        filters.push(eq(schema.evidence.caseId, request.query.caseId));
      } else {
        filters.push(
          sql`${schema.evidence.caseId} IN (
            SELECT c.id FROM cases c
            WHERE c.organization_id = ${user.organizationId}
          )`,
        );
      }

      if (request.query.findingId !== undefined) {
        filters.push(eq(schema.evidence.findingId, request.query.findingId));
      }

      if (request.query.visibility !== undefined) {
        filters.push(eq(schema.evidence.visibility, request.query.visibility));
      }

      if (request.query.query !== undefined) {
        const pattern = `%${request.query.query}%`;

        filters.push(
          sql`(${schema.evidence.title} ILIKE ${pattern} OR ${schema.evidence.ref} ILIKE ${pattern})`,
        );
      }

      if (cursor !== null) {
        filters.push(
          or(
            lt(schema.evidence.updatedAt, cursor.timestamp),
            and(
              eq(schema.evidence.updatedAt, cursor.timestamp),
              lt(schema.evidence.id, cursor.id),
            ),
          ) as SQL,
        );
      }

      const rows = await app.db
        .select({
          id: schema.evidence.id,
          updatedAt: schema.evidence.updatedAt,
        })
        .from(schema.evidence)
        .where(and(...filters))
        .orderBy(desc(schema.evidence.updatedAt), desc(schema.evidence.id))
        .limit(size + 1);

      const page = paginate(rows, size, (row) => row.updatedAt);
      const items = await loadEvidence(
        app.db,
        page.items.map((row) => row.id),
      );

      return { items, nextCursor: page.nextCursor };
    },
  );

  app.post(
    "/v1/evidence",
    {
      schema: { body: CreateEvidenceRequest, response: { 200: Evidence } },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const body = request.body;

      await requireCaseWrite(app.db, user, body.caseId);

      const evidenceId = await app.db.transaction(async (tx) => {
        const ref = await allocateReference(
          tx,
          user.organizationId,
          "evidence",
        );
        const [row] = await tx
          .insert(schema.evidence)
          .values({
            ref,
            caseId: body.caseId,
            findingId: body.findingId ?? null,
            title: body.title,
            descriptionMarkdown: body.descriptionMarkdown ?? null,
            visibility: body.visibility,
            capturedAt: body.capturedAt ?? null,
            createdBy: user.id,
          })
          .returning({ id: schema.evidence.id });

        if (row === undefined) {
          throw new DomainError(
            "SERVER_ERROR",
            "Could not record the evidence.",
          );
        }

        await attachArtifacts(tx, row.id, body.artifactIds ?? [], body.caseId);

        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "evidence.created",
            entityType: "evidence",
            entityId: row.id,
            caseId: body.caseId,
            after: { ref, title: body.title, visibility: body.visibility },
          },
        );

        return row.id;
      });

      const [item] = await loadEvidence(app.db, [evidenceId]);

      if (item === undefined) {
        throw notFound("Evidence");
      }

      return item;
    },
  );

  app.patch(
    "/v1/evidence/:id",
    {
      schema: {
        params: IdParam,
        body: UpdateEvidenceRequest,
        response: { 200: Evidence, 409: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const body = request.body;

      const rows = await app.db
        .select()
        .from(schema.evidence)
        .where(eq(schema.evidence.id, request.params.id))
        .limit(1);

      const existing = rows[0];

      if (existing === undefined) {
        throw notFound("Evidence");
      }

      await requireCaseWrite(app.db, user, existing.caseId);
      assertRevision(existing, body.expectedRevision, "evidence record");

      await app.db.transaction(async (tx) => {
        await tx
          .update(schema.evidence)
          .set({
            ...(body.title === undefined ? {} : { title: body.title }),
            ...(body.descriptionMarkdown === undefined
              ? {}
              : { descriptionMarkdown: body.descriptionMarkdown }),
            ...(body.visibility === undefined
              ? {}
              : { visibility: body.visibility }),
            ...(body.findingId === undefined
              ? {}
              : { findingId: body.findingId }),
            revision: existing.revision + 1,
            updatedAt: sql`now()`,
          })
          .where(eq(schema.evidence.id, existing.id));

        if (body.artifactIds !== undefined) {
          await tx
            .delete(schema.evidenceArtifacts)
            .where(eq(schema.evidenceArtifacts.evidenceId, existing.id));

          await attachArtifacts(
            tx,
            existing.id,
            body.artifactIds,
            existing.caseId,
          );
        }

        if (
          body.visibility !== undefined &&
          body.visibility !== existing.visibility
        ) {
          // A visibility change is a promotion decision and is always audited,
          // separately from ordinary edits.
          await app.audit.write(
            tx,
            {
              actorId: user.id,
              sessionId: principal.session.id,
              requestId: request.requestId,
            },
            {
              action: "evidence.visibility_changed",
              entityType: "evidence",
              entityId: existing.id,
              caseId: existing.caseId,
              before: { visibility: existing.visibility },
              after: { visibility: body.visibility },
            },
          );
        }
      });

      const [item] = await loadEvidence(app.db, [existing.id]);

      if (item === undefined) {
        throw notFound("Evidence");
      }

      return item;
    },
  );
}

/**
 * Links artifacts to an evidence record.
 *
 * Artifacts must belong to the same case: an evidence record is not a way to
 * pull a file across a case boundary.
 */
async function attachArtifacts(
  tx: AppInstance["db"],
  evidenceId: string,
  artifactIds: readonly string[],
  caseId: string,
): Promise<void> {
  if (artifactIds.length === 0) {
    return;
  }

  const artifacts = await tx
    .select({ id: schema.artifacts.id, caseId: schema.artifacts.caseId })
    .from(schema.artifacts)
    .where(inArray(schema.artifacts.id, [...artifactIds]));

  const foreign = artifacts.filter((artifact) => artifact.caseId !== caseId);

  if (foreign.length > 0 || artifacts.length !== artifactIds.length) {
    throw validationError(
      "Every attached artifact must belong to the same case.",
    );
  }

  await tx
    .insert(schema.evidenceArtifacts)
    .values(
      artifactIds.map((artifactId) => ({
        evidenceId,
        artifactId,
      })),
    )
    .onConflictDoNothing();
}
