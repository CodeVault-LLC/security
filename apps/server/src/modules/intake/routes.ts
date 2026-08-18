import { and, eq, sql } from "drizzle-orm";
import { Type } from "@sinclair/typebox";

import type { AppInstance } from "../../http/app-instance.js";
import {
  CreateManualIntakeRequest,
  DecideIntakeItemRequest,
  ErrorResponse,
  IdParam,
  IntakeItem,
  ListIntakeQuery,
  MergeIntakeItemRequest,
  RejectIntakeItemRequest,
  UpdateIntakeItemRequest,
} from "@codevault/contracts";
import { conflict, DomainError, notFound } from "@codevault/core";
import { allocateReference, schema } from "@codevault/db";

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
