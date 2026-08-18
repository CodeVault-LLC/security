import { createHash } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";
import { readKey } from "openpgp";

import type {
  CreateVendorRouteRequest,
  VendorDetail,
  VendorPublicKey,
  VendorRoute,
  VendorSummary,
} from "@codevault/contracts";
import { notFound, validationError } from "@codevault/core";
import type { Database } from "@codevault/db";
import { schema } from "@codevault/db";

import type { AppInstance } from "../../http/app-instance.js";

function isUnsafeDisplayCharacter(character: string): boolean {
  const point = character.codePointAt(0);

  return (
    point !== undefined &&
    (point <= 0x1f ||
      (point >= 0x7f && point <= 0x9f) ||
      (point >= 0x200b && point <= 0x200f) ||
      (point >= 0x202a && point <= 0x202e) ||
      (point >= 0x2060 && point <= 0x2069) ||
      point === 0xfeff)
  );
}

export function normalizeVendorName(value: string): {
  displayName: string;
  normalizedName: string;
} {
  const displayName = value.normalize("NFKC").trim().replace(/\s+/gu, " ");

  if (displayName.length === 0) {
    throw validationError("Vendor name is required.");
  }

  if ([...displayName].some(isUnsafeDisplayCharacter)) {
    throw validationError(
      "Vendor names cannot contain control or bidirectional formatting characters.",
    );
  }

  return {
    displayName,
    normalizedName: displayName.toLocaleLowerCase("en-US"),
  };
}

export function vendorSlug(displayName: string): string {
  const readable = displayName
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const digest = createHash("sha256")
    .update(displayName.toLocaleLowerCase("en-US"), "utf8")
    .digest("hex")
    .slice(0, 10);

  return `${readable.length === 0 ? "vendor" : readable}-${digest}`;
}

export async function requireVendor(
  db: Database,
  vendorId: string,
): Promise<typeof schema.vendors.$inferSelect> {
  const [vendor] = await db
    .select()
    .from(schema.vendors)
    .where(eq(schema.vendors.id, vendorId))
    .limit(1);

  if (vendor === undefined) {
    throw notFound("Vendor");
  }

  return vendor;
}

export function toVendorSummary(
  vendor: typeof schema.vendors.$inferSelect,
): VendorSummary {
  return {
    id: vendor.id,
    ref: vendor.ref,
    slug: vendor.slug,
    name: vendor.name,
    websiteUrl: vendor.websiteUrl,
    builtIn: vendor.builtIn,
    sourceUrl: vendor.sourceUrl,
    sourceReviewedAt: vendor.sourceReviewedAt,
    archivedAt: vendor.archivedAt,
    createdAt: vendor.createdAt,
    updatedAt: vendor.updatedAt,
    revision: vendor.revision,
  };
}

export async function loadVendorSummary(
  db: Database,
  vendorId: string,
): Promise<VendorSummary> {
  return toVendorSummary(await requireVendor(db, vendorId));
}

function asRoute(row: typeof schema.vendorRoutes.$inferSelect): VendorRoute {
  return {
    ...(row.requirements as CreateVendorRouteRequest),
    id: row.id,
    vendorId: row.vendorId,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revision: row.revision,
  } as VendorRoute;
}

export async function loadVendorRoute(
  db: Database,
  routeId: string,
): Promise<VendorRoute> {
  const [route] = await db
    .select()
    .from(schema.vendorRoutes)
    .where(eq(schema.vendorRoutes.id, routeId))
    .limit(1);

  if (route === undefined) {
    throw notFound("Vendor route");
  }

  return asRoute(route);
}

export async function loadVendorPublicKey(
  db: Database,
  keyId: string,
): Promise<VendorPublicKey> {
  const [row] = await db
    .select({
      key: schema.vendorPublicKeys,
      verifierId: schema.users.id,
      verifierDisplayName: schema.users.displayName,
      verifierEmail: schema.users.email,
    })
    .from(schema.vendorPublicKeys)
    .leftJoin(
      schema.users,
      eq(schema.users.id, schema.vendorPublicKeys.verifiedBy),
    )
    .where(eq(schema.vendorPublicKeys.id, keyId))
    .limit(1);

  if (row === undefined) {
    throw notFound("Vendor public key");
  }

  return {
    id: row.key.id,
    vendorId: row.key.vendorId,
    armoredKey: row.key.armoredKey,
    fingerprint: row.key.fingerprint,
    userIds: row.key.userIds,
    algorithm: row.key.algorithm,
    createdAt: row.key.keyCreatedAt,
    expiresAt: row.key.expiresAt,
    revokedAt: row.key.revokedAt,
    verifiedBy:
      row.verifierId === null ||
      row.verifierDisplayName === null ||
      row.verifierEmail === null
        ? null
        : {
            id: row.verifierId,
            displayName: row.verifierDisplayName,
            email: row.verifierEmail,
          },
    verifiedAt: row.key.verifiedAt,
    sourceUrl: row.key.sourceUrl,
    supersededById: row.key.supersededById,
    revision: row.key.revision,
  };
}

export async function loadVendorDetail(
  app: Pick<AppInstance, "db">,
  vendorId: string,
): Promise<VendorDetail> {
  const vendor = await requireVendor(app.db, vendorId);
  const routes = await app.db
    .select()
    .from(schema.vendorRoutes)
    .where(eq(schema.vendorRoutes.vendorId, vendorId))
    .orderBy(desc(schema.vendorRoutes.active), schema.vendorRoutes.name);
  const keys = await app.db
    .select({ id: schema.vendorPublicKeys.id })
    .from(schema.vendorPublicKeys)
    .where(eq(schema.vendorPublicKeys.vendorId, vendorId))
    .orderBy(desc(schema.vendorPublicKeys.createdAt));
  const [assetCount] = await app.db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.assets)
    .where(eq(schema.assets.vendorId, vendorId));

  return {
    ...toVendorSummary(vendor),
    routes: routes.map(asRoute),
    publicKeys: await Promise.all(
      keys.map((key) => loadVendorPublicKey(app.db, key.id)),
    ),
    assetCount: assetCount?.count ?? 0,
  };
}

function normalizeFingerprint(value: string): string {
  return value.replace(/[\s:]/g, "").toUpperCase();
}

export interface ParsedVendorPublicKey {
  armoredKey: string;
  fingerprint: string;
  userIds: string[];
  algorithm: string;
  keyCreatedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export async function parseVendorPublicKey(
  armoredKey: string,
  expectedFingerprint: string,
): Promise<ParsedVendorPublicKey> {
  let key;

  try {
    key = await readKey({ armoredKey });
    await key.verifyPrimaryKey();
  } catch (error: unknown) {
    throw validationError("The OpenPGP public key is malformed or invalid.", {
      reason: error instanceof Error ? error.name : "invalid_key",
    });
  }

  if (key.isPrivate()) {
    throw validationError("Upload a public key, never a private key.");
  }

  const fingerprint = key.getFingerprint().toUpperCase();

  if (normalizeFingerprint(expectedFingerprint) !== fingerprint) {
    throw validationError(
      "The supplied fingerprint does not match the OpenPGP key.",
    );
  }

  const expiration = await key.getExpirationTime();
  const revoked = await key.isRevoked();
  const algorithm = key.getAlgorithmInfo();

  return {
    armoredKey: key.armor(),
    fingerprint,
    userIds: key.getUserIDs(),
    algorithm: [algorithm.algorithm, algorithm.curve, algorithm.bits]
      .filter((value) => value !== undefined)
      .join("/"),
    keyCreatedAt: key.getCreationTime().toISOString(),
    expiresAt:
      expiration === null || expiration === Infinity
        ? null
        : new Date(expiration).toISOString(),
    revokedAt: revoked ? new Date().toISOString() : null,
  };
}

export async function assertUsableVendorKey(
  db: Database,
  vendorId: string,
  keyId: string,
): Promise<void> {
  const [keyRow] = await db
    .select()
    .from(schema.vendorPublicKeys)
    .where(
      and(
        eq(schema.vendorPublicKeys.id, keyId),
        eq(schema.vendorPublicKeys.vendorId, vendorId),
      ),
    )
    .limit(1);

  if (keyRow === undefined) {
    throw validationError("The selected vendor public key does not exist.");
  }

  if (keyRow.verifiedAt === null || keyRow.verifiedBy === null) {
    throw validationError(
      "Verify the selected OpenPGP fingerprint before using this route.",
    );
  }

  if (keyRow.supersededById !== null || keyRow.revokedAt !== null) {
    throw validationError("The selected OpenPGP key is no longer usable.");
  }

  if (keyRow.expiresAt !== null && Date.parse(keyRow.expiresAt) <= Date.now()) {
    throw validationError("The selected OpenPGP key has expired.");
  }

  try {
    const parsed = await readKey({ armoredKey: keyRow.armoredKey });
    await parsed.getEncryptionKey();
  } catch {
    throw validationError(
      "The selected OpenPGP key has no currently usable encryption key.",
    );
  }
}

export async function vendorNameForAsset(
  db: Database,
  vendorId: string | null,
): Promise<string | null> {
  if (vendorId === null) {
    return null;
  }

  const vendor = await requireVendor(db, vendorId);

  if (vendor.archivedAt !== null) {
    throw validationError("Archived vendors cannot be linked to new assets.");
  }

  return vendor.name;
}
