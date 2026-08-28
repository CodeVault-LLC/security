import type { AppInstance } from "../../http/app-instance.js";
import { and, desc, eq, inArray, lt, or, sql, type SQL } from "drizzle-orm";

import {
  AddCaseMemberRequest,
  CaseAccessHistoryResponse,
  type CaseAccessHistoryEvent,
  CaseAccessReviewResponse,
  type CaseAccessReviewPrincipal,
  type CaseCapability,
  CaseDetail,
  CaseListResponse,
  CaseReadiness,
  type CaseSummary,
  CreateCaseNoteRequest,
  CaseNote,
  CreateCaseRequest,
  DuplicateCaseRequest,
  ErrorResponse,
  IdParam,
  ListCaseAccessHistoryQuery,
  ListCaseAccessReviewQuery,
  ListCasesQuery,
  OkResponse,
  UpdateCaseRequest,
} from "@codevault/contracts";
import {
  CASE_CAPABILITIES,
  canManageCaseMembers,
  DomainError,
  defaultPolicyPackForProfile,
  notFound,
  permissionDenied,
  type ActingUser,
  validationError,
} from "@codevault/core";
import { allocateReference, schema } from "@codevault/db";
import { Type } from "@sinclair/typebox";

import { assertRevision } from "../../http/concurrency.js";
import { actingUser, principalOf, requireAuthor } from "../../http/guards.js";
import { decodeCursor, pageSize, paginate } from "../../http/pagination.js";
import {
  loadCaseAccess,
  requireCaseRead,
  requireCaseWrite,
} from "../../services/case-access.js";
import { evaluateCaseReadiness } from "./readiness.js";

/**
 * Research case routes.
 *
 * Creating a case takes a title and a profile. Everything else — assets,
 * findings, disclosure, reports — accretes as the research happens.
 */

const CaseNoteListResponse = Type.Object({ items: Type.Array(CaseNote) });

export async function registerCaseRoutes(app: AppInstance): Promise<void> {
  app.get(
    "/v1/cases",
    {
      schema: {
        querystring: ListCasesQuery,
        response: { 200: CaseListResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      const size = pageSize(request.query.limit);
      const cursor =
        request.query.page === undefined
          ? decodeCursor(request.query.cursor)
          : null;

      const visibility = visibilityCondition(user);
      const filters: SQL[] = [visibility];

      if (request.query.status !== undefined) {
        filters.push(eq(schema.cases.status, request.query.status));
      }

      if (request.query.profile !== undefined) {
        filters.push(eq(schema.cases.profile, request.query.profile));
      }

      if (request.query.ownerId !== undefined) {
        filters.push(eq(schema.cases.ownerId, request.query.ownerId));
      }

      if (request.query.query !== undefined) {
        const pattern = `%${request.query.query}%`;

        filters.push(
          sql`(${schema.cases.title} ILIKE ${pattern} OR ${schema.cases.ref} ILIKE ${pattern})`,
        );
      }

      const [totalRow] = await app.db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.cases)
        .where(and(...filters));
      const total = totalRow?.total ?? 0;
      const rowFilters = [...filters];

      if (cursor !== null) {
        rowFilters.push(
          or(
            lt(schema.cases.updatedAt, cursor.timestamp),
            and(
              eq(schema.cases.updatedAt, cursor.timestamp),
              lt(schema.cases.id, cursor.id),
            ),
          ) as SQL,
        );
      }

      const rows = await app.db
        .select({
          id: schema.cases.id,
          ref: schema.cases.ref,
          title: schema.cases.title,
          summary: schema.cases.summary,
          profile: schema.cases.profile,
          status: schema.cases.status,
          restricted: schema.cases.restricted,
          disclosureEnabled: schema.cases.disclosureEnabled,
          revision: schema.cases.revision,
          createdAt: schema.cases.createdAt,
          updatedAt: schema.cases.updatedAt,
          ownerId: schema.users.id,
          ownerName: schema.users.displayName,
          ownerEmail: schema.users.email,
          findingCount: sql<number>`(
            SELECT count(*)::int FROM findings WHERE findings.case_id = ${schema.cases.id}
          )`,
        })
        .from(schema.cases)
        .innerJoin(schema.users, eq(schema.users.id, schema.cases.ownerId))
        .where(and(...rowFilters))
        .orderBy(desc(schema.cases.updatedAt), desc(schema.cases.id))
        .limit(size + 1)
        .offset(
          request.query.page === undefined
            ? 0
            : (request.query.page - 1) * size,
        );

      const page = paginate(rows, size, (row) => row.updatedAt);

      return {
        items: page.items.map(toCaseSummary),
        nextCursor: page.nextCursor,
        total,
      };
    },
  );

  app.get(
    "/v1/cases/access-review",
    {
      schema: {
        querystring: ListCaseAccessReviewQuery,
        response: { 200: CaseAccessReviewResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      const size = pageSize(request.query.limit);
      const cursor =
        request.query.page === undefined
          ? decodeCursor(request.query.cursor)
          : null;
      const filters: SQL[] = [visibilityCondition(user)];

      if (request.query.query !== undefined) {
        const pattern = `%${request.query.query}%`;
        filters.push(
          sql`(
            ${schema.cases.title} ILIKE ${pattern}
            OR ${schema.cases.ref} ILIKE ${pattern}
            OR EXISTS (
              SELECT 1 FROM users review_owner
              WHERE review_owner.id = ${schema.cases.ownerId}
                AND (
                  review_owner.display_name ILIKE ${pattern}
                  OR review_owner.email ILIKE ${pattern}
                )
            )
            OR EXISTS (
              SELECT 1
              FROM case_members review_member
              INNER JOIN users review_user
                ON review_user.id = review_member.user_id
              WHERE review_member.case_id = ${schema.cases.id}
                AND (
                  review_user.display_name ILIKE ${pattern}
                  OR review_user.email ILIKE ${pattern}
                )
            )
          )`,
        );
      }

      if (request.query.userId !== undefined) {
        filters.push(
          or(
            eq(schema.cases.ownerId, request.query.userId),
            sql`EXISTS (
              SELECT 1 FROM case_members review_member
              WHERE review_member.case_id = ${schema.cases.id}
                AND review_member.user_id = ${request.query.userId}
            )`,
          ) as SQL,
        );
      }

      const [totalRow] = await app.db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.cases)
        .where(and(...filters));
      const rowFilters = [...filters];

      if (cursor !== null) {
        rowFilters.push(
          or(
            lt(schema.cases.updatedAt, cursor.timestamp),
            and(
              eq(schema.cases.updatedAt, cursor.timestamp),
              lt(schema.cases.id, cursor.id),
            ),
          ) as SQL,
        );
      }

      const rows = await app.db
        .select({
          id: schema.cases.id,
          ref: schema.cases.ref,
          title: schema.cases.title,
          status: schema.cases.status,
          restricted: schema.cases.restricted,
          updatedAt: schema.cases.updatedAt,
          ownerId: schema.users.id,
          ownerName: schema.users.displayName,
          ownerEmail: schema.users.email,
          ownerDisabled: schema.users.disabled,
          ownerRole: schema.organizationMemberships.role,
        })
        .from(schema.cases)
        .innerJoin(schema.users, eq(schema.users.id, schema.cases.ownerId))
        .innerJoin(
          schema.organizationMemberships,
          and(
            eq(schema.organizationMemberships.userId, schema.users.id),
            eq(
              schema.organizationMemberships.organizationId,
              schema.cases.organizationId,
            ),
          ),
        )
        .where(and(...rowFilters))
        .orderBy(desc(schema.cases.updatedAt), desc(schema.cases.id))
        .limit(size + 1)
        .offset(
          request.query.page === undefined
            ? 0
            : (request.query.page - 1) * size,
        );
      const page = paginate(rows, size, (row) => row.updatedAt);
      const caseIds = page.items.map((row) => row.id);
      const ownerIdsByCase = new Map(
        page.items.map((row) => [row.id, row.ownerId]),
      );
      const memberRows =
        caseIds.length === 0
          ? []
          : await app.db
              .select({
                caseId: schema.caseMembers.caseId,
                canWrite: schema.caseMembers.canWrite,
                canApprove: schema.caseMembers.canApprove,
                canDisclose: schema.caseMembers.canDisclose,
                grantedAt: schema.caseMembers.createdAt,
                userId: schema.users.id,
                displayName: schema.users.displayName,
                email: schema.users.email,
                disabled: schema.users.disabled,
                role: schema.organizationMemberships.role,
              })
              .from(schema.caseMembers)
              .innerJoin(
                schema.users,
                eq(schema.users.id, schema.caseMembers.userId),
              )
              .innerJoin(
                schema.organizationMemberships,
                and(
                  eq(schema.organizationMemberships.userId, schema.users.id),
                  eq(
                    schema.organizationMemberships.organizationId,
                    user.organizationId,
                  ),
                ),
              )
              .where(inArray(schema.caseMembers.caseId, caseIds))
              .orderBy(
                schema.caseMembers.caseId,
                schema.users.displayName,
                schema.users.id,
              );
      const membersByCase = new Map<string, CaseAccessReviewPrincipal[]>();

      for (const member of memberRows) {
        // Ownership is authoritative. A stale explicit grant can survive an
        // ownership transfer, but must not render the same principal twice.
        if (ownerIdsByCase.get(member.caseId) === member.userId) continue;

        const grantedCapabilities = caseCapabilitiesFromFlags(member);
        const principal: CaseAccessReviewPrincipal = {
          user: {
            id: member.userId,
            displayName: member.displayName,
            email: member.email,
          },
          role: member.role,
          disabled: member.disabled,
          source: "GRANT",
          grantedCapabilities,
          effectiveCapabilities: effectiveCapabilities(
            member.role,
            member.disabled,
            grantedCapabilities,
          ),
          grantedAt: member.grantedAt,
        };
        const existing = membersByCase.get(member.caseId) ?? [];
        existing.push(principal);
        membersByCase.set(member.caseId, existing);
      }

      return {
        items: page.items.map((row) => {
          const grantedCapabilities = [...CASE_CAPABILITIES];
          const owner: CaseAccessReviewPrincipal = {
            user: {
              id: row.ownerId,
              displayName: row.ownerName,
              email: row.ownerEmail,
            },
            role: row.ownerRole,
            disabled: row.ownerDisabled,
            source: "OWNER",
            grantedCapabilities,
            effectiveCapabilities: effectiveCapabilities(
              row.ownerRole,
              row.ownerDisabled,
              grantedCapabilities,
            ),
            grantedAt: null,
          };

          return {
            id: row.id,
            ref: row.ref,
            title: row.title,
            status: row.status,
            restricted: row.restricted,
            principals: [owner, ...(membersByCase.get(row.id) ?? [])],
            updatedAt: row.updatedAt,
          };
        }),
        nextCursor: page.nextCursor,
        total: totalRow?.total ?? 0,
      };
    },
  );

  app.post(
    "/v1/cases",
    {
      schema: {
        body: CreateCaseRequest,
        response: { 200: CaseDetail, 403: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const body = request.body;
      const ownerId = body.ownerId ?? user.id;

      if (ownerId !== user.id && user.role !== "ADMIN") {
        throw permissionDenied(
          "Only an administrator may assign a case owner.",
        );
      }

      const created = await app.db.transaction(async (tx) => {
        const ref = await allocateReference(tx, user.organizationId, "case");
        const [row] = await tx
          .insert(schema.cases)
          .values({
            organizationId: user.organizationId,
            ref,
            title: body.title,
            summary: body.summary ?? null,
            profile: body.profile,
            ownerId,
            restricted: body.restricted ?? body.profile === "CRITICAL_ZERO_DAY",
            // Disclosure workflow stays hidden for standard research until the
            // researcher turns it on or the profile implies it.
            disclosureEnabled: body.profile !== "STANDARD",
          })
          .returning();

        if (row === undefined) {
          throw new DomainError("SERVER_ERROR", "Could not create the case.");
        }

        const policyPack = defaultPolicyPackForProfile(body.profile);

        await tx
          .insert(schema.casePolicyPacks)
          .values({ caseId: row.id, policyPackId: policyPack.id })
          .onConflictDoNothing();

        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "case.created",
            entityType: "case",
            entityId: row.id,
            caseId: row.id,
            after: { ref, title: row.title, profile: row.profile },
          },
        );

        return row;
      });

      app.events.publish({
        type: "entity.changed",
        entityType: "case",
        entityId: created.id,
        caseId: created.id,
      });

      return {
        ...toCaseSummary({
          ...created,
          ownerId: principal.user.id,
          ownerName: principal.user.displayName,
          ownerEmail: principal.user.email,
          findingCount: 0,
        }),
        members: [],
        policyPackIds: [defaultPolicyPackForProfile(created.profile).id],
      };
    },
  );

  app.get(
    "/v1/cases/:id",
    {
      schema: {
        params: IdParam,
        response: { 200: CaseDetail, 404: ErrorResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      const access = await requireCaseRead(app.db, user, request.params.id);

      return loadCaseDetail(app, access.caseId);
    },
  );

  app.post(
    "/v1/cases/:id/duplicate",
    {
      schema: {
        params: IdParam,
        body: DuplicateCaseRequest,
        response: { 200: CaseDetail, 403: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const access = await requireCaseWrite(app.db, user, request.params.id);
      const [source] = await app.db
        .select()
        .from(schema.cases)
        .where(eq(schema.cases.id, access.caseId))
        .limit(1);

      if (source === undefined) throw notFound("Case");

      const duplicateId = await app.db.transaction(async (tx) => {
        const ref = await allocateReference(tx, user.organizationId, "case");
        const [duplicate] = await tx
          .insert(schema.cases)
          .values({
            organizationId: user.organizationId,
            ref,
            title: request.body.title,
            summary: source.summary,
            profile: source.profile,
            ownerId: user.id,
            restricted: source.restricted,
            disclosureEnabled: source.disclosureEnabled,
          })
          .returning({ id: schema.cases.id });

        if (duplicate === undefined) {
          throw new DomainError(
            "SERVER_ERROR",
            "Could not duplicate the case.",
          );
        }

        const policyPacks = await tx
          .select({ policyPackId: schema.casePolicyPacks.policyPackId })
          .from(schema.casePolicyPacks)
          .where(eq(schema.casePolicyPacks.caseId, source.id));
        const policyPackIds =
          policyPacks.length === 0
            ? [defaultPolicyPackForProfile(source.profile).id]
            : policyPacks.map((pack) => pack.policyPackId);
        await tx.insert(schema.casePolicyPacks).values(
          policyPackIds.map((policyPackId) => ({
            caseId: duplicate.id,
            policyPackId,
          })),
        );

        if (request.body.copyAssets ?? true) {
          const assetLinks = await tx
            .select({ assetId: schema.caseAssets.assetId })
            .from(schema.caseAssets)
            .where(eq(schema.caseAssets.caseId, source.id));
          if (assetLinks.length > 0) {
            await tx.insert(schema.caseAssets).values(
              assetLinks.map((link) => ({
                caseId: duplicate.id,
                assetId: link.assetId,
              })),
            );
          }
        }

        if (request.body.copyMembers ?? false) {
          const members = await tx
            .select({
              userId: schema.caseMembers.userId,
              canWrite: schema.caseMembers.canWrite,
              canApprove: schema.caseMembers.canApprove,
              canDisclose: schema.caseMembers.canDisclose,
            })
            .from(schema.caseMembers)
            .where(eq(schema.caseMembers.caseId, source.id));
          const copiedMembers = members.filter(
            (member) => member.userId !== user.id,
          );
          if (copiedMembers.length > 0) {
            await tx.insert(schema.caseMembers).values(
              copiedMembers.map((member) => ({
                caseId: duplicate.id,
                userId: member.userId,
                canWrite: member.canWrite,
                canApprove: member.canApprove,
                canDisclose: member.canDisclose,
                addedBy: user.id,
              })),
            );
          }
        }

        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "case.duplicated",
            entityType: "case",
            entityId: duplicate.id,
            caseId: duplicate.id,
            after: {
              sourceCaseId: source.id,
              ref,
              title: request.body.title,
              copyAssets: request.body.copyAssets ?? true,
              copyMembers: request.body.copyMembers ?? false,
            },
          },
        );

        return duplicate.id;
      });

      app.events.publish({
        type: "entity.changed",
        entityType: "case",
        entityId: duplicateId,
        caseId: duplicateId,
      });

      return loadCaseDetail(app, duplicateId);
    },
  );

  app.patch(
    "/v1/cases/:id",
    {
      schema: {
        params: IdParam,
        body: UpdateCaseRequest,
        response: { 200: CaseDetail, 409: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const access = await requireCaseWrite(app.db, user, request.params.id);
      const body = request.body;

      const rows = await app.db
        .select()
        .from(schema.cases)
        .where(eq(schema.cases.id, access.caseId))
        .limit(1);

      const existing = rows[0];

      if (existing === undefined) {
        throw notFound("Case");
      }

      assertRevision(existing, body.expectedRevision, "case");

      if (
        body.ownerId !== undefined &&
        user.role !== "ADMIN" &&
        user.id !== existing.ownerId
      ) {
        throw permissionDenied(
          "Only the owner or an administrator may reassign a case.",
        );
      }

      const newOwnerId = body.ownerId;

      if (newOwnerId !== undefined && newOwnerId !== existing.ownerId) {
        const target = await app.db
          .select({ id: schema.users.id })
          .from(schema.users)
          .innerJoin(
            schema.organizationMemberships,
            eq(schema.organizationMemberships.userId, schema.users.id),
          )
          .where(
            and(
              eq(schema.users.id, newOwnerId),
              eq(schema.users.disabled, false),
              eq(
                schema.organizationMemberships.organizationId,
                access.organizationId,
              ),
            ),
          )
          .limit(1);

        if (target.length === 0) {
          throw notFound("User");
        }
      }

      await app.db.transaction(async (tx) => {
        const updated = await tx
          .update(schema.cases)
          .set({
            ...(body.title === undefined ? {} : { title: body.title }),
            ...(body.summary === undefined ? {} : { summary: body.summary }),
            ...(body.profile === undefined ? {} : { profile: body.profile }),
            ...(body.status === undefined ? {} : { status: body.status }),
            ...(body.ownerId === undefined ? {} : { ownerId: body.ownerId }),
            ...(body.restricted === undefined
              ? {}
              : { restricted: body.restricted }),
            ...(body.disclosureEnabled === undefined
              ? {}
              : { disclosureEnabled: body.disclosureEnabled }),
            ...(body.status === "ARCHIVED" ? { archivedAt: sql`now()` } : {}),
            revision: existing.revision + 1,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(schema.cases.id, access.caseId),
              eq(schema.cases.revision, body.expectedRevision),
            ),
          )
          .returning({ id: schema.cases.id });

        if (updated.length === 0) {
          const [current] = await tx
            .select({ revision: schema.cases.revision })
            .from(schema.cases)
            .where(eq(schema.cases.id, access.caseId))
            .limit(1);
          if (current === undefined) throw notFound("Case");
          assertRevision(current, body.expectedRevision, "case");
          throw new DomainError("SERVER_ERROR", "Could not update the case.");
        }

        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "case.updated",
            entityType: "case",
            entityId: access.caseId,
            caseId: access.caseId,
            before: {
              title: existing.title,
              status: existing.status,
              restricted: existing.restricted,
              ownerId: existing.ownerId,
            },
            after: {
              title: body.title ?? existing.title,
              status: body.status ?? existing.status,
              restricted: body.restricted ?? existing.restricted,
              ownerId: body.ownerId ?? existing.ownerId,
            },
          },
        );
      });

      if (newOwnerId !== undefined && newOwnerId !== existing.ownerId) {
        app.events.publish({
          type: "case.access_changed",
          entityType: "case_access",
          entityId: access.caseId,
          caseId: access.caseId,
          targetUserId: existing.ownerId,
          detail: { canRead: false },
        });
        app.events.publish({
          type: "case.access_changed",
          entityType: "case_access",
          entityId: access.caseId,
          caseId: access.caseId,
          targetUserId: newOwnerId,
          detail: {
            canRead: true,
            capabilities: ["READ", "WRITE", "APPROVAL", "DISCLOSURE"],
          },
        });
      }

      app.events.publish({
        type: "entity.changed",
        entityType: "case",
        entityId: access.caseId,
        caseId: access.caseId,
      });

      return loadCaseDetail(app, access.caseId);
    },
  );

  app.post(
    "/v1/cases/:id/members",
    {
      schema: {
        params: IdParam,
        body: AddCaseMemberRequest,
        response: { 200: CaseDetail, 403: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const access = await requireCaseRead(app.db, user, request.params.id);

      if (!canManageCaseMembers(user, access.context)) {
        throw permissionDenied(
          "Only the case owner or an administrator may change membership.",
        );
      }

      const { userId, capabilities } = request.body;
      const granted = new Set(capabilities);

      if (userId === access.ownerId) {
        throw validationError(
          "The case owner already has every capability implicitly.",
        );
      }

      const target = await app.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .innerJoin(
          schema.organizationMemberships,
          eq(schema.organizationMemberships.userId, schema.users.id),
        )
        .where(
          and(
            eq(schema.users.id, userId),
            eq(schema.users.disabled, false),
            eq(
              schema.organizationMemberships.organizationId,
              access.organizationId,
            ),
          ),
        )
        .limit(1);

      if (target.length === 0) {
        throw notFound("User");
      }

      const changed = await app.db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${access.caseId}:${userId}`}, 0))`,
        );
        const [existingMember] = await tx
          .select({
            canWrite: schema.caseMembers.canWrite,
            canApprove: schema.caseMembers.canApprove,
            canDisclose: schema.caseMembers.canDisclose,
          })
          .from(schema.caseMembers)
          .where(
            and(
              eq(schema.caseMembers.caseId, access.caseId),
              eq(schema.caseMembers.userId, userId),
            ),
          )
          .limit(1)
          .for("update");
        const beforeCapabilities =
          existingMember === undefined
            ? []
            : caseCapabilitiesFromFlags(existingMember);
        const afterCapabilities = CASE_CAPABILITIES.filter((capability) =>
          granted.has(capability),
        );

        if (sameCapabilities(beforeCapabilities, afterCapabilities)) {
          return false;
        }

        if (existingMember === undefined) {
          await tx.insert(schema.caseMembers).values({
            caseId: access.caseId,
            userId,
            canWrite: granted.has("WRITE"),
            canApprove: granted.has("APPROVAL"),
            canDisclose: granted.has("DISCLOSURE"),
            addedBy: user.id,
          });
        } else {
          await tx
            .update(schema.caseMembers)
            .set({
              canWrite: granted.has("WRITE"),
              canApprove: granted.has("APPROVAL"),
              canDisclose: granted.has("DISCLOSURE"),
            })
            .where(
              and(
                eq(schema.caseMembers.caseId, access.caseId),
                eq(schema.caseMembers.userId, userId),
              ),
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
            action:
              existingMember === undefined
                ? "case.member_added"
                : "case.member_updated",
            entityType: "case",
            entityId: access.caseId,
            caseId: access.caseId,
            before: { userId, capabilities: beforeCapabilities },
            after: { userId, capabilities: afterCapabilities },
          },
        );

        return true;
      });

      if (changed) {
        app.events.publish({
          type: "case.access_changed",
          entityType: "case_access",
          entityId: access.caseId,
          caseId: access.caseId,
          targetUserId: userId,
          detail: { canRead: true, capabilities },
        });
        app.events.publish({
          type: "entity.changed",
          entityType: "case",
          entityId: access.caseId,
          caseId: access.caseId,
        });
      }

      return loadCaseDetail(app, access.caseId);
    },
  );

  app.delete(
    "/v1/cases/:id/members/:userId",
    {
      schema: {
        params: Type.Object({
          id: IdParam.properties.id,
          userId: IdParam.properties.id,
        }),
        response: { 200: OkResponse, 403: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const access = await requireCaseRead(app.db, user, request.params.id);

      if (!canManageCaseMembers(user, access.context)) {
        throw permissionDenied(
          "Only the case owner or an administrator may change membership.",
        );
      }

      if (request.params.userId === access.ownerId) {
        throw validationError(
          "The case owner cannot be removed from the case.",
        );
      }

      const revoked = await app.db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${access.caseId}:${request.params.userId}`}, 0))`,
        );
        const removed = await tx
          .delete(schema.caseMembers)
          .where(
            and(
              eq(schema.caseMembers.caseId, access.caseId),
              eq(schema.caseMembers.userId, request.params.userId),
            ),
          )
          .returning({
            userId: schema.caseMembers.userId,
            canWrite: schema.caseMembers.canWrite,
            canApprove: schema.caseMembers.canApprove,
            canDisclose: schema.caseMembers.canDisclose,
          });

        if (removed[0] === undefined) {
          return false;
        }

        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "case.member_removed",
            entityType: "case",
            entityId: access.caseId,
            caseId: access.caseId,
            before: {
              userId: request.params.userId,
              capabilities: caseCapabilitiesFromFlags(removed[0]),
            },
          },
        );

        return true;
      });

      if (revoked) {
        app.events.publish({
          type: "case.access_changed",
          entityType: "case_access",
          entityId: access.caseId,
          caseId: access.caseId,
          targetUserId: request.params.userId,
          detail: { canRead: false },
        });
        app.events.publish({
          type: "entity.changed",
          entityType: "case",
          entityId: access.caseId,
          caseId: access.caseId,
        });
      }

      return { ok: true as const };
    },
  );

  app.get(
    "/v1/cases/:id/access-history",
    {
      schema: {
        params: IdParam,
        querystring: ListCaseAccessHistoryQuery,
        response: { 200: CaseAccessHistoryResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      const access = await requireCaseRead(app.db, user, request.params.id);
      const size = pageSize(request.query.limit);
      const cursor =
        request.query.page === undefined
          ? decodeCursor(request.query.cursor)
          : null;
      const filters: SQL[] = [
        eq(schema.auditEvents.caseId, access.caseId),
        or(
          inArray(schema.auditEvents.action, [
            "case.member_added",
            "case.member_updated",
            "case.member_removed",
          ]),
          and(
            eq(schema.auditEvents.action, "case.updated"),
            sql`(${schema.auditEvents.before}->>'ownerId') IS DISTINCT FROM (${schema.auditEvents.after}->>'ownerId')`,
          ),
        ) as SQL,
      ];
      const [totalRow] = await app.db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.auditEvents)
        .where(and(...filters));

      if (cursor !== null) {
        filters.push(
          or(
            lt(schema.auditEvents.occurredAt, cursor.timestamp),
            and(
              eq(schema.auditEvents.occurredAt, cursor.timestamp),
              lt(schema.auditEvents.id, cursor.id),
            ),
          ) as SQL,
        );
      }

      const rows = await app.db
        .select({
          id: schema.auditEvents.id,
          action: schema.auditEvents.action,
          actorId: schema.auditEvents.actorId,
          requestId: schema.auditEvents.requestId,
          before: schema.auditEvents.before,
          after: schema.auditEvents.after,
          occurredAt: schema.auditEvents.occurredAt,
        })
        .from(schema.auditEvents)
        .where(and(...filters))
        .orderBy(
          desc(schema.auditEvents.occurredAt),
          desc(schema.auditEvents.id),
        )
        .limit(size + 1)
        .offset(
          request.query.page === undefined
            ? 0
            : (request.query.page - 1) * size,
        );
      const page = paginate(rows, size, (row) => row.occurredAt);
      const referencedUserIds = new Set<string>();

      for (const row of page.items) {
        if (row.actorId !== null) referencedUserIds.add(row.actorId);
        const subjectId = accessSubjectId(row.before, row.after);
        const previousSubjectId = stringField(row.before, "ownerId");
        if (subjectId !== null) referencedUserIds.add(subjectId);
        if (previousSubjectId !== null) {
          referencedUserIds.add(previousSubjectId);
        }
      }

      const referencedUsers =
        referencedUserIds.size === 0
          ? []
          : await app.db
              .select({
                id: schema.users.id,
                displayName: schema.users.displayName,
                email: schema.users.email,
              })
              .from(schema.users)
              .where(inArray(schema.users.id, [...referencedUserIds]));
      const usersById = new Map(
        referencedUsers.map((referencedUser) => [
          referencedUser.id,
          {
            id: referencedUser.id,
            displayName: referencedUser.displayName,
            email: referencedUser.email,
          },
        ]),
      );

      return {
        items: page.items.map((row) =>
          toCaseAccessHistoryEvent(row, usersById),
        ),
        nextCursor: page.nextCursor,
        total: totalRow?.total ?? 0,
      };
    },
  );

  app.get(
    "/v1/cases/:id/notes",
    {
      schema: { params: IdParam, response: { 200: CaseNoteListResponse } },
    },
    async (request) => {
      const user = actingUser(request);
      const access = await requireCaseRead(app.db, user, request.params.id);

      const rows = await app.db
        .select({
          id: schema.caseNotes.id,
          caseId: schema.caseNotes.caseId,
          title: schema.caseNotes.title,
          bodyMarkdown: schema.caseNotes.bodyMarkdown,
          createdAt: schema.caseNotes.createdAt,
          updatedAt: schema.caseNotes.updatedAt,
          authorId: schema.users.id,
          authorName: schema.users.displayName,
          authorEmail: schema.users.email,
        })
        .from(schema.caseNotes)
        .innerJoin(schema.users, eq(schema.users.id, schema.caseNotes.authorId))
        .where(eq(schema.caseNotes.caseId, access.caseId))
        .orderBy(desc(schema.caseNotes.updatedAt))
        .limit(200);

      return {
        items: rows.map((row) => ({
          id: row.id,
          caseId: row.caseId,
          title: row.title,
          bodyMarkdown: row.bodyMarkdown,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          author: {
            id: row.authorId,
            displayName: row.authorName,
            email: row.authorEmail,
          },
        })),
      };
    },
  );

  app.post(
    "/v1/cases/:id/notes",
    {
      schema: {
        params: IdParam,
        body: CreateCaseNoteRequest,
        response: { 200: CaseNote },
      },
    },
    async (request) => {
      const user = actingUser(request);
      const principal = principalOf(request);
      const access = await requireCaseWrite(app.db, user, request.params.id);

      const [row] = await app.db
        .insert(schema.caseNotes)
        .values({
          caseId: access.caseId,
          title: request.body.title ?? null,
          bodyMarkdown: request.body.bodyMarkdown,
          authorId: user.id,
        })
        .returning();

      if (row === undefined) {
        throw new DomainError("SERVER_ERROR", "Could not create the note.");
      }

      return {
        id: row.id,
        caseId: row.caseId,
        title: row.title,
        bodyMarkdown: row.bodyMarkdown,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        author: {
          id: principal.user.id,
          displayName: principal.user.displayName,
          email: principal.user.email,
        },
      };
    },
  );

  app.get(
    "/v1/cases/:id/readiness",
    { schema: { params: IdParam, response: { 200: CaseReadiness } } },
    async (request) => {
      const user = actingUser(request);
      const access = await requireCaseRead(app.db, user, request.params.id);

      return evaluateCaseReadiness(app.db, access.caseId);
    },
  );
}

interface CaseRowWithOwner {
  id: string;
  ref: string;
  title: string;
  summary: string | null;
  profile: CaseSummary["profile"];
  status: CaseSummary["status"];
  restricted: boolean;
  disclosureEnabled: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  findingCount: number;
}

function toCaseSummary(row: CaseRowWithOwner): CaseSummary {
  return {
    id: row.id,
    ref: row.ref,
    title: row.title,
    summary: row.summary,
    profile: row.profile,
    status: row.status,
    restricted: row.restricted,
    disclosureEnabled: row.disclosureEnabled,
    owner: {
      id: row.ownerId,
      displayName: row.ownerName,
      email: row.ownerEmail,
    },
    findingCount: row.findingCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revision: row.revision,
  };
}

/**
 * SQL condition limiting a list query to cases the user may read.
 *
 * Case ownership or an explicit membership row grants read access.
 */
function visibilityCondition(
  user: Pick<ActingUser, "id" | "organizationId">,
): SQL {
  return sql`${schema.cases.organizationId} = ${user.organizationId} AND (
    ${schema.cases.ownerId} = ${user.id}
    OR EXISTS (
      SELECT 1 FROM case_members cm
      WHERE cm.case_id = ${schema.cases.id} AND cm.user_id = ${user.id}
    )
  )`;
}

function caseCapabilitiesFromFlags(flags: {
  canWrite: boolean;
  canApprove: boolean;
  canDisclose: boolean;
}): CaseCapability[] {
  return [
    "READ",
    ...(flags.canWrite ? (["WRITE"] as const) : []),
    ...(flags.canApprove ? (["APPROVAL"] as const) : []),
    ...(flags.canDisclose ? (["DISCLOSURE"] as const) : []),
  ];
}

function effectiveCapabilities(
  role: CaseAccessReviewPrincipal["role"],
  disabled: boolean,
  granted: readonly CaseCapability[],
): CaseCapability[] {
  if (disabled) return [];
  if (role === "VIEWER") return granted.includes("READ") ? ["READ"] : [];
  return CASE_CAPABILITIES.filter((capability) => granted.includes(capability));
}

function sameCapabilities(
  left: readonly CaseCapability[],
  right: readonly CaseCapability[],
): boolean {
  return (
    left.length === right.length &&
    left.every((capability, index) => capability === right[index])
  );
}

function stringField(
  payload: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = payload?.[key];
  return typeof value === "string" ? value : null;
}

function accessSubjectId(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string | null {
  return (
    stringField(after, "userId") ??
    stringField(before, "userId") ??
    stringField(after, "ownerId")
  );
}

function capabilitiesField(
  payload: Record<string, unknown> | null,
): CaseCapability[] | null {
  const capabilities = payload?.["capabilities"];
  if (!Array.isArray(capabilities)) return null;

  return CASE_CAPABILITIES.filter((capability) =>
    capabilities.includes(capability),
  );
}

type AccessHistoryActor = NonNullable<CaseAccessHistoryEvent["actor"]>;

function toCaseAccessHistoryEvent(
  row: {
    id: string;
    action: string;
    actorId: string | null;
    requestId: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    occurredAt: string;
  },
  usersById: ReadonlyMap<string, AccessHistoryActor>,
): CaseAccessHistoryEvent {
  const ownerTransferred = row.action === "case.updated";
  const subjectId = accessSubjectId(row.before, row.after);
  const previousSubjectId = ownerTransferred
    ? stringField(row.before, "ownerId")
    : null;
  const beforeCapabilities = capabilitiesField(row.before);
  const afterCapabilities = capabilitiesField(row.after);
  let kind: CaseAccessHistoryEvent["kind"];

  if (ownerTransferred) kind = "OWNER_TRANSFERRED";
  else if (row.action === "case.member_removed") kind = "REVOKED";
  else if (row.action === "case.member_updated") kind = "UPDATED";
  else if (beforeCapabilities === null) kind = "LEGACY_CHANGE";
  else kind = "GRANTED";

  return {
    id: row.id,
    kind,
    actor: row.actorId === null ? null : (usersById.get(row.actorId) ?? null),
    subject: subjectId === null ? null : (usersById.get(subjectId) ?? null),
    previousSubject:
      previousSubjectId === null
        ? null
        : (usersById.get(previousSubjectId) ?? null),
    beforeCapabilities: ownerTransferred
      ? [...CASE_CAPABILITIES]
      : beforeCapabilities,
    afterCapabilities: ownerTransferred
      ? [...CASE_CAPABILITIES]
      : row.action === "case.member_removed"
        ? []
        : afterCapabilities,
    requestId: row.requestId,
    occurredAt: row.occurredAt,
  };
}

async function loadCaseDetail(
  app: AppInstance,
  caseId: string,
): Promise<CaseDetail> {
  const rows = await app.db
    .select({
      id: schema.cases.id,
      ref: schema.cases.ref,
      title: schema.cases.title,
      summary: schema.cases.summary,
      profile: schema.cases.profile,
      status: schema.cases.status,
      restricted: schema.cases.restricted,
      disclosureEnabled: schema.cases.disclosureEnabled,
      revision: schema.cases.revision,
      createdAt: schema.cases.createdAt,
      updatedAt: schema.cases.updatedAt,
      ownerId: schema.users.id,
      ownerName: schema.users.displayName,
      ownerEmail: schema.users.email,
      findingCount: sql<number>`(
        SELECT count(*)::int FROM findings WHERE findings.case_id = ${schema.cases.id}
      )`,
    })
    .from(schema.cases)
    .innerJoin(schema.users, eq(schema.users.id, schema.cases.ownerId))
    .where(eq(schema.cases.id, caseId))
    .limit(1);

  const row = rows[0];

  if (row === undefined) {
    throw notFound("Case");
  }

  const memberRows = await app.db
    .select({
      canWrite: schema.caseMembers.canWrite,
      canApprove: schema.caseMembers.canApprove,
      canDisclose: schema.caseMembers.canDisclose,
      addedAt: schema.caseMembers.createdAt,
      userId: schema.users.id,
      displayName: schema.users.displayName,
      email: schema.users.email,
    })
    .from(schema.caseMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.caseMembers.userId))
    .where(eq(schema.caseMembers.caseId, caseId));

  const packRows = await app.db
    .select({ policyPackId: schema.casePolicyPacks.policyPackId })
    .from(schema.casePolicyPacks)
    .where(eq(schema.casePolicyPacks.caseId, caseId));

  return {
    ...toCaseSummary(row),
    members: memberRows.map((member) => ({
      user: {
        id: member.userId,
        displayName: member.displayName,
        email: member.email,
      },
      capabilities: [
        "READ" as const,
        ...(member.canWrite ? (["WRITE"] as const) : []),
        ...(member.canApprove ? (["APPROVAL"] as const) : []),
        ...(member.canDisclose ? (["DISCLOSURE"] as const) : []),
      ],
      addedAt: member.addedAt,
    })),
    policyPackIds: packRows.map((pack) => pack.policyPackId),
  };
}

export { loadCaseAccess };
