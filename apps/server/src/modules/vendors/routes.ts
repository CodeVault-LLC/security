import type { AppInstance } from "../../http/app-instance.js";
import { and, desc, eq, lt, or, sql, type SQL } from "drizzle-orm";
import { Type } from "@sinclair/typebox";

import {
  CreateVendorPublicKeyRequest,
  CreateVendorRequest,
  CreateVendorRouteRequest,
  ErrorResponse,
  IdParam,
  ListVendorsQuery,
  PaginatedResponse,
  UpdateVendorRequest,
  UpdateVendorRouteRequest,
  Uuid,
  VendorDetail,
  VendorPublicKey,
  VendorRoute,
  VendorSummary,
  VerifyVendorPublicKeyRequest,
} from "@codevault/contracts";
import { DomainError, notFound, validationError } from "@codevault/core";
import { allocateReference, schema } from "@codevault/db";

import { assertRevision } from "../../http/concurrency.js";
import { actingUser, principalOf, requireAuthor } from "../../http/guards.js";
import { decodeCursor, pageSize, paginate } from "../../http/pagination.js";
import {
  assertUsableVendorKey,
  loadVendorDetail,
  loadVendorPublicKey,
  loadVendorRoute,
  normalizeVendorName,
  parseVendorPublicKey,
  requireVendor,
  toVendorSummary,
  vendorSlug,
} from "./service.js";

const VendorListResponse = PaginatedResponse(VendorSummary);
const VendorIdParam = Type.Object({ vendorId: Uuid });
const VendorKeyParam = Type.Object({ vendorId: Uuid, keyId: Uuid });
const ArchiveVendorRequest = Type.Object(
  { expectedRevision: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);

export async function registerVendorRoutes(app: AppInstance): Promise<void> {
  app.get(
    "/v1/vendors",
    {
      schema: {
        querystring: ListVendorsQuery,
        response: { 200: VendorListResponse },
      },
    },
    async (request) => {
      actingUser(request);

      const size = pageSize(request.query.limit);
      const cursor = decodeCursor(request.query.cursor);
      const filters: SQL[] = [];

      if (request.query.includeArchived !== true) {
        filters.push(sql`${schema.vendors.archivedAt} IS NULL`);
      }

      if (request.query.query !== undefined) {
        const pattern = `%${request.query.query.trim()}%`;
        filters.push(
          or(
            sql`${schema.vendors.name} ILIKE ${pattern}`,
            sql`${schema.vendors.ref} ILIKE ${pattern}`,
          ) as SQL,
        );
      }

      if (cursor !== null) {
        filters.push(
          or(
            lt(schema.vendors.updatedAt, cursor.timestamp),
            and(
              eq(schema.vendors.updatedAt, cursor.timestamp),
              lt(schema.vendors.id, cursor.id),
            ),
          ) as SQL,
        );
      }

      const rows = await app.db
        .select()
        .from(schema.vendors)
        .where(filters.length === 0 ? undefined : and(...filters))
        .orderBy(desc(schema.vendors.updatedAt), desc(schema.vendors.id))
        .limit(size + 1);
      const page = paginate(rows, size, (vendor) => vendor.updatedAt);

      return {
        items: page.items.map(toVendorSummary),
        nextCursor: page.nextCursor,
      };
    },
  );

  app.post(
    "/v1/vendors",
    {
      schema: {
        body: CreateVendorRequest,
        response: { 200: VendorDetail, 400: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const name = normalizeVendorName(request.body.name);
      const vendorId = await app.db.transaction(async (tx) => {
        const ref = await allocateReference(tx, user.organizationId, "vendor");
        const [created] = await tx
          .insert(schema.vendors)
          .values({
            ref,
            slug: vendorSlug(name.displayName),
            name: name.displayName,
            normalizedName: name.normalizedName,
            websiteUrl: request.body.websiteUrl ?? null,
            sourceUrl: request.body.sourceUrl ?? null,
            sourceReviewedAt: request.body.sourceReviewedAt ?? null,
            createdBy: user.id,
          })
          .returning({ id: schema.vendors.id });

        if (created === undefined) {
          throw new DomainError("SERVER_ERROR", "Could not create the vendor.");
        }

        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "vendor.created",
            entityType: "vendor",
            entityId: created.id,
            after: { ref, name: name.displayName },
          },
        );

        return created.id;
      });

      return loadVendorDetail(app, vendorId);
    },
  );

  app.get(
    "/v1/vendors/:id",
    {
      schema: {
        params: IdParam,
        response: { 200: VendorDetail, 404: ErrorResponse },
      },
    },
    async (request) => {
      actingUser(request);

      return loadVendorDetail(app, request.params.id);
    },
  );

  app.patch(
    "/v1/vendors/:id",
    {
      schema: {
        params: IdParam,
        body: UpdateVendorRequest,
        response: { 200: VendorDetail, 409: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const existing = await requireVendor(app.db, request.params.id);
      assertRevision(existing, request.body.expectedRevision, "vendor");

      const nextName =
        request.body.name === undefined
          ? null
          : normalizeVendorName(request.body.name);

      await app.db.transaction(async (tx) => {
        await tx
          .update(schema.vendors)
          .set({
            ...(nextName === null
              ? {}
              : {
                  name: nextName.displayName,
                  normalizedName: nextName.normalizedName,
                }),
            ...(request.body.websiteUrl === undefined
              ? {}
              : { websiteUrl: request.body.websiteUrl }),
            ...(request.body.sourceUrl === undefined
              ? {}
              : { sourceUrl: request.body.sourceUrl }),
            ...(request.body.sourceReviewedAt === undefined
              ? {}
              : { sourceReviewedAt: request.body.sourceReviewedAt }),
            ...(request.body.archived === undefined
              ? {}
              : {
                  archivedAt: request.body.archived ? sql`now()` : null,
                }),
            ...(existing.builtIn ? { builtInModifiedAt: sql`now()` } : {}),
            revision: existing.revision + 1,
            updatedAt: sql`now()`,
          })
          .where(eq(schema.vendors.id, existing.id));

        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "vendor.updated",
            entityType: "vendor",
            entityId: existing.id,
            before: { revision: existing.revision },
            after: { revision: existing.revision + 1 },
          },
        );
      });

      return loadVendorDetail(app, existing.id);
    },
  );

  app.delete(
    "/v1/vendors/:id",
    {
      schema: {
        params: IdParam,
        body: ArchiveVendorRequest,
        response: { 200: VendorDetail, 409: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const existing = await requireVendor(app.db, request.params.id);
      assertRevision(existing, request.body.expectedRevision, "vendor");

      await app.db
        .update(schema.vendors)
        .set({
          archivedAt: sql`now()`,
          ...(existing.builtIn ? { builtInModifiedAt: sql`now()` } : {}),
          revision: existing.revision + 1,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.vendors.id, existing.id));
      await app.audit.write(
        app.db,
        {
          actorId: user.id,
          sessionId: principalOf(request).session.id,
          requestId: request.requestId,
        },
        {
          action: "vendor.archived",
          entityType: "vendor",
          entityId: existing.id,
        },
      );

      return loadVendorDetail(app, existing.id);
    },
  );

  app.post(
    "/v1/vendors/:vendorId/routes",
    {
      schema: {
        params: VendorIdParam,
        body: CreateVendorRouteRequest,
        response: { 200: VendorRoute, 400: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const vendor = await requireVendor(app.db, request.params.vendorId);

      if (vendor.archivedAt !== null) {
        throw validationError("Archived vendors cannot receive new routes.");
      }

      await validateRouteKey(app, vendor.id, request.body);

      const [created] = await app.db
        .insert(schema.vendorRoutes)
        .values({
          vendorId: vendor.id,
          name: request.body.name.trim(),
          type: request.body.type,
          requirements: request.body as unknown as Record<string, unknown>,
          sourceUrl: request.body.sourceUrl ?? null,
          sourceReviewedAt: request.body.sourceReviewedAt ?? null,
          createdBy: user.id,
        })
        .returning({ id: schema.vendorRoutes.id });

      if (created === undefined) {
        throw new DomainError("SERVER_ERROR", "Could not create the route.");
      }

      await app.audit.write(
        app.db,
        {
          actorId: user.id,
          sessionId: principal.session.id,
          requestId: request.requestId,
        },
        {
          action: "vendor.route_created",
          entityType: "vendor_route",
          entityId: created.id,
          after: { vendorId: vendor.id, type: request.body.type },
        },
      );

      return loadVendorRoute(app.db, created.id);
    },
  );

  app.get(
    "/v1/vendor-routes/:id",
    {
      schema: { params: IdParam, response: { 200: VendorRoute } },
    },
    async (request) => {
      actingUser(request);

      return loadVendorRoute(app.db, request.params.id);
    },
  );

  app.patch(
    "/v1/vendor-routes/:id",
    {
      schema: {
        params: IdParam,
        body: UpdateVendorRouteRequest,
        response: { 200: VendorRoute, 409: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const existing = await rawVendorRoute(app, request.params.id);
      assertRevision(existing, request.body.expectedRevision, "vendor route");

      const {
        expectedRevision: _expectedRevision,
        active,
        ...routePatch
      } = request.body;
      assertRoutePatchMatchesType(existing.type, routePatch);
      const nextRequirements = {
        ...existing.requirements,
        ...routePatch,
        type: existing.type,
      } as CreateVendorRouteRequest;
      await validateRouteKey(app, existing.vendorId, nextRequirements);

      await app.db
        .update(schema.vendorRoutes)
        .set({
          name: nextRequirements.name,
          requirements: nextRequirements as unknown as Record<string, unknown>,
          ...(active === undefined ? {} : { active }),
          sourceUrl: nextRequirements.sourceUrl ?? null,
          sourceReviewedAt: nextRequirements.sourceReviewedAt ?? null,
          ...(existing.builtIn ? { builtInModifiedAt: sql`now()` } : {}),
          revision: existing.revision + 1,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.vendorRoutes.id, existing.id));
      await app.audit.write(
        app.db,
        {
          actorId: user.id,
          sessionId: principalOf(request).session.id,
          requestId: request.requestId,
        },
        {
          action:
            active === false ? "vendor.route_disabled" : "vendor.route_updated",
          entityType: "vendor_route",
          entityId: existing.id,
          before: { revision: existing.revision, active: existing.active },
          after: {
            revision: existing.revision + 1,
            active: active ?? existing.active,
          },
        },
      );

      return loadVendorRoute(app.db, existing.id);
    },
  );

  app.post(
    "/v1/vendors/:vendorId/public-keys",
    {
      schema: {
        params: VendorIdParam,
        body: CreateVendorPublicKeyRequest,
        response: { 200: VendorPublicKey, 400: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const vendor = await requireVendor(app.db, request.params.vendorId);
      const parsed = await parseVendorPublicKey(
        request.body.armoredKey,
        request.body.expectedFingerprint,
      );

      const keyId = await app.db.transaction(async (tx) => {
        if (request.body.supersedesKeyId !== undefined) {
          const [oldKey] = await tx
            .select()
            .from(schema.vendorPublicKeys)
            .where(
              and(
                eq(schema.vendorPublicKeys.id, request.body.supersedesKeyId),
                eq(schema.vendorPublicKeys.vendorId, vendor.id),
              ),
            )
            .limit(1);

          if (oldKey === undefined) {
            throw validationError("The key being replaced does not exist.");
          }

          if (oldKey.supersededById !== null) {
            throw validationError("That key version was already replaced.");
          }
        }

        const [created] = await tx
          .insert(schema.vendorPublicKeys)
          .values({
            vendorId: vendor.id,
            armoredKey: parsed.armoredKey,
            fingerprint: parsed.fingerprint,
            userIds: parsed.userIds,
            algorithm: parsed.algorithm,
            keyCreatedAt: parsed.keyCreatedAt,
            expiresAt: parsed.expiresAt,
            revokedAt: parsed.revokedAt,
            sourceUrl: request.body.sourceUrl,
            createdBy: user.id,
          })
          .returning({ id: schema.vendorPublicKeys.id });

        if (created === undefined) {
          throw new DomainError(
            "SERVER_ERROR",
            "Could not store the public key.",
          );
        }

        if (request.body.supersedesKeyId !== undefined) {
          await tx
            .update(schema.vendorPublicKeys)
            .set({
              supersededById: created.id,
              revision: sql`${schema.vendorPublicKeys.revision} + 1`,
            })
            .where(
              eq(schema.vendorPublicKeys.id, request.body.supersedesKeyId),
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
            action: "vendor.public_key_added",
            entityType: "vendor_public_key",
            entityId: created.id,
            after: {
              vendorId: vendor.id,
              fingerprint: parsed.fingerprint,
              supersedesKeyId: request.body.supersedesKeyId ?? null,
            },
          },
        );

        return created.id;
      });

      return loadVendorPublicKey(app.db, keyId);
    },
  );

  app.post(
    "/v1/vendors/:vendorId/public-keys/:keyId/verify",
    {
      schema: {
        params: VendorKeyParam,
        body: VerifyVendorPublicKeyRequest,
        response: { 200: VendorPublicKey, 409: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const [key] = await app.db
        .select()
        .from(schema.vendorPublicKeys)
        .where(
          and(
            eq(schema.vendorPublicKeys.id, request.params.keyId),
            eq(schema.vendorPublicKeys.vendorId, request.params.vendorId),
          ),
        )
        .limit(1);

      if (key === undefined) {
        throw notFound("Vendor public key");
      }

      assertRevision(key, request.body.expectedRevision, "vendor public key");
      const expected = request.body.expectedFingerprint
        .replace(/[\s:]/g, "")
        .toUpperCase();

      if (expected !== key.fingerprint) {
        throw validationError(
          "The independently checked fingerprint does not match this key.",
        );
      }

      await app.db.transaction(async (tx) => {
        await tx
          .update(schema.vendorPublicKeys)
          .set({
            verifiedBy: user.id,
            verifiedAt: sql`now()`,
            sourceUrl: request.body.sourceUrl,
            revision: key.revision + 1,
          })
          .where(eq(schema.vendorPublicKeys.id, key.id));
        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "vendor.public_key_verified",
            entityType: "vendor_public_key",
            entityId: key.id,
            after: {
              fingerprint: key.fingerprint,
              sourceUrl: request.body.sourceUrl,
            },
          },
        );
      });

      return loadVendorPublicKey(app.db, key.id);
    },
  );
}

async function rawVendorRoute(app: AppInstance, routeId: string) {
  const [route] = await app.db
    .select()
    .from(schema.vendorRoutes)
    .where(eq(schema.vendorRoutes.id, routeId))
    .limit(1);

  if (route === undefined) {
    throw notFound("Vendor route");
  }

  return route;
}

async function validateRouteKey(
  app: AppInstance,
  vendorId: string,
  route: CreateVendorRouteRequest,
): Promise<void> {
  if (route.type !== "EMAIL") {
    return;
  }

  if (route.encryptionPolicy === "REQUIRED" && route.publicKeyId === null) {
    throw validationError("Required encryption needs a verified public key.");
  }

  if (route.publicKeyId !== null) {
    await assertUsableVendorKey(app.db, vendorId, route.publicKeyId);
  }
}

function assertRoutePatchMatchesType(
  type: "EMAIL" | "MANUAL",
  patch: Omit<UpdateVendorRouteRequest, "expectedRevision" | "active">,
): void {
  const emailOnly = [
    "to",
    "cc",
    "subjectTemplate",
    "encryptionPolicy",
    "publicKeyId",
    "maximumAttachmentBytes",
    "requiredFields",
  ] as const;
  const manualOnly = [
    "destinationUrl",
    "fieldMappings",
    "acceptedExtensions",
    "maximumFileBytes",
    "maximumFileCount",
    "instructions",
  ] as const;
  const forbidden = type === "EMAIL" ? manualOnly : emailOnly;

  if (forbidden.some((field) => patch[field] !== undefined)) {
    throw validationError(
      `A ${type} route cannot accept fields for another route type.`,
    );
  }
}
