import type { AppInstance } from "../../http/app-instance.js";
import { and, desc, eq, inArray, lt, or, sql, type SQL } from "drizzle-orm";

import {
  AddAffectedRangeRequest,
  AddFindingIdentifierRequest,
  AddFindingScoreRequest,
  BulkSetRemediationStateRequest,
  BulkSetRemediationStateResponse,
  Claim,
  CreateClaimRequest,
  CreateFindingRequest,
  CreateReferenceRequest,
  ErrorResponse,
  ExternalReference,
  FindingDetail,
  FindingSummary,
  IdParam,
  LinkFindingAssetRequest,
  ListFindingsQuery,
  PaginatedResponse,
  UpdateFindingRequest,
} from "@codevault/contracts";
import {
  type ActingUser,
  canTransitionDisclosure,
  canTransitionValidation,
  conflict,
  DomainError,
  isValidCweId,
  notFound,
  validationError,
} from "@codevault/core";
import { allocateReference, schema } from "@codevault/db";
import { Type } from "@sinclair/typebox";

import { assertRevision } from "../../http/concurrency.js";
import { actingUser, principalOf, requireAuthor } from "../../http/guards.js";
import { decodeCursor, pageSize, paginate } from "../../http/pagination.js";
import {
  requireCaseApproval,
  requireCaseDisclosure,
  requireCaseRead,
  requireCaseWrite,
} from "../../services/case-access.js";
import { approveScore, normaliseScoreSubmission } from "./scoring.js";
import { loadFindingDetail, readableCaseIdsSubquery } from "./queries.js";
import { prepareExternalIdentifier } from "./external-identifiers.js";
import { collectFindingRevisionChanges } from "./revision-changes.js";

/**
 * Finding routes.
 *
 * Quick create takes five fields. The five lifecycle states move independently,
 * each transition is validated against the domain rules, and each one is
 * audited: "who marked this confirmed, and when" is a question a disclosure
 * timeline has to be able to answer months later.
 */

const FindingListResponse = PaginatedResponse(FindingSummary);

export async function registerFindingRoutes(app: AppInstance): Promise<void> {
  app.get(
    "/v1/findings",
    {
      schema: {
        querystring: ListFindingsQuery,
        response: { 200: FindingListResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      const size = pageSize(request.query.limit);
      const cursor = decodeCursor(request.query.cursor);
      const filters: SQL[] = [
        sql`${schema.findings.caseId} IN ${readableCaseIdsSubquery(user)}`,
      ];

      if (request.query.caseId !== undefined) {
        filters.push(eq(schema.findings.caseId, request.query.caseId));
      }

      if (request.query.validationState !== undefined) {
        filters.push(
          eq(schema.findings.validationState, request.query.validationState),
        );
      }

      if (request.query.remediationState !== undefined) {
        filters.push(
          eq(schema.findings.remediationState, request.query.remediationState),
        );
      }

      if (request.query.disclosureState !== undefined) {
        filters.push(
          eq(schema.findings.disclosureState, request.query.disclosureState),
        );
      }

      if (request.query.priorArtState !== undefined) {
        filters.push(
          eq(schema.findings.priorArtState, request.query.priorArtState),
        );
      }

      if (request.query.severity !== undefined) {
        filters.push(eq(schema.findings.severity, request.query.severity));
      }

      if (request.query.assetId !== undefined) {
        filters.push(
          sql`EXISTS (
            SELECT 1 FROM finding_assets
            WHERE finding_assets.finding_id = ${schema.findings.id}
              AND finding_assets.asset_id = ${request.query.assetId}
          )`,
        );
      }

      if (request.query.query !== undefined) {
        const pattern = `%${request.query.query}%`;

        filters.push(
          sql`(${schema.findings.title} ILIKE ${pattern} OR ${schema.findings.ref} ILIKE ${pattern})`,
        );
      }

      if (cursor !== null) {
        filters.push(
          or(
            lt(schema.findings.updatedAt, cursor.timestamp),
            and(
              eq(schema.findings.updatedAt, cursor.timestamp),
              lt(schema.findings.id, cursor.id),
            ),
          ) as SQL,
        );
      }

      const rows = await app.db
        .select({
          id: schema.findings.id,
          ref: schema.findings.ref,
          caseId: schema.findings.caseId,
          caseRef: schema.cases.ref,
          title: schema.findings.title,
          summaryMarkdown: schema.findings.summaryMarkdown,
          validationState: schema.findings.validationState,
          remediationState: schema.findings.remediationState,
          disclosureState: schema.findings.disclosureState,
          externalIdState: schema.findings.externalIdState,
          priorArtState: schema.findings.priorArtState,
          severity: schema.findings.severity,
          score: schema.findings.score,
          revision: schema.findings.revision,
          createdAt: schema.findings.createdAt,
          updatedAt: schema.findings.updatedAt,
          pendingProposalCount: sql<number>`(
            SELECT count(*)::int FROM ai_proposals
            WHERE ai_proposals.target_id = ${schema.findings.id}
              AND ai_proposals.status = 'PENDING'
          )`,
          primaryAssetId: sql<string | null>`(
            SELECT asset_id FROM finding_assets
            WHERE finding_assets.finding_id = ${schema.findings.id}
              AND finding_assets."primary"
            LIMIT 1
          )`,
        })
        .from(schema.findings)
        .innerJoin(schema.cases, eq(schema.cases.id, schema.findings.caseId))
        .where(and(...filters))
        .orderBy(desc(schema.findings.updatedAt), desc(schema.findings.id))
        .limit(size + 1);

      const page = paginate(rows, size, (row) => row.updatedAt);
      const assetIds = page.items
        .map((row) => row.primaryAssetId)
        .filter((id): id is string => id !== null);

      const assets =
        assetIds.length === 0
          ? []
          : await app.db
              .select({
                id: schema.assets.id,
                ref: schema.assets.ref,
                name: schema.assets.name,
                kind: schema.assets.kind,
              })
              .from(schema.assets)
              .where(inArray(schema.assets.id, assetIds));

      const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

      return {
        items: page.items.map((row) => {
          const asset =
            row.primaryAssetId === null
              ? undefined
              : assetsById.get(row.primaryAssetId);

          return {
            id: row.id,
            ref: row.ref,
            caseId: row.caseId,
            caseRef: row.caseRef,
            title: row.title,
            summaryMarkdown: row.summaryMarkdown,
            validationState: row.validationState,
            remediationState: row.remediationState,
            disclosureState: row.disclosureState,
            externalIdState: row.externalIdState,
            priorArtState: row.priorArtState,
            severity: row.severity,
            score: row.score,
            primaryAsset:
              asset === undefined
                ? null
                : {
                    assetId: asset.id,
                    assetRef: asset.ref,
                    name: asset.name,
                    kind: asset.kind,
                    primary: true,
                  },
            pendingProposalCount: row.pendingProposalCount,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            revision: row.revision,
          };
        }),
        nextCursor: page.nextCursor,
      };
    },
  );

  app.post(
    "/v1/findings",
    {
      schema: {
        body: CreateFindingRequest,
        response: { 200: FindingDetail, 403: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const body = request.body;

      await requireCaseWrite(app.db, user, body.caseId);

      const findingId = await app.db.transaction(async (tx) => {
        const ref = await allocateReference(tx, user.organizationId, "finding");
        const [row] = await tx
          .insert(schema.findings)
          .values({
            ref,
            caseId: body.caseId,
            title: body.title,
            summaryMarkdown: body.summaryMarkdown ?? null,
            ownerId: user.id,
            // An initial severity is a placeholder for triage; it carries no
            // vector and is replaced the moment a real score is approved.
            severity: body.initialSeverity ?? null,
          })
          .returning({ id: schema.findings.id });

        if (row === undefined) {
          throw new DomainError(
            "SERVER_ERROR",
            "Could not create the finding.",
          );
        }

        if (body.primaryAssetId !== undefined) {
          await tx.insert(schema.findingAssets).values({
            findingId: row.id,
            assetId: body.primaryAssetId,
            primary: true,
          });

          await tx
            .insert(schema.caseAssets)
            .values({ caseId: body.caseId, assetId: body.primaryAssetId })
            .onConflictDoNothing();
        }

        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "finding.created",
            entityType: "finding",
            entityId: row.id,
            caseId: body.caseId,
            after: { ref, title: body.title },
          },
        );

        return row.id;
      });

      app.events.publish({
        type: "entity.changed",
        entityType: "finding",
        entityId: findingId,
        caseId: body.caseId,
      });

      return loadFindingDetail(app.db, findingId);
    },
  );

  app.get(
    "/v1/findings/:id",
    {
      schema: {
        params: IdParam,
        response: { 200: FindingDetail, 404: ErrorResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      const finding = await requireFindingRead(app, user, request.params.id);

      return loadFindingDetail(app.db, finding.id);
    },
  );

  app.post(
    "/v1/findings/actions/bulk-remediation",
    {
      schema: {
        body: BulkSetRemediationStateRequest,
        response: {
          200: BulkSetRemediationStateResponse,
          409: ErrorResponse,
        },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const body = request.body;
      const ids = body.items.map((item) => item.id);

      if (new Set(ids).size !== ids.length) {
        throw validationError("Each finding may appear only once in a batch.");
      }

      await requireCaseWrite(app.db, user, body.caseId);
      const existing = await app.db
        .select()
        .from(schema.findings)
        .where(inArray(schema.findings.id, ids));

      if (
        existing.length !== ids.length ||
        existing.some((finding) => finding.caseId !== body.caseId)
      ) {
        throw notFound("One or more findings could not be found in this case.");
      }

      const byId = new Map(existing.map((finding) => [finding.id, finding]));
      for (const item of body.items) {
        assertRevision(byId.get(item.id)!, item.expectedRevision, "finding");
      }

      const changes = body.items.filter(
        (item) => byId.get(item.id)!.remediationState !== body.remediationState,
      );

      await app.db.transaction(async (tx) => {
        for (const item of changes) {
          const finding = byId.get(item.id)!;
          const updated = await tx
            .update(schema.findings)
            .set({
              remediationState: body.remediationState,
              revision: finding.revision + 1,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(schema.findings.id, finding.id),
                eq(schema.findings.revision, item.expectedRevision),
              ),
            )
            .returning({ id: schema.findings.id });

          if (updated.length !== 1) {
            throw conflict(
              "A finding changed while the batch was being saved.",
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
              action: "finding.state_changed",
              entityType: "finding",
              entityId: finding.id,
              caseId: finding.caseId,
              before: { remediationState: finding.remediationState },
              after: { remediationState: body.remediationState },
            },
          );
        }
      });

      for (const item of changes) {
        await invalidateDependentSections(app, item.id);
        app.events.publish({
          type: "entity.changed",
          entityType: "finding",
          entityId: item.id,
          caseId: body.caseId,
        });
      }

      return { updatedIds: changes.map((item) => item.id) };
    },
  );

  app.patch(
    "/v1/findings/:id",
    {
      schema: {
        params: IdParam,
        body: UpdateFindingRequest,
        response: { 200: FindingDetail, 409: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const body = request.body;
      const existing = await requireFindingRow(app, request.params.id);

      const hasNonDisclosureChanges = Object.keys(body).some(
        (key) => key !== "expectedRevision" && key !== "disclosureState",
      );

      if (body.disclosureState !== undefined) {
        await requireCaseDisclosure(app.db, user, existing.caseId);
      }
      if (hasNonDisclosureChanges || body.disclosureState === undefined) {
        await requireCaseWrite(app.db, user, existing.caseId);
      }
      assertRevision(existing, body.expectedRevision, "finding");

      if (
        body.validationState !== undefined &&
        !canTransitionValidation(existing.validationState, body.validationState)
      ) {
        throw validationError(
          `A finding cannot move from ${existing.validationState} to ${body.validationState}.`,
        );
      }

      if (
        body.disclosureState !== undefined &&
        !canTransitionDisclosure(existing.disclosureState, body.disclosureState)
      ) {
        throw validationError(
          `Disclosure cannot move from ${existing.disclosureState} to ${body.disclosureState}.`,
        );
      }

      if (body.cweIds !== undefined) {
        const invalid = body.cweIds.filter((id) => !isValidCweId(id));

        if (invalid.length > 0) {
          throw validationError(
            `Not valid CWE identifiers: ${invalid.join(", ")}`,
          );
        }
      }

      await app.db.transaction(async (tx) => {
        await tx
          .update(schema.findings)
          .set({
            ...pickDefined(body, [
              "title",
              "summaryMarkdown",
              "technicalMarkdown",
              "preconditionsMarkdown",
              "attackPathMarkdown",
              "impactMarkdown",
              "reproductionMarkdown",
              "remediationMarkdown",
              "researcherNotesMarkdown",
              "validationState",
              "remediationState",
              "disclosureState",
              "externalIdState",
              "priorArtState",
              "visibility",
              "cweIds",
            ]),
            revision: existing.revision + 1,
            updatedAt: sql`now()`,
          })
          .where(eq(schema.findings.id, existing.id));

        const changes = collectFindingRevisionChanges(existing, body);

        if (Object.keys(changes.after).length > 0) {
          await app.audit.write(
            tx,
            {
              actorId: user.id,
              sessionId: principal.session.id,
              requestId: request.requestId,
            },
            {
              action: changes.stateOnly
                ? "finding.state_changed"
                : "finding.updated",
              entityType: "finding",
              entityId: existing.id,
              caseId: existing.caseId,
              before: changes.before,
              after: changes.after,
            },
          );
        } else {
          await app.audit.write(
            tx,
            {
              actorId: user.id,
              sessionId: principal.session.id,
              requestId: request.requestId,
            },
            {
              action: "finding.updated",
              entityType: "finding",
              entityId: existing.id,
              caseId: existing.caseId,
            },
          );
        }
      });

      // Report sections that quoted this finding can no longer claim to have
      // been reviewed against its current content.
      await invalidateDependentSections(app, existing.id);

      app.events.publish({
        type: "entity.changed",
        entityType: "finding",
        entityId: existing.id,
        caseId: existing.caseId,
      });

      return loadFindingDetail(app.db, existing.id);
    },
  );

  app.post(
    "/v1/findings/:id/assets",
    {
      schema: {
        params: IdParam,
        body: LinkFindingAssetRequest,
        response: { 200: FindingDetail },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const existing = await requireFindingRow(app, request.params.id);

      await requireCaseWrite(app.db, user, existing.caseId);

      const { assetId, primary } = request.body;

      await app.db.transaction(async (tx) => {
        if (primary === true) {
          await tx
            .update(schema.findingAssets)
            .set({ primary: false })
            .where(eq(schema.findingAssets.findingId, existing.id));
        }

        await tx
          .insert(schema.findingAssets)
          .values({
            findingId: existing.id,
            assetId,
            primary: primary ?? false,
          })
          .onConflictDoUpdate({
            target: [
              schema.findingAssets.findingId,
              schema.findingAssets.assetId,
            ],
            set: { primary: primary ?? false },
          });

        await tx
          .insert(schema.caseAssets)
          .values({ caseId: existing.caseId, assetId })
          .onConflictDoNothing();
      });

      return loadFindingDetail(app.db, existing.id);
    },
  );

  app.post(
    "/v1/findings/:id/affected-ranges",
    {
      schema: {
        params: IdParam,
        body: AddAffectedRangeRequest,
        response: { 200: FindingDetail },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const existing = await requireFindingRow(app, request.params.id);

      await requireCaseWrite(app.db, user, existing.caseId);

      const body = request.body;

      await app.db.insert(schema.affectedRanges).values({
        findingId: existing.id,
        assetId: body.assetId,
        kind: body.kind,
        expression: body.expression,
        status: body.status,
        fixedIn: body.fixedIn ?? null,
        evidenceNote: body.evidenceNote ?? null,
        verifiedAt: body.verifiedAt ?? null,
        createdBy: user.id,
      });

      await invalidateDependentSections(app, existing.id);

      return loadFindingDetail(app.db, existing.id);
    },
  );

  app.post(
    "/v1/findings/:id/scores",
    {
      schema: {
        params: IdParam,
        body: AddFindingScoreRequest,
        response: { 200: FindingDetail, 400: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const existing = await requireFindingRow(app, request.params.id);

      await requireCaseWrite(app.db, user, existing.caseId);

      const body = request.body;

      if (body.approve === true) {
        await requireCaseApproval(app.db, user, existing.caseId);
      }
      const normalised = normaliseScoreSubmission({
        scheme: body.scheme,
        vector: body.vector,
        score: body.score,
        metrics: body.metrics,
        sourceName: body.sourceName,
      });

      await app.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(schema.findingScores)
          .values({
            findingId: existing.id,
            scheme: normalised.scheme,
            vector: normalised.vector,
            score: normalised.score,
            severity: normalised.severity,
            metrics: normalised.metrics,
            // A score arriving through this route is a human decision; AI
            // proposals reach the table only via the proposal-accept path.
            source: normalised.sourceName === null ? "HUMAN" : "EXTERNAL",
            reasoningMarkdown: body.reasoningMarkdown ?? null,
            sourceName: normalised.sourceName,
            retrievedAt: normalised.sourceName === null ? null : sql`now()`,
            createdBy: user.id,
          })
          .returning({ id: schema.findingScores.id });

        if (inserted === undefined) {
          throw new DomainError("SERVER_ERROR", "Could not record the score.");
        }

        if (body.approve === true) {
          await approveScore(tx, existing.id, inserted.id, user.id);

          await app.audit.write(
            tx,
            {
              actorId: user.id,
              sessionId: principal.session.id,
              requestId: request.requestId,
            },
            {
              action: "score.approved",
              entityType: "finding_score",
              entityId: inserted.id,
              caseId: existing.caseId,
              after: {
                findingId: existing.id,
                scheme: normalised.scheme,
                vector: normalised.vector,
                score: normalised.score,
              },
            },
          );
        }
      });

      await invalidateDependentSections(app, existing.id);

      return loadFindingDetail(app.db, existing.id);
    },
  );

  app.post(
    "/v1/findings/:id/scores/:scoreId/approve",
    {
      schema: {
        params: Type.Object({
          id: IdParam.properties.id,
          scoreId: IdParam.properties.id,
        }),
        response: { 200: FindingDetail },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const existing = await requireFindingRow(app, request.params.id);
      const { scoreId } = request.params;

      await requireCaseApproval(app.db, user, existing.caseId);

      await app.db.transaction(async (tx) => {
        await approveScore(tx, existing.id, scoreId, user.id);

        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "score.approved",
            entityType: "finding_score",
            entityId: scoreId,
            caseId: existing.caseId,
          },
        );
      });

      return loadFindingDetail(app.db, existing.id);
    },
  );

  app.post(
    "/v1/findings/:id/identifiers",
    {
      schema: {
        params: IdParam,
        body: AddFindingIdentifierRequest,
        response: { 200: FindingDetail, 400: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const existing = await requireFindingRow(app, request.params.id);

      await requireCaseWrite(app.db, user, existing.caseId);

      const identifier = prepareExternalIdentifier(
        request.body.scheme,
        request.body.value,
      );

      if (identifier === null) {
        throw validationError(
          `"${request.body.value}" is not a valid ${request.body.scheme} identifier.`,
        );
      }

      await app.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(schema.findingIdentifiers)
          .values({
            findingId: existing.id,
            ...identifier,
            createdBy: user.id,
          })
          .onConflictDoNothing()
          .returning({ id: schema.findingIdentifiers.id });

        // Retried requests are idempotent and do not create duplicate audit
        // events for the unique identifier that already exists.
        if (inserted === undefined) {
          return;
        }

        // Recording a CVE is a state change in its own right: it moves the
        // finding's external-identifier state without touching the others.
        if (
          identifier.scheme === "CVE" &&
          existing.externalIdState !== "CVE_PUBLISHED"
        ) {
          await tx
            .update(schema.findings)
            .set({ externalIdState: "CVE_RESERVED", updatedAt: sql`now()` })
            .where(eq(schema.findings.id, existing.id));
        }

        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "finding.identifier_added",
            entityType: "finding",
            entityId: existing.id,
            caseId: existing.caseId,
            after: {
              scheme: identifier.scheme,
              value: identifier.value,
            },
          },
        );
      });

      return loadFindingDetail(app.db, existing.id);
    },
  );

  app.post(
    "/v1/findings/:id/claims",
    {
      schema: {
        params: IdParam,
        body: CreateClaimRequest,
        response: { 200: Claim },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const existing = await requireFindingRow(app, request.params.id);

      await requireCaseWrite(app.db, user, existing.caseId);

      const body = request.body;
      const [row] = await app.db
        .insert(schema.claims)
        .values({
          findingId: existing.id,
          key: body.key,
          statementMarkdown: body.statementMarkdown,
          value: body.value ?? null,
          sourceType: body.sourceType,
          sourceRef: body.sourceRef ?? null,
          confidence: body.confidence,
          visibility: body.visibility,
          // A claim entered by a person is reviewed by definition; one proposed
          // by AI stays unreviewed until someone accepts the proposal.
          reviewedBy: body.sourceType === "AI_PROPOSAL" ? null : user.id,
          retrievedAt: body.retrievedAt ?? null,
          expiresAt: body.expiresAt ?? null,
          createdBy: user.id,
        })
        .returning();

      if (row === undefined) {
        throw new DomainError("SERVER_ERROR", "Could not record the claim.");
      }

      return {
        id: row.id,
        findingId: row.findingId,
        key: row.key,
        statementMarkdown: row.statementMarkdown,
        value: row.value,
        sourceType: row.sourceType,
        sourceRef: row.sourceRef,
        confidence: row.confidence,
        visibility: row.visibility,
        reviewedBy:
          row.reviewedBy === null
            ? null
            : {
                id: principal.user.id,
                displayName: principal.user.displayName,
                email: principal.user.email,
              },
        retrievedAt: row.retrievedAt,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
      };
    },
  );

  app.post(
    "/v1/findings/:id/references",
    {
      schema: {
        params: IdParam,
        body: CreateReferenceRequest,
        response: { 200: ExternalReference },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const existing = await requireFindingRow(app, request.params.id);

      await requireCaseWrite(app.db, user, existing.caseId);

      const body = request.body;

      if (!/^https?:\/\//i.test(body.url)) {
        throw validationError("A reference URL must use http or https.");
      }

      const row = await app.db.transaction(async (tx) => {
        const ref = await allocateReference(
          tx,
          user.organizationId,
          "reference",
        );
        const [inserted] = await tx
          .insert(schema.externalReferences)
          .values({
            ref,
            findingId: existing.id,
            caseId: existing.caseId,
            title: body.title,
            url: body.url,
            publisher: body.publisher ?? null,
            publishedAt: body.publishedAt ?? null,
            retrievedAt: sql`now()`,
            visibility: body.visibility,
            note: body.note ?? null,
            createdBy: user.id,
          })
          .returning();

        return inserted;
      });

      if (row === undefined) {
        throw new DomainError(
          "SERVER_ERROR",
          "Could not record the reference.",
        );
      }

      return {
        id: row.id,
        ref: row.ref,
        title: row.title,
        url: row.url,
        publisher: row.publisher,
        publishedAt: row.publishedAt,
        retrievedAt: row.retrievedAt,
        visibility: row.visibility,
        note: row.note,
        createdAt: row.createdAt,
      };
    },
  );
}

type FindingRow = typeof schema.findings.$inferSelect;

async function requireFindingRow(
  app: AppInstance,
  findingId: string,
): Promise<FindingRow> {
  const rows = await app.db
    .select()
    .from(schema.findings)
    .where(eq(schema.findings.id, findingId))
    .limit(1);

  const row = rows[0];

  if (row === undefined) {
    throw notFound("Finding");
  }

  return row;
}

async function requireFindingRead(
  app: AppInstance,
  user: ActingUser,
  findingId: string,
): Promise<FindingRow> {
  const row = await requireFindingRow(app, findingId);

  // Reading a finding requires read access to its case, so a restricted case
  // hides its findings from anyone not on the allow-list.
  await requireCaseRead(app.db, user, row.caseId);

  return row;
}

function pickDefined<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[],
): Partial<Pick<T, K>> {
  const result: Partial<Pick<T, K>> = {};

  for (const key of keys) {
    const value = source[key];

    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Marks approved report sections that cite this finding as needing review.
 *
 * The content is never rewritten — the researcher decides what the change means
 * for the prose. All CodeVault does is refuse to keep calling it approved.
 */
async function invalidateDependentSections(
  app: AppInstance,
  findingId: string,
): Promise<void> {
  const sourceRef = `finding:${findingId}`;

  await app.db
    .update(schema.reportSections)
    .set({ reviewState: "NEEDS_REVIEW", updatedAt: sql`now()` })
    .where(
      and(
        eq(schema.reportSections.reviewState, "APPROVED"),
        sql`${schema.reportSections.sourceRefs} @> ${JSON.stringify([sourceRef])}::jsonb`,
      ),
    );
}
