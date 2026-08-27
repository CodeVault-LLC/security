import { createHash } from "node:crypto";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Type } from "@sinclair/typebox";

import type { AppInstance } from "../../http/app-instance.js";
import {
  BulkAcceptIntakeItemsRequest,
  BulkAcceptIntakeItemsResult,
  CreateScannerSyncProfileRequest,
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
  ListScannerSyncProfilesQuery,
  MergeIntakeItemRequest,
  RejectIntakeItemRequest,
  ScannerSyncProfile,
  UpdateScannerSyncProfileRequest,
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
const ScannerSyncProfileListResponse = Type.Object({
  items: Type.Array(ScannerSyncProfile),
});

export async function registerIntakeRoutes(app: AppInstance): Promise<void> {
  app.get(
    "/v1/intake/scanner-profiles",
    {
      schema: {
        querystring: ListScannerSyncProfilesQuery,
        response: { 200: ScannerSyncProfileListResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      await requireCaseRead(app.db, user, request.query.caseId);
      return {
        items: await app.db
          .select(profileSelection)
          .from(schema.scannerSyncProfiles)
          .where(eq(schema.scannerSyncProfiles.caseId, request.query.caseId))
          .orderBy(asc(schema.scannerSyncProfiles.name)),
      };
    },
  );

  app.post(
    "/v1/intake/scanner-profiles",
    {
      schema: {
        body: CreateScannerSyncProfileRequest,
        response: { 200: ScannerSyncProfile, 403: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      await requireCaseWrite(app.db, user, request.body.caseId);
      const profileId = await app.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(schema.scannerSyncProfiles)
          .values({
            ...request.body,
            name: request.body.name.trim(),
            sourceLabel: request.body.sourceLabel.trim(),
            nextRunAt: nextRunAt(request.body.cadenceHours),
            createdBy: user.id,
          })
          .returning({ id: schema.scannerSyncProfiles.id });
        if (created === undefined) {
          throw new DomainError(
            "SERVER_ERROR",
            "Could not create scanner synchronization profile.",
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
            action: "scanner_sync_profile.created",
            entityType: "scanner_sync_profile",
            entityId: created.id,
            caseId: request.body.caseId,
            after: {
              name: request.body.name.trim(),
              format: request.body.format,
              cadenceHours: request.body.cadenceHours,
            },
          },
        );
        return created.id;
      });
      app.events.publish({
        type: "entity.changed",
        entityType: "scanner_sync_profile",
        entityId: profileId,
        caseId: request.body.caseId,
      });
      return loadScannerSyncProfile(app, profileId);
    },
  );

  app.patch(
    "/v1/intake/scanner-profiles/:id",
    {
      schema: {
        params: IdParam,
        body: UpdateScannerSyncProfileRequest,
        response: {
          200: ScannerSyncProfile,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const current = await loadScannerSyncProfile(app, request.params.id);
      await requireCaseWrite(app.db, user, current.caseId);
      assertRevision(current, request.body.expectedRevision, "scanner profile");
      const { expectedRevision: _expectedRevision, ...changes } = request.body;
      const updated = await app.db.transaction(async (tx) => {
        const rows = await tx
          .update(schema.scannerSyncProfiles)
          .set({
            ...changes,
            ...(changes.name === undefined
              ? {}
              : { name: changes.name.trim() }),
            ...(changes.sourceLabel === undefined
              ? {}
              : { sourceLabel: changes.sourceLabel.trim() }),
            ...(changes.cadenceHours === undefined
              ? {}
              : { nextRunAt: nextRunAt(changes.cadenceHours) }),
            revision: sql`revision + 1`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(schema.scannerSyncProfiles.id, current.id),
              eq(
                schema.scannerSyncProfiles.revision,
                request.body.expectedRevision,
              ),
            ),
          )
          .returning({ id: schema.scannerSyncProfiles.id });
        if (rows[0] === undefined) {
          throw conflict("The scanner profile changed since you loaded it.");
        }
        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "scanner_sync_profile.updated",
            entityType: "scanner_sync_profile",
            entityId: current.id,
            caseId: current.caseId,
            before: {
              ...(changes.name === undefined ? {} : { name: current.name }),
              ...(changes.format === undefined
                ? {}
                : { format: current.format }),
              ...(changes.sourceLabel === undefined
                ? {}
                : { sourceLabel: current.sourceLabel }),
              ...(changes.deduplicationPolicy === undefined
                ? {}
                : { deduplicationPolicy: current.deduplicationPolicy }),
              ...(changes.cadenceHours === undefined
                ? {}
                : { cadenceHours: current.cadenceHours }),
              ...(changes.enabled === undefined
                ? {}
                : { enabled: current.enabled }),
            },
            after: changes,
          },
        );
        return rows[0];
      });
      app.events.publish({
        type: "entity.changed",
        entityType: "scanner_sync_profile",
        entityId: current.id,
        caseId: current.caseId,
      });
      return loadScannerSyncProfile(app, updated.id);
    },
  );

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
          .selectDistinct({
            id: schema.artifacts.id,
            filename: schema.artifacts.filename,
            sha256: schema.artifacts.sha256,
          })
          .from(schema.artifacts)
          .where(
            and(
              eq(schema.artifacts.caseId, request.query.caseId),
              eq(schema.artifacts.status, "STORED"),
            ),
          ),
      ]);
      return {
        findingTitles: findings.map((item) => item.title),
        artifactDigests: artifacts.map((item) => item.sha256),
        storedArtifacts: artifacts,
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
    "/v1/intake/bulk-accept",
    {
      schema: {
        body: BulkAcceptIntakeItemsRequest,
        response: {
          200: BulkAcceptIntakeItemsResult,
          400: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const { caseId, items } = request.body;
      await requireCaseWrite(app.db, user, caseId);
      const itemIds = items.map((item) => item.id);
      if (new Set(itemIds).size !== itemIds.length) {
        throw validationError("Select each intake item only once.");
      }

      const accessRows = await app.db
        .select({
          id: schema.aiIntakeItems.id,
          caseId: schema.aiIntakeBatches.caseId,
        })
        .from(schema.aiIntakeItems)
        .innerJoin(
          schema.aiIntakeBatches,
          eq(schema.aiIntakeBatches.id, schema.aiIntakeItems.batchId),
        )
        .where(inArray(schema.aiIntakeItems.id, itemIds));
      if (
        accessRows.length !== itemIds.length ||
        accessRows.some((row) => row.caseId !== caseId)
      ) {
        throw notFound("Intake item");
      }

      const findingIds = await app.db.transaction(async (tx) => {
        const accepted: string[] = [];
        // Stable lock order prevents overlapping bulk requests from deadlocking.
        for (const input of [...items].sort((left, right) =>
          left.id.localeCompare(right.id),
        )) {
          const locked = await lockPending(tx, input.id);
          assertRevision(locked, input.expectedRevision, "intake item");
          accepted.push(
            await acceptLockedIntakeItem(app, tx, {
              item: locked,
              caseId,
              userId: user.id,
              organizationId: user.organizationId,
              sessionId: principal.session.id,
              requestId: request.requestId,
            }),
          );
        }
        return accepted;
      });

      for (const findingId of findingIds) {
        app.events.publish({
          type: "entity.changed",
          entityType: "finding",
          entityId: findingId,
          caseId,
        });
      }
      return {
        items: await Promise.all(
          itemIds.map((itemId) => loadIntakeItem(app.db, itemId)),
        ),
      };
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
        return acceptLockedIntakeItem(app, tx, {
          item: locked,
          caseId: access.batch.caseId,
          userId: user.id,
          organizationId: user.organizationId,
          sessionId: principal.session.id,
          requestId: request.requestId,
        });
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

const profileSelection = {
  id: schema.scannerSyncProfiles.id,
  caseId: schema.scannerSyncProfiles.caseId,
  name: schema.scannerSyncProfiles.name,
  format: schema.scannerSyncProfiles.format,
  sourceLabel: schema.scannerSyncProfiles.sourceLabel,
  deduplicationPolicy: schema.scannerSyncProfiles.deduplicationPolicy,
  cadenceHours: schema.scannerSyncProfiles.cadenceHours,
  enabled: schema.scannerSyncProfiles.enabled,
  nextRunAt: schema.scannerSyncProfiles.nextRunAt,
  lastRunAt: schema.scannerSyncProfiles.lastRunAt,
  revision: schema.scannerSyncProfiles.revision,
  createdAt: schema.scannerSyncProfiles.createdAt,
  updatedAt: schema.scannerSyncProfiles.updatedAt,
};

async function loadScannerSyncProfile(
  app: AppInstance,
  id: string,
): Promise<ScannerSyncProfile> {
  const [profile] = await app.db
    .select(profileSelection)
    .from(schema.scannerSyncProfiles)
    .where(eq(schema.scannerSyncProfiles.id, id));
  if (profile === undefined) throw notFound("Scanner profile not found.");
  return profile;
}

function nextRunAt(cadenceHours: number): string {
  return new Date(Date.now() + cadenceHours * 60 * 60 * 1_000).toISOString();
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

async function acceptLockedIntakeItem(
  app: AppInstance,
  tx: AppInstance["db"],
  input: {
    item: typeof schema.aiIntakeItems.$inferSelect;
    caseId: string;
    userId: string;
    organizationId: string;
    sessionId: string;
    requestId: string;
  },
): Promise<string> {
  const ref = await allocateReference(tx, input.organizationId, "finding");
  const draft = input.item.draft;
  const [finding] = await tx
    .insert(schema.findings)
    .values({
      ref,
      caseId: input.caseId,
      title: draft.title,
      summaryMarkdown: draft.summaryMarkdown ?? null,
      technicalMarkdown: draft.technicalMarkdown ?? null,
      impactMarkdown: draft.impactMarkdown ?? null,
      remediationMarkdown: draft.remediationMarkdown ?? null,
      cweIds: draft.suggestedCweIds,
      ownerId: input.userId,
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
      reviewedBy: input.userId,
      reviewedAt: sql`now()`,
      revision: sql`revision + 1`,
    })
    .where(eq(schema.aiIntakeItems.id, input.item.id));

  const actor = {
    actorId: input.userId,
    sessionId: input.sessionId,
    requestId: input.requestId,
  };
  await app.audit.write(tx, actor, {
    action: "intake.item_accepted",
    entityType: "ai_intake_item",
    entityId: input.item.id,
    caseId: input.caseId,
    after: { findingId: finding.id, ref, title: draft.title },
  });
  await app.audit.write(tx, actor, {
    action: "finding.created_from_intake",
    entityType: "finding",
    entityId: finding.id,
    caseId: input.caseId,
    after: { intakeItemId: input.item.id, ref, title: draft.title },
  });

  return finding.id;
}
