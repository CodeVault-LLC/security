import type { AppInstance } from "../../http/app-instance.js";
import { eq, inArray, sql } from "drizzle-orm";

import {
  CreatePocRequest,
  ErrorResponse,
  IdParam,
  Poc,
  RecordPocRunRequest,
  UpdatePocRequest,
} from "@codevault/contracts";
import { DomainError, notFound, validationError } from "@codevault/core";
import { allocateReference, schema } from "@codevault/db";

import { assertRevision } from "../../http/concurrency.js";
import { actingUser, principalOf, requireAuthor } from "../../http/guards.js";
import {
  requireCaseRead,
  requireCaseWrite,
} from "../../services/case-access.js";
import { loadPoc } from "./queries.js";

/**
 * Proof-of-concept routes.
 *
 * CodeVault records that a human ran a PoC and what happened. It does not
 * execute anything: a platform that ran researcher-supplied exploit code would
 * be a remote code execution service with an audit log.
 */

export async function registerPocRoutes(app: AppInstance): Promise<void> {
  app.post(
    "/v1/pocs",
    { schema: { body: CreatePocRequest, response: { 200: Poc } } },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const body = request.body;
      const finding = await requireFinding(app, body.findingId);

      await requireCaseWrite(app.db, user, finding.caseId);

      const pocId = await app.db.transaction(async (tx) => {
        const ref = await allocateReference(tx, user.organizationId, "poc");
        const [row] = await tx
          .insert(schema.pocs)
          .values({
            ref,
            findingId: body.findingId,
            title: body.title,
            instructionsMarkdown: body.instructionsMarkdown,
            preconditionsMarkdown: body.preconditionsMarkdown ?? null,
            expectedResultMarkdown: body.expectedResultMarkdown ?? null,
            visibility: body.visibility,
            testedAssetId: body.testedAssetId ?? null,
            testedVersion: body.testedVersion ?? null,
            createdBy: user.id,
          })
          .returning({ id: schema.pocs.id });

        if (row === undefined) {
          throw new DomainError("SERVER_ERROR", "Could not record the PoC.");
        }

        await attachArtifacts(
          tx,
          row.id,
          body.artifactIds ?? [],
          finding.caseId,
        );

        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "poc.created",
            entityType: "poc",
            entityId: row.id,
            caseId: finding.caseId,
            after: { ref, title: body.title, visibility: body.visibility },
          },
        );

        return row.id;
      });

      const poc = await loadPoc(app.db, pocId);

      if (poc === null) {
        throw notFound("Proof of concept");
      }

      return poc;
    },
  );

  app.get(
    "/v1/pocs/:id",
    { schema: { params: IdParam, response: { 200: Poc, 404: ErrorResponse } } },
    async (request) => {
      const user = actingUser(request);
      const poc = await loadPoc(app.db, request.params.id);

      if (poc === null) {
        throw notFound("Proof of concept");
      }

      const finding = await requireFinding(app, poc.findingId);

      await requireCaseRead(app.db, user, finding.caseId);

      return poc;
    },
  );

  app.patch(
    "/v1/pocs/:id",
    {
      schema: {
        params: IdParam,
        body: UpdatePocRequest,
        response: { 200: Poc, 409: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const body = request.body;

      const rows = await app.db
        .select()
        .from(schema.pocs)
        .where(eq(schema.pocs.id, request.params.id))
        .limit(1);

      const existing = rows[0];

      if (existing === undefined) {
        throw notFound("Proof of concept");
      }

      const finding = await requireFinding(app, existing.findingId);

      await requireCaseWrite(app.db, user, finding.caseId);
      assertRevision(existing, body.expectedRevision, "proof of concept");

      await app.db.transaction(async (tx) => {
        await tx
          .update(schema.pocs)
          .set({
            ...(body.title === undefined ? {} : { title: body.title }),
            ...(body.instructionsMarkdown === undefined
              ? {}
              : { instructionsMarkdown: body.instructionsMarkdown }),
            ...(body.preconditionsMarkdown === undefined
              ? {}
              : { preconditionsMarkdown: body.preconditionsMarkdown }),
            ...(body.expectedResultMarkdown === undefined
              ? {}
              : { expectedResultMarkdown: body.expectedResultMarkdown }),
            ...(body.status === undefined ? {} : { status: body.status }),
            ...(body.visibility === undefined
              ? {}
              : { visibility: body.visibility }),
            ...(body.testedAssetId === undefined
              ? {}
              : { testedAssetId: body.testedAssetId }),
            ...(body.testedVersion === undefined
              ? {}
              : { testedVersion: body.testedVersion }),
            revision: existing.revision + 1,
            updatedAt: sql`now()`,
          })
          .where(eq(schema.pocs.id, existing.id));

        if (body.artifactIds !== undefined) {
          await tx
            .delete(schema.pocArtifacts)
            .where(eq(schema.pocArtifacts.pocId, existing.id));

          await attachArtifacts(
            tx,
            existing.id,
            body.artifactIds,
            finding.caseId,
          );
        }
      });

      const poc = await loadPoc(app.db, existing.id);

      if (poc === null) {
        throw notFound("Proof of concept");
      }

      return poc;
    },
  );

  app.post(
    "/v1/pocs/:id/runs",
    {
      schema: {
        params: IdParam,
        body: RecordPocRunRequest,
        response: { 200: Poc },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const body = request.body;

      const rows = await app.db
        .select()
        .from(schema.pocs)
        .where(eq(schema.pocs.id, request.params.id))
        .limit(1);

      const poc = rows[0];

      if (poc === undefined) {
        throw notFound("Proof of concept");
      }

      const finding = await requireFinding(app, poc.findingId);

      await requireCaseWrite(app.db, user, finding.caseId);

      const ranAt = body.ranAt ?? new Date().toISOString();

      await app.db.transaction(async (tx) => {
        await tx.insert(schema.pocRuns).values({
          pocId: poc.id,
          outcome: body.outcome,
          notesMarkdown: body.notesMarkdown ?? null,
          environment: body.environment ?? null,
          testedVersion: body.testedVersion ?? null,
          ranAt,
          ranBy: user.id,
        });

        // The recorded outcome drives the PoC's status, so "verified" always
        // traces back to a specific run by a specific person on a date.
        const status =
          body.outcome === "SUCCESS"
            ? "VERIFIED"
            : body.outcome === "FAILURE"
              ? "FAILED"
              : poc.status;

        await tx
          .update(schema.pocs)
          .set({
            status,
            ...(body.outcome === "SUCCESS" ? { lastVerifiedAt: ranAt } : {}),
            ...(body.testedVersion === undefined
              ? {}
              : { testedVersion: body.testedVersion }),
            revision: poc.revision + 1,
            updatedAt: sql`now()`,
          })
          .where(eq(schema.pocs.id, poc.id));

        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "poc.run_recorded",
            entityType: "poc",
            entityId: poc.id,
            caseId: finding.caseId,
            after: { outcome: body.outcome, ranAt, status },
          },
        );
      });

      const result = await loadPoc(app.db, poc.id);

      if (result === null) {
        throw notFound("Proof of concept");
      }

      return result;
    },
  );
}

async function requireFinding(
  app: AppInstance,
  findingId: string,
): Promise<{ id: string; caseId: string }> {
  const rows = await app.db
    .select({ id: schema.findings.id, caseId: schema.findings.caseId })
    .from(schema.findings)
    .where(eq(schema.findings.id, findingId))
    .limit(1);

  const row = rows[0];

  if (row === undefined) {
    throw notFound("Finding");
  }

  return row;
}

async function attachArtifacts(
  tx: AppInstance["db"],
  pocId: string,
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

  if (
    artifacts.length !== artifactIds.length ||
    artifacts.some((artifact) => artifact.caseId !== caseId)
  ) {
    throw validationError(
      "Every attached artifact must belong to the same case.",
    );
  }

  await tx
    .insert(schema.pocArtifacts)
    .values(artifactIds.map((artifactId) => ({ pocId, artifactId })))
    .onConflictDoNothing();
}
