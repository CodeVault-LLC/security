import { createHash } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";
import { Type } from "@sinclair/typebox";

import type { AppInstance } from "../../http/app-instance.js";
import {
  CreateManualIntakeRequest,
  CreateFolderIntakeRequest,
  DecideIntakeItemRequest,
  ErrorResponse,
  ExportFindingsQuery,
  FindingExchangePayload,
  FolderIntakeContext,
  FolderIntakeResult,
  IdParam,
  ImportFindingExchangeRequest,
  IntakeItem,
  ListIntakeQuery,
  MergeIntakeItemRequest,
  RejectIntakeItemRequest,
  UpdateIntakeItemRequest,
} from "@codevault/contracts";
import {
  conflict,
  DomainError,
  notFound,
  validationError,
} from "@codevault/core";
import { allocateReference, schema } from "@codevault/db";
import {
  exportFindingsCsv,
  exportFindingsJson,
  exportFindingsSarif,
  parseFindingsCsv,
  parseFindingsJson,
  parseFindingsSarif,
} from "@codevault/exchange";

import { assertRevision } from "../../http/concurrency.js";
import { actingUser, principalOf, requireAuthor } from "../../http/guards.js";
import {
  requireCaseRead,
  requireCaseWrite,
} from "../../services/case-access.js";
import { listIntakeItems, loadIntakeItem } from "./service.js";

const IntakeListResponse = Type.Object({ items: Type.Array(IntakeItem) });

export async function registerIntakeRoutes(app: AppInstance): Promise<void> {
  app.get(
    "/v1/intake",
    {
      schema: {
        querystring: ListIntakeQuery,
        response: { 200: IntakeListResponse, 404: ErrorResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      await requireCaseRead(app.db, user, request.query.caseId);
      return {
        items: await listIntakeItems(
          app.db,
          request.query.caseId,
          request.query.status,
        ),
      };
    },
  );

  app.post(
    "/v1/intake/manual",
    {
      schema: {
        body: CreateManualIntakeRequest,
        response: { 200: IntakeItem, 403: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const body = request.body;
      await requireCaseWrite(app.db, user, body.caseId);

      const itemId = await app.db.transaction(async (tx) => {
        const [batch] = await tx
          .insert(schema.aiIntakeBatches)
          .values({
            caseId: body.caseId,
            source: "MANUAL",
            sourceLabel: body.sourceLabel ?? "Manual entry",
            manifest: {},
            createdBy: user.id,
          })
          .returning({ id: schema.aiIntakeBatches.id });
        if (batch === undefined) {
          throw new DomainError(
            "SERVER_ERROR",
            "Could not create intake batch.",
          );
        }

        const [item] = await tx
          .insert(schema.aiIntakeItems)
          .values({
            batchId: batch.id,
            draft: body.draft,
            citations: body.citations ?? [],
            confidence: body.confidence ?? null,
          })
          .returning({ id: schema.aiIntakeItems.id });
        if (item === undefined) {
          throw new DomainError(
            "SERVER_ERROR",
            "Could not create intake item.",
          );
        }

        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "intake.item_created",
            entityType: "ai_intake_item",
            entityId: item.id,
            caseId: body.caseId,
            after: { source: "MANUAL", title: body.draft.title },
          },
        );
        return item.id;
      });

      app.events.publish({
        type: "entity.changed",
        entityType: "ai_intake_item",
        entityId: itemId,
        caseId: body.caseId,
      });
      return loadIntakeItem(app.db, itemId);
    },
  );

  app.post(
    "/v1/intake/external-agent",
    {
      schema: {
        body: CreateManualIntakeRequest,
        response: { 200: IntakeItem, 403: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      await requireCaseWrite(app.db, user, request.body.caseId);
      await assertArtifactCitationsBelongToCase(
        app,
        request.body.caseId,
        request.body.citations ?? [],
      );
      const created = await createBatch(app, {
        caseId: request.body.caseId,
        source: "EXTERNAL_AGENT",
        sourceLabel: request.body.sourceLabel ?? "External agent draft",
        manifest: { version: 1 },
        items: [
          {
            draft: request.body.draft,
            citations: request.body.citations ?? [],
            ...(request.body.confidence === undefined
              ? {}
              : { confidence: request.body.confidence }),
          },
        ],
        actor: {
          id: user.id,
          sessionId: principal.session.id,
          requestId: request.requestId,
        },
      });
      return loadIntakeItem(app.db, created.itemIds[0]!);
    },
  );

  app.get(
    "/v1/intake/folder-context",
    {
      schema: {
        querystring: Type.Object({ caseId: Type.String({ format: "uuid" }) }),
        response: { 200: FolderIntakeContext, 404: ErrorResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      await requireCaseRead(app.db, user, request.query.caseId);
      const [findings, artifacts] = await Promise.all([
        app.db
          .select({ title: schema.findings.title })
          .from(schema.findings)
          .where(eq(schema.findings.caseId, request.query.caseId)),
        app.db
          .selectDistinct({ sha256: schema.artifacts.sha256 })
          .from(schema.artifacts)
          .where(eq(schema.artifacts.caseId, request.query.caseId)),
      ]);
      return {
        findingTitles: findings.map((item) => item.title),
        artifactDigests: artifacts.map((item) => item.sha256),
      };
    },
  );

  app.post(
    "/v1/intake/folder",
    {
      schema: {
        body: CreateFolderIntakeRequest,
        response: {
          200: FolderIntakeResult,
          400: ErrorResponse,
          403: ErrorResponse,
        },
      },
      config: { rateLimit: { max: 20, timeWindow: "1 hour" } },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      await requireCaseWrite(app.db, user, request.body.caseId);
      await assertFolderArtifactsBelongToCase(
        app,
        request.body.caseId,
        request.body.files,
      );
      await assertArtifactCitationsBelongToCase(app, request.body.caseId, [
        ...request.body.items.flatMap((item) => item.citations),
        ...request.body.files
          .filter((file) => file.artifactId !== undefined)
          .map((file) => ({
            kind: "ARTIFACT" as const,
            artifactId: file.artifactId!,
            label: file.relativePath,
          })),
      ]);

      const result = await createBatch(app, {
        caseId: request.body.caseId,
        sourceLabel: request.body.sourceLabel,
        source: "FOLDER_SCAN",
        manifest: {
          version: 1,
          files: request.body.files,
          itemCount: request.body.items.length,
        },
        items: request.body.items,
        actor: {
          id: user.id,
          sessionId: principal.session.id,
          requestId: request.requestId,
        },
      });
      return {
        batchId: result.batchId,
        items: await Promise.all(
          result.itemIds.map((itemId) => loadIntakeItem(app.db, itemId)),
        ),
      };
    },
  );

  app.get(
    "/v1/findings/exchange",
    {
      schema: {
        querystring: ExportFindingsQuery,
        response: { 200: FindingExchangePayload, 404: ErrorResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      await requireCaseRead(app.db, user, request.query.caseId);
      const rows = await app.db
        .select({
          title: schema.findings.title,
          summaryMarkdown: schema.findings.summaryMarkdown,
          technicalMarkdown: schema.findings.technicalMarkdown,
          impactMarkdown: schema.findings.impactMarkdown,
          remediationMarkdown: schema.findings.remediationMarkdown,
          cweIds: schema.findings.cweIds,
          visibility: schema.findings.visibility,
        })
        .from(schema.findings)
        .where(eq(schema.findings.caseId, request.query.caseId));
      const findings = rows.map((row) => ({
        title: row.title,
        ...(row.summaryMarkdown === null
          ? {}
          : { summaryMarkdown: row.summaryMarkdown }),
        ...(row.technicalMarkdown === null
          ? {}
          : { technicalMarkdown: row.technicalMarkdown }),
        ...(row.impactMarkdown === null
          ? {}
          : { impactMarkdown: row.impactMarkdown }),
        ...(row.remediationMarkdown === null
          ? {}
          : { remediationMarkdown: row.remediationMarkdown }),
        cweIds: row.cweIds,
        visibility: row.visibility,
      }));
      const content =
        request.query.format === "JSON"
          ? exportFindingsJson(findings)
          : request.query.format === "CSV"
            ? exportFindingsCsv(findings)
            : exportFindingsSarif(findings);
      return {
        format: request.query.format,
        filename: `codevault-findings-${request.query.caseId.slice(0, 8)}.${request.query.format.toLowerCase()}`,
        content,
        sha256: createHash("sha256").update(content).digest("hex"),
      };
    },
  );

  app.post(
    "/v1/intake/finding-exchange",
    {
      schema: {
        body: ImportFindingExchangeRequest,
        response: { 200: FolderIntakeResult, 400: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      await requireCaseWrite(app.db, user, request.body.caseId);
      let findings;
      try {
        findings =
          request.body.format === "JSON"
            ? parseFindingsJson(request.body.content)
            : request.body.format === "CSV"
              ? parseFindingsCsv(request.body.content)
              : parseFindingsSarif(request.body.content);
      } catch (error: unknown) {
        throw validationError(
          error instanceof Error
            ? error.message
            : "The finding exchange could not be parsed.",
        );
      }
      if (findings.length === 0) {
        throw validationError("The finding exchange contains no findings.");
      }
      if (findings.length > 500) {
        throw validationError(
          "A finding exchange can contain at most 500 findings.",
        );
      }
      const result = await createBatch(app, {
        caseId: request.body.caseId,
        sourceLabel: request.body.sourceLabel,
        source: "FOLDER_SCAN",
        manifest: {
          version: 1,
          format: request.body.format,
          sha256: createHash("sha256")
            .update(request.body.content)
            .digest("hex"),
        },
        items: findings.map((finding) => ({
          draft: {
            title: finding.title,
            ...(finding.summaryMarkdown === undefined
              ? {}
              : { summaryMarkdown: finding.summaryMarkdown }),
            ...(finding.technicalMarkdown === undefined
              ? {}
              : { technicalMarkdown: finding.technicalMarkdown }),
            ...(finding.impactMarkdown === undefined
              ? {}
              : { impactMarkdown: finding.impactMarkdown }),
            ...(finding.remediationMarkdown === undefined
              ? {}
              : { remediationMarkdown: finding.remediationMarkdown }),
            suggestedCweIds: finding.cweIds,
            affectedVersions: [],
          },
          citations: [],
        })),
        actor: {
          id: user.id,
          sessionId: principal.session.id,
          requestId: request.requestId,
        },
      });
      return {
        batchId: result.batchId,
        items: await Promise.all(
          result.itemIds.map((itemId) => loadIntakeItem(app.db, itemId)),
        ),
      };
    },
  );

  app.patch(
    "/v1/intake/items/:id",
    {
      schema: {
        params: IdParam,
        body: UpdateIntakeItemRequest,
        response: { 200: IntakeItem, 409: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const current = await intakeAccess(app, user, request.params.id, true);
      assertPending(current.item.status);
      assertRevision(
        current.item,
        request.body.expectedRevision,
        "intake item",
      );

      await app.db.transaction(async (tx) => {
        await tx
          .update(schema.aiIntakeItems)
          .set({ draft: request.body.draft, revision: sql`revision + 1` })
          .where(
            and(
              eq(schema.aiIntakeItems.id, current.item.id),
              eq(schema.aiIntakeItems.status, "PENDING"),
              eq(schema.aiIntakeItems.revision, request.body.expectedRevision),
            ),
          );
        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "intake.item_edited",
            entityType: "ai_intake_item",
            entityId: current.item.id,
            caseId: current.batch.caseId,
            after: { title: request.body.draft.title },
          },
        );
      });
      return loadIntakeItem(app.db, current.item.id);
    },
  );

  app.post(
    "/v1/intake/items/:id/accept",
    {
      schema: {
        params: IdParam,
        body: DecideIntakeItemRequest,
        response: { 200: IntakeItem, 409: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const access = await intakeAccess(app, user, request.params.id, true);
      assertPending(access.item.status);
      assertRevision(access.item, request.body.expectedRevision, "intake item");

      const findingId = await app.db.transaction(async (tx) => {
        const locked = await lockPending(tx, access.item.id);
        assertRevision(locked, request.body.expectedRevision, "intake item");
        const ref = await allocateReference(tx, user.organizationId, "finding");
        const draft = locked.draft;
        const [finding] = await tx
          .insert(schema.findings)
          .values({
            ref,
            caseId: access.batch.caseId,
            title: draft.title,
            summaryMarkdown: draft.summaryMarkdown ?? null,
            technicalMarkdown: draft.technicalMarkdown ?? null,
            impactMarkdown: draft.impactMarkdown ?? null,
            remediationMarkdown: draft.remediationMarkdown ?? null,
            cweIds: draft.suggestedCweIds,
            ownerId: user.id,
          })
          .returning({ id: schema.findings.id });
        if (finding === undefined) {
          throw new DomainError("SERVER_ERROR", "Could not create finding.");
        }

        await tx
          .update(schema.aiIntakeItems)
          .set({
            status: "ACCEPTED",
            createdFindingId: finding.id,
            reviewedBy: user.id,
            reviewedAt: sql`now()`,
            revision: sql`revision + 1`,
          })
          .where(eq(schema.aiIntakeItems.id, locked.id));

        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "intake.item_accepted",
            entityType: "ai_intake_item",
            entityId: locked.id,
            caseId: access.batch.caseId,
            after: { findingId: finding.id, ref, title: draft.title },
          },
        );
        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "finding.created_from_intake",
            entityType: "finding",
            entityId: finding.id,
            caseId: access.batch.caseId,
            after: { intakeItemId: locked.id, ref, title: draft.title },
          },
        );
        return finding.id;
      });

      app.events.publish({
        type: "entity.changed",
        entityType: "finding",
        entityId: findingId,
        caseId: access.batch.caseId,
      });
      return loadIntakeItem(app.db, access.item.id);
    },
  );

  app.post(
    "/v1/intake/items/:id/reject",
    {
      schema: {
        params: IdParam,
        body: RejectIntakeItemRequest,
        response: { 200: IntakeItem, 409: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const access = await intakeAccess(app, user, request.params.id, true);
      assertPending(access.item.status);
      assertRevision(access.item, request.body.expectedRevision, "intake item");

      await app.db.transaction(async (tx) => {
        const locked = await lockPending(tx, access.item.id);
        await tx
          .update(schema.aiIntakeItems)
          .set({
            status: "REJECTED",
            rejectionReason: request.body.reason,
            reviewedBy: user.id,
            reviewedAt: sql`now()`,
            revision: sql`revision + 1`,
          })
          .where(eq(schema.aiIntakeItems.id, locked.id));
        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "intake.item_rejected",
            entityType: "ai_intake_item",
            entityId: locked.id,
            caseId: access.batch.caseId,
            after: { reason: request.body.reason },
          },
        );
      });
      return loadIntakeItem(app.db, access.item.id);
    },
  );

  app.post(
    "/v1/intake/items/:id/merge",
    {
      schema: {
        params: IdParam,
        body: MergeIntakeItemRequest,
        response: { 200: IntakeItem, 409: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const access = await intakeAccess(app, user, request.params.id, true);
      const targetRows = await app.db
        .select({ id: schema.findings.id, caseId: schema.findings.caseId })
        .from(schema.findings)
        .where(eq(schema.findings.id, request.body.findingId))
        .limit(1);
      const target = targetRows[0];
      if (target === undefined || target.caseId !== access.batch.caseId) {
        throw notFound("Finding");
      }
      assertPending(access.item.status);
      assertRevision(access.item, request.body.expectedRevision, "intake item");

      await app.db.transaction(async (tx) => {
        const locked = await lockPending(tx, access.item.id);
        await tx
          .update(schema.aiIntakeItems)
          .set({
            status: "MERGED",
            mergedIntoFindingId: target.id,
            reviewedBy: user.id,
            reviewedAt: sql`now()`,
            revision: sql`revision + 1`,
          })
          .where(eq(schema.aiIntakeItems.id, locked.id));
        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "intake.item_merged",
            entityType: "ai_intake_item",
            entityId: locked.id,
            caseId: access.batch.caseId,
            after: { findingId: target.id },
          },
        );
      });
      return loadIntakeItem(app.db, access.item.id);
    },
  );
}

interface CreateBatchOptions {
  caseId: string;
  source: "FOLDER_SCAN" | "EXTERNAL_AGENT";
  sourceLabel: string;
  manifest: Record<string, unknown>;
  items: ReadonlyArray<{
    draft: (typeof schema.aiIntakeItems.$inferInsert)["draft"];
    citations: (typeof schema.aiIntakeItems.$inferInsert)["citations"];
    confidence?: "LOW" | "MEDIUM" | "HIGH";
  }>;
  actor: { id: string; sessionId: string; requestId: string };
}

async function createBatch(
  app: AppInstance,
  options: CreateBatchOptions,
): Promise<{ batchId: string; itemIds: string[] }> {
  return app.db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(schema.aiIntakeBatches)
      .values({
        caseId: options.caseId,
        source: options.source,
        sourceLabel: options.sourceLabel,
        manifest: options.manifest,
        createdBy: options.actor.id,
      })
      .returning({ id: schema.aiIntakeBatches.id });
    if (batch === undefined) {
      throw new DomainError("SERVER_ERROR", "Could not create intake batch.");
    }
    const inserted = await tx
      .insert(schema.aiIntakeItems)
      .values(
        options.items.map((item) => ({
          batchId: batch.id,
          draft: item.draft,
          citations: item.citations,
          confidence: item.confidence ?? null,
        })),
      )
      .returning({ id: schema.aiIntakeItems.id });
    if (inserted.length !== options.items.length) {
      throw new DomainError(
        "SERVER_ERROR",
        "Could not create every intake item.",
      );
    }
    await app.audit.write(
      tx,
      {
        actorId: options.actor.id,
        sessionId: options.actor.sessionId,
        requestId: options.actor.requestId,
      },
      {
        action: "intake.batch_created",
        entityType: "ai_intake_batch",
        entityId: batch.id,
        caseId: options.caseId,
        after: {
          source: options.source,
          sourceLabel: options.sourceLabel,
          itemCount: inserted.length,
        },
      },
    );
    return { batchId: batch.id, itemIds: inserted.map((item) => item.id) };
  });
}

async function assertFolderArtifactsBelongToCase(
  app: AppInstance,
  caseId: string,
  files: ReadonlyArray<{ artifactId?: string; sha256: string }>,
): Promise<void> {
  const expected = new Map(
    files.flatMap((file) =>
      file.artifactId === undefined ? [] : [[file.artifactId, file.sha256]],
    ),
  );
  if (expected.size === 0) return;
  const rows = await app.db
    .select({ id: schema.artifacts.id, sha256: schema.artifacts.sha256 })
    .from(schema.artifacts)
    .where(
      and(
        eq(schema.artifacts.caseId, caseId),
        eq(schema.artifacts.status, "STORED"),
        inArray(schema.artifacts.id, [...expected.keys()]),
      ),
    );
  if (
    rows.length !== expected.size ||
    rows.some((artifact) => expected.get(artifact.id) !== artifact.sha256)
  ) {
    throw validationError(
      "A folder original is missing, unfinished, or no longer matches its preview.",
    );
  }
}

async function assertArtifactCitationsBelongToCase(
  app: AppInstance,
  caseId: string,
  citations: ReadonlyArray<
    | { kind: "FILE"; path: string; sha256: string }
    | { kind: "ARTIFACT"; artifactId: string; label: string }
  >,
): Promise<void> {
  const artifactIds = [
    ...new Set(
      citations
        .filter((citation) => citation.kind === "ARTIFACT")
        .map((citation) => citation.artifactId),
    ),
  ];
  if (artifactIds.length === 0) return;
  const rows = await app.db
    .select({ id: schema.artifacts.id })
    .from(schema.artifacts)
    .where(
      and(
        eq(schema.artifacts.caseId, caseId),
        inArray(schema.artifacts.id, artifactIds),
      ),
    );
  if (rows.length !== artifactIds.length) {
    throw validationError("An intake citation does not belong to this case.");
  }
}

type IntakeAccess = {
  item: typeof schema.aiIntakeItems.$inferSelect;
  batch: typeof schema.aiIntakeBatches.$inferSelect;
};

async function intakeAccess(
  app: AppInstance,
  user: ReturnType<typeof actingUser>,
  itemId: string,
  write: boolean,
): Promise<IntakeAccess> {
  const rows = await app.db
    .select({ item: schema.aiIntakeItems, batch: schema.aiIntakeBatches })
    .from(schema.aiIntakeItems)
    .innerJoin(
      schema.aiIntakeBatches,
      eq(schema.aiIntakeBatches.id, schema.aiIntakeItems.batchId),
    )
    .where(eq(schema.aiIntakeItems.id, itemId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) throw notFound("Intake item");
  if (write) await requireCaseWrite(app.db, user, row.batch.caseId);
  else await requireCaseRead(app.db, user, row.batch.caseId);
  return row;
}

function assertPending(status: string): void {
  if (status !== "PENDING") {
    throw conflict("That intake item has already been reviewed.");
  }
}

async function lockPending(
  tx: AppInstance["db"],
  itemId: string,
): Promise<typeof schema.aiIntakeItems.$inferSelect> {
  const rows = await tx
    .select()
    .from(schema.aiIntakeItems)
    .where(eq(schema.aiIntakeItems.id, itemId))
    .for("update")
    .limit(1);
  const item = rows[0];
  if (item === undefined) throw notFound("Intake item");
  assertPending(item.status);
  return item;
}
