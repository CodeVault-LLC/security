import type { AppInstance } from "../../http/app-instance.js";
import { and, desc, eq, lt, or, sql, type SQL } from "drizzle-orm";

import {
  AddAssetIdentifierRequest,
  AddAssetRelationshipRequest,
  AddAssetVersionRequest,
  AssetDetail,
  AssetSummary,
  CreateAssetRequest,
  ErrorResponse,
  IdParam,
  ListAssetsQuery,
  PaginatedResponse,
  UpdateAssetRequest,
} from "@codevault/contracts";
import {
  DomainError,
  normalizeIdentity,
  notFound,
  validationError,
} from "@codevault/core";
import { allocateReference, schema } from "@codevault/db";

import { assertRevision } from "../../http/concurrency.js";
import { actingUser, principalOf, requireAuthor } from "../../http/guards.js";
import { decodeCursor, pageSize, paginate } from "../../http/pagination.js";
import { requireCaseWrite } from "../../services/case-access.js";

/**
 * Asset routes.
 *
 * The create form is six fields. Identifiers, versions and relationships are
 * added afterwards, which is how a device, its firmware and the components
 * inside that firmware get modelled without a bespoke asset type for each.
 */

const AssetListResponse = PaginatedResponse(AssetSummary);

export async function registerAssetRoutes(app: AppInstance): Promise<void> {
  app.get(
    "/v1/assets",
    {
      schema: {
        querystring: ListAssetsQuery,
        response: { 200: AssetListResponse },
      },
    },
    async (request) => {
      actingUser(request);

      const size = pageSize(request.query.limit);
      const cursor = decodeCursor(request.query.cursor);
      const filters: SQL[] = [];

      if (request.query.kind !== undefined) {
        filters.push(eq(schema.assets.kind, request.query.kind));
      }

      if (request.query.caseId !== undefined) {
        filters.push(
          sql`EXISTS (
            SELECT 1 FROM case_assets
            WHERE case_assets.asset_id = ${schema.assets.id}
              AND case_assets.case_id = ${request.query.caseId}
          )`,
        );
      }

      if (request.query.query !== undefined) {
        const pattern = `%${request.query.query}%`;

        filters.push(
          sql`(
            ${schema.assets.name} ILIKE ${pattern}
            OR ${schema.assets.vendor} ILIKE ${pattern}
            OR ${schema.assets.ref} ILIKE ${pattern}
          )`,
        );
      }

      if (cursor !== null) {
        filters.push(
          or(
            lt(schema.assets.updatedAt, cursor.timestamp),
            and(
              eq(schema.assets.updatedAt, cursor.timestamp),
              lt(schema.assets.id, cursor.id),
            ),
          ) as SQL,
        );
      }

      const rows = await app.db
        .select({
          id: schema.assets.id,
          ref: schema.assets.ref,
          name: schema.assets.name,
          kind: schema.assets.kind,
          vendor: schema.assets.vendor,
          version: schema.assets.version,
          revision: schema.assets.revision,
          createdAt: schema.assets.createdAt,
          updatedAt: schema.assets.updatedAt,
          primaryIdentifier: sql<string | null>`(
            SELECT value FROM asset_identifiers
            WHERE asset_identifiers.asset_id = ${schema.assets.id}
            ORDER BY asset_identifiers."primary" DESC, asset_identifiers.created_at ASC
            LIMIT 1
          )`,
          findingCount: sql<number>`(
            SELECT count(*)::int FROM finding_assets
            WHERE finding_assets.asset_id = ${schema.assets.id}
          )`,
        })
        .from(schema.assets)
        .where(filters.length === 0 ? undefined : and(...filters))
        .orderBy(desc(schema.assets.updatedAt), desc(schema.assets.id))
        .limit(size + 1);

      const page = paginate(rows, size, (row) => row.updatedAt);

      return { items: page.items, nextCursor: page.nextCursor };
    },
  );

  app.post(
    "/v1/assets",
    {
      schema: {
        body: CreateAssetRequest,
        response: { 200: AssetDetail, 403: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const body = request.body;

      if (body.caseId !== undefined) {
        await requireCaseWrite(app.db, user, body.caseId);
      }

      const identity = normalizeIdentity({
        name: body.name,
        vendor: body.vendor ?? null,
        identifiers: body.identifier === undefined ? [] : [body.identifier],
      });

      const assetId = await app.db.transaction(async (tx) => {
        const ref = await allocateReference(tx, "asset");
        const [row] = await tx
          .insert(schema.assets)
          .values({
            ref,
            name: body.name,
            kind: body.kind,
            vendor: body.vendor ?? null,
            version: body.version ?? null,
            notes: body.notes ?? null,
            normalizedVendor: identity.vendor,
            normalizedProduct: identity.product,
            metadata: body.metadata ?? {},
            createdBy: user.id,
          })
          .returning({ id: schema.assets.id });

        if (row === undefined) {
          throw new DomainError("SERVER_ERROR", "Could not create the asset.");
        }

        if (body.identifier !== undefined) {
          await tx.insert(schema.assetIdentifiers).values({
            assetId: row.id,
            scheme: body.identifier.scheme,
            value: body.identifier.value,
            primary: true,
          });
        }

        if (body.version !== undefined) {
          await tx
            .insert(schema.assetVersions)
            .values({ assetId: row.id, version: body.version })
            .onConflictDoNothing();
        }

        if (body.caseId !== undefined) {
          await tx
            .insert(schema.caseAssets)
            .values({ caseId: body.caseId, assetId: row.id })
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
            action: "asset.created",
            entityType: "asset",
            entityId: row.id,
            caseId: body.caseId ?? null,
            after: { ref, name: body.name, kind: body.kind },
          },
        );

        return row.id;
      });

      return loadAssetDetail(app, assetId);
    },
  );

  app.get(
    "/v1/assets/:id",
    {
      schema: {
        params: IdParam,
        response: { 200: AssetDetail, 404: ErrorResponse },
      },
    },
    async (request) => {
      actingUser(request);

      return loadAssetDetail(app, request.params.id);
    },
  );

  app.patch(
    "/v1/assets/:id",
    {
      schema: {
        params: IdParam,
        body: UpdateAssetRequest,
        response: { 200: AssetDetail, 409: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const body = request.body;

      const rows = await app.db
        .select()
        .from(schema.assets)
        .where(eq(schema.assets.id, request.params.id))
        .limit(1);

      const existing = rows[0];

      if (existing === undefined) {
        throw notFound("Asset");
      }

      assertRevision(existing, body.expectedRevision, "asset");

      const identifiers = await app.db
        .select({
          scheme: schema.assetIdentifiers.scheme,
          value: schema.assetIdentifiers.value,
        })
        .from(schema.assetIdentifiers)
        .where(eq(schema.assetIdentifiers.assetId, existing.id));

      const identity = normalizeIdentity({
        name: body.name ?? existing.name,
        vendor: body.vendor === undefined ? existing.vendor : body.vendor,
        identifiers,
      });

      await app.db.transaction(async (tx) => {
        await tx
          .update(schema.assets)
          .set({
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(body.kind === undefined ? {} : { kind: body.kind }),
            ...(body.vendor === undefined ? {} : { vendor: body.vendor }),
            ...(body.version === undefined ? {} : { version: body.version }),
            ...(body.notes === undefined ? {} : { notes: body.notes }),
            ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
            normalizedVendor: identity.vendor,
            normalizedProduct: identity.product,
            revision: existing.revision + 1,
            updatedAt: sql`now()`,
          })
          .where(eq(schema.assets.id, existing.id));

        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "asset.updated",
            entityType: "asset",
            entityId: existing.id,
            before: { name: existing.name, kind: existing.kind },
            after: {
              name: body.name ?? existing.name,
              kind: body.kind ?? existing.kind,
            },
          },
        );
      });

      return loadAssetDetail(app, existing.id);
    },
  );

  app.post(
    "/v1/assets/:id/identifiers",
    {
      schema: {
        params: IdParam,
        body: AddAssetIdentifierRequest,
        response: { 200: AssetDetail },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const assetId = await requireAsset(app, request.params.id);
      const body = request.body;

      await app.db.transaction(async (tx) => {
        if (body.primary === true) {
          // The partial unique index allows only one primary identifier, so the
          // previous one is demoted first rather than colliding.
          await tx
            .update(schema.assetIdentifiers)
            .set({ primary: false })
            .where(eq(schema.assetIdentifiers.assetId, assetId));
        }

        await tx
          .insert(schema.assetIdentifiers)
          .values({
            assetId,
            scheme: body.scheme,
            value: body.value,
            primary: body.primary ?? false,
          })
          .onConflictDoNothing();

        await refreshNormalizedIdentity(tx, assetId);
      });

      await app.audit.write(
        app.db,
        {
          actorId: user.id,
          sessionId: principalOf(request).session.id,
          requestId: request.requestId,
        },
        {
          action: "asset.identifier_added",
          entityType: "asset",
          entityId: assetId,
          after: { scheme: body.scheme, value: body.value },
        },
      );

      return loadAssetDetail(app, assetId);
    },
  );

  app.post(
    "/v1/assets/:id/versions",
    {
      schema: {
        params: IdParam,
        body: AddAssetVersionRequest,
        response: { 200: AssetDetail },
      },
    },
    async (request) => {
      requireAuthor(request);

      const assetId = await requireAsset(app, request.params.id);
      const body = request.body;

      await app.db
        .insert(schema.assetVersions)
        .values({
          assetId,
          version: body.version,
          releasedAt: body.releasedAt ?? null,
          metadata: body.metadata ?? {},
        })
        .onConflictDoNothing();

      return loadAssetDetail(app, assetId);
    },
  );

  app.post(
    "/v1/assets/:id/relationships",
    {
      schema: {
        params: IdParam,
        body: AddAssetRelationshipRequest,
        response: { 200: AssetDetail, 400: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const assetId = await requireAsset(app, request.params.id);
      const body = request.body;

      if (body.toAssetId === assetId) {
        throw validationError("An asset cannot relate to itself.");
      }

      await requireAsset(app, body.toAssetId);

      const inserted = await app.db
        .insert(schema.assetRelationships)
        .values({
          fromAssetId: assetId,
          toAssetId: body.toAssetId,
          relationship: body.relationship,
          note: body.note ?? null,
          createdBy: user.id,
        })
        .onConflictDoNothing()
        .returning({ id: schema.assetRelationships.id });

      if (inserted.length === 0) {
        throw validationError("That relationship already exists.");
      }

      return loadAssetDetail(app, assetId);
    },
  );
}

async function requireAsset(
  app: AppInstance,
  assetId: string,
): Promise<string> {
  const rows = await app.db
    .select({ id: schema.assets.id })
    .from(schema.assets)
    .where(eq(schema.assets.id, assetId))
    .limit(1);

  const row = rows[0];

  if (row === undefined) {
    throw notFound("Asset");
  }

  return row.id;
}

/** Keeps the normalized identity in step with the identifier list. */
async function refreshNormalizedIdentity(
  tx: Parameters<Parameters<AppInstance["db"]["transaction"]>[0]>[0],
  assetId: string,
): Promise<void> {
  const rows = await tx
    .select({
      name: schema.assets.name,
      vendor: schema.assets.vendor,
    })
    .from(schema.assets)
    .where(eq(schema.assets.id, assetId))
    .limit(1);

  const asset = rows[0];

  if (asset === undefined) {
    return;
  }

  const identifiers = await tx
    .select({
      scheme: schema.assetIdentifiers.scheme,
      value: schema.assetIdentifiers.value,
    })
    .from(schema.assetIdentifiers)
    .where(eq(schema.assetIdentifiers.assetId, assetId));

  const identity = normalizeIdentity({
    name: asset.name,
    vendor: asset.vendor,
    identifiers,
  });

  await tx
    .update(schema.assets)
    .set({
      normalizedVendor: identity.vendor,
      normalizedProduct: identity.product,
    })
    .where(eq(schema.assets.id, assetId));
}

async function loadAssetDetail(
  app: AppInstance,
  assetId: string,
): Promise<AssetDetail> {
  const rows = await app.db
    .select({
      id: schema.assets.id,
      ref: schema.assets.ref,
      name: schema.assets.name,
      kind: schema.assets.kind,
      vendor: schema.assets.vendor,
      version: schema.assets.version,
      notes: schema.assets.notes,
      metadata: schema.assets.metadata,
      revision: schema.assets.revision,
      createdAt: schema.assets.createdAt,
      updatedAt: schema.assets.updatedAt,
      findingCount: sql<number>`(
        SELECT count(*)::int FROM finding_assets
        WHERE finding_assets.asset_id = ${schema.assets.id}
      )`,
    })
    .from(schema.assets)
    .where(eq(schema.assets.id, assetId))
    .limit(1);

  const asset = rows[0];

  if (asset === undefined) {
    throw notFound("Asset");
  }

  const identifiers = await app.db
    .select()
    .from(schema.assetIdentifiers)
    .where(eq(schema.assetIdentifiers.assetId, assetId))
    .orderBy(desc(schema.assetIdentifiers.primary));

  const versions = await app.db
    .select()
    .from(schema.assetVersions)
    .where(eq(schema.assetVersions.assetId, assetId))
    .orderBy(desc(schema.assetVersions.createdAt));

  const relationships = await app.db
    .select({
      id: schema.assetRelationships.id,
      relationship: schema.assetRelationships.relationship,
      fromAssetId: schema.assetRelationships.fromAssetId,
      toAssetId: schema.assetRelationships.toAssetId,
      note: schema.assetRelationships.note,
      createdAt: schema.assetRelationships.createdAt,
      toAssetName: schema.assets.name,
      toAssetKind: schema.assets.kind,
    })
    .from(schema.assetRelationships)
    .innerJoin(
      schema.assets,
      eq(schema.assets.id, schema.assetRelationships.toAssetId),
    )
    .where(eq(schema.assetRelationships.fromAssetId, assetId));

  const primaryIdentifier =
    identifiers.find((identifier) => identifier.primary)?.value ??
    identifiers[0]?.value ??
    null;

  return {
    id: asset.id,
    ref: asset.ref,
    name: asset.name,
    kind: asset.kind,
    vendor: asset.vendor,
    version: asset.version,
    notes: asset.notes,
    metadata: asset.metadata,
    primaryIdentifier,
    findingCount: asset.findingCount,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    revision: asset.revision,
    identifiers: identifiers.map((identifier) => ({
      id: identifier.id,
      scheme: identifier.scheme,
      value: identifier.value,
      primary: identifier.primary,
      createdAt: identifier.createdAt,
    })),
    versions: versions.map((version) => ({
      id: version.id,
      version: version.version,
      releasedAt: version.releasedAt,
      metadata: version.metadata,
      createdAt: version.createdAt,
    })),
    relationships,
  };
}
