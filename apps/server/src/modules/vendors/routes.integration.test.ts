import { generateKey, readKey } from "openpgp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  AssetDetail,
  VendorDetail,
  VendorPublicKey,
  VendorRoute,
  VendorSummary,
} from "@codevault/contracts";
import { uuidv7 } from "@codevault/core/crypto";
import { schema } from "@codevault/db";
import { eq } from "drizzle-orm";

import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "../../testing/harness.js";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration("vendor directory routes", () => {
  let harness: TestHarness;
  let author: TestUser;
  let viewer: TestUser;
  let armoredPublicKey: string;
  let fingerprint: string;
  let armoredReplacementKey: string;
  let replacementFingerprint: string;

  beforeAll(async () => {
    harness = await createHarness();
    author = await harness.createUser({ role: "MEMBER" });
    viewer = await harness.createUser({ role: "VIEWER" });

    const generated = await generateKey({
      type: "ecc",
      curve: "curve25519Legacy",
      userIDs: [{ name: "Example PSIRT", email: "security@example.com" }],
      format: "armored",
    });
    armoredPublicKey = generated.publicKey;
    fingerprint = (await readKey({ armoredKey: armoredPublicKey }))
      .getFingerprint()
      .toUpperCase();

    const replacement = await generateKey({
      type: "ecc",
      curve: "curve25519Legacy",
      userIDs: [
        { name: "Example PSIRT replacement", email: "security@example.com" },
      ],
      format: "armored",
    });
    armoredReplacementKey = replacement.publicKey;
    replacementFingerprint = (
      await readKey({ armoredKey: armoredReplacementKey })
    )
      .getFingerprint()
      .toUpperCase();
  }, 30_000);

  afterAll(async () => {
    await harness.close();
  });

  async function createVendor(name = `Example Vendor ${uuidv7()}`) {
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/vendors",
      headers: author.headers,
      payload: {
        name,
        websiteUrl: "https://example.com",
        sourceUrl: "https://example.com/security",
        sourceReviewedAt: "2026-08-18T10:00:00.000Z",
      },
    });

    expect(response.statusCode).toBe(200);

    return response.json<VendorDetail>();
  }

  it("normalizes names for uniqueness and rejects control characters", async () => {
    const suffix = uuidv7();
    const vendor = await createVendor(`Example PSIRT Vendor ${suffix}`);
    expect(vendor.name).toBe(`Example PSIRT Vendor ${suffix}`);

    const duplicate = await harness.app.inject({
      method: "POST",
      url: "/v1/vendors",
      headers: author.headers,
      payload: { name: `  example   psirt vendor   ${suffix}  ` },
    });
    expect(duplicate.statusCode).toBe(409);

    const deceptive = await harness.app.inject({
      method: "POST",
      url: "/v1/vendors",
      headers: author.headers,
      payload: { name: "Example\u202eVendor" },
    });
    expect(deceptive.statusCode).toBe(400);
  });

  it("allows members to read but not viewers to mutate the shared directory", async () => {
    const forbidden = await harness.app.inject({
      method: "POST",
      url: "/v1/vendors",
      headers: viewer.headers,
      payload: { name: "Viewer-created vendor" },
    });
    expect(forbidden.statusCode).toBe(403);

    const readable = await harness.app.inject({
      method: "GET",
      url: "/v1/vendors?limit=1",
      headers: viewer.headers,
    });
    expect(readable.statusCode).toBe(200);
    expect(readable.json<{ items: VendorSummary[] }>().items).toHaveLength(1);
    expect(
      readable.json<{ nextCursor: string | null }>().nextCursor,
    ).not.toBeNull();
  });

  it("parses, verifies, and audits append-only public-key versions", async () => {
    const vendor = await createVendor();
    const created = await harness.app.inject({
      method: "POST",
      url: `/v1/vendors/${vendor.id}/public-keys`,
      headers: author.headers,
      payload: {
        armoredKey: armoredPublicKey,
        sourceUrl: "https://example.com/security/key.asc",
        expectedFingerprint: fingerprint,
      },
    });

    expect(created.statusCode).toBe(200);
    const key = created.json<VendorPublicKey>();
    expect(key.fingerprint).toBe(fingerprint);
    expect(key.verifiedAt).toBeNull();
    expect(key.armoredKey).toBe(armoredPublicKey);

    const mismatched = await harness.app.inject({
      method: "POST",
      url: `/v1/vendors/${vendor.id}/public-keys`,
      headers: author.headers,
      payload: {
        armoredKey: armoredPublicKey,
        sourceUrl: "https://example.com/security/key.asc",
        expectedFingerprint: "A".repeat(40),
      },
    });
    expect(mismatched.statusCode).toBe(400);

    const verified = await harness.app.inject({
      method: "POST",
      url: `/v1/vendors/${vendor.id}/public-keys/${key.id}/verify`,
      headers: author.headers,
      payload: {
        expectedFingerprint: fingerprint,
        sourceUrl: "https://example.com/security/key.asc",
        expectedRevision: key.revision,
      },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json<VendorPublicKey>().verifiedBy?.id).toBe(author.id);

    const auditRows = await harness.dbHandle.db
      .select({ action: schema.auditEvents.action })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, key.id));
    expect(auditRows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "vendor.public_key_added",
        "vendor.public_key_verified",
      ]),
    );

    const replacement = await harness.app.inject({
      method: "POST",
      url: `/v1/vendors/${vendor.id}/public-keys`,
      headers: author.headers,
      payload: {
        armoredKey: armoredReplacementKey,
        sourceUrl: "https://example.com/security/replacement-key.asc",
        expectedFingerprint: replacementFingerprint,
        supersedesKeyId: key.id,
      },
    });
    expect(replacement.statusCode).toBe(200);
    const replacementKey = replacement.json<VendorPublicKey>();

    const detail = await harness.app.inject({
      method: "GET",
      url: `/v1/vendors/${vendor.id}`,
      headers: author.headers,
    });
    expect(
      detail.json<VendorDetail>().publicKeys.find((item) => item.id === key.id)
        ?.supersededById,
    ).toBe(replacementKey.id);
  });

  it("requires a verified usable key for required-encryption routes", async () => {
    const vendor = await createVendor();
    const missingKey = await harness.app.inject({
      method: "POST",
      url: `/v1/vendors/${vendor.id}/routes`,
      headers: author.headers,
      payload: {
        name: "Encrypted PSIRT email",
        type: "EMAIL",
        to: ["security@example.com"],
        cc: [],
        subjectTemplate: "Security report: {caseRef}",
        encryptionPolicy: "REQUIRED",
        publicKeyId: uuidv7(),
        maximumAttachmentBytes: 20 * 1024 * 1024,
        acknowledgementBusinessDays: 5,
        updateCadenceDays: 42,
        requiredFields: ["affected_product", "reproduction", "impact"],
      },
    });
    expect(missingKey.statusCode).toBe(400);

    const createdKey = await harness.app.inject({
      method: "POST",
      url: `/v1/vendors/${vendor.id}/public-keys`,
      headers: author.headers,
      payload: {
        armoredKey: armoredPublicKey,
        sourceUrl: "https://example.com/security/key.asc",
        expectedFingerprint: fingerprint,
      },
    });
    const key = createdKey.json<VendorPublicKey>();

    const unverified = await harness.app.inject({
      method: "POST",
      url: `/v1/vendors/${vendor.id}/routes`,
      headers: author.headers,
      payload: {
        name: "Encrypted PSIRT email",
        type: "EMAIL",
        to: ["security@example.com"],
        cc: [],
        subjectTemplate: "Security report: {caseRef}",
        encryptionPolicy: "REQUIRED",
        publicKeyId: key.id,
        maximumAttachmentBytes: 20 * 1024 * 1024,
        acknowledgementBusinessDays: 5,
        updateCadenceDays: 42,
        requiredFields: ["affected_product", "reproduction", "impact"],
      },
    });
    expect(unverified.statusCode).toBe(400);

    await harness.app.inject({
      method: "POST",
      url: `/v1/vendors/${vendor.id}/public-keys/${key.id}/verify`,
      headers: author.headers,
      payload: {
        expectedFingerprint: fingerprint,
        sourceUrl: "https://example.com/security/key.asc",
        expectedRevision: key.revision,
      },
    });

    const created = await harness.app.inject({
      method: "POST",
      url: `/v1/vendors/${vendor.id}/routes`,
      headers: author.headers,
      payload: {
        name: "Encrypted PSIRT email",
        type: "EMAIL",
        to: ["security@example.com"],
        cc: [],
        subjectTemplate: "Security report: {caseRef}",
        encryptionPolicy: "REQUIRED",
        publicKeyId: key.id,
        maximumAttachmentBytes: 20 * 1024 * 1024,
        acknowledgementBusinessDays: 5,
        updateCadenceDays: 42,
        requiredFields: ["affected_product", "reproduction", "impact"],
      },
    });
    expect(created.statusCode).toBe(200);
    const route = created.json<VendorRoute>();

    const disabled = await harness.app.inject({
      method: "PATCH",
      url: `/v1/vendor-routes/${route.id}`,
      headers: author.headers,
      payload: { active: false, expectedRevision: route.revision },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json<VendorRoute>().active).toBe(false);

    const detail = await harness.app.inject({
      method: "GET",
      url: `/v1/vendors/${vendor.id}`,
      headers: author.headers,
    });
    expect(
      detail.json<VendorDetail>().routes.find((item) => item.id === route.id)
        ?.active,
    ).toBe(false);
  });

  it("links assets by vendor ID and returns a vendor summary", async () => {
    const vendor = await createVendor();
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/assets",
      headers: author.headers,
      payload: {
        name: "Example appliance",
        kind: "DEVICE",
        vendorId: vendor.id,
      },
    });

    expect(response.statusCode).toBe(200);
    const asset = response.json<AssetDetail>();
    expect(asset.vendorId).toBe(vendor.id);
    expect(asset.vendor?.name).toBe(vendor.name);
    expect(asset.legacyVendorName).toBeNull();
  });

  it("filters the asset directory by linked vendor ID", async () => {
    const vendor = await createVendor();
    const otherVendor = await createVendor();

    const linked = await harness.app.inject({
      method: "POST",
      url: "/v1/assets",
      headers: author.headers,
      payload: {
        name: "Vendor-filtered appliance",
        kind: "DEVICE",
        vendorId: vendor.id,
      },
    });
    await harness.app.inject({
      method: "POST",
      url: "/v1/assets",
      headers: author.headers,
      payload: {
        name: "Other vendor appliance",
        kind: "DEVICE",
        vendorId: otherVendor.id,
      },
    });

    const response = await harness.app.inject({
      method: "GET",
      url: `/v1/assets?vendorId=${vendor.id}`,
      headers: author.headers,
    });

    expect(response.statusCode).toBe(200);
    expect(
      response.json<{ items: AssetDetail[] }>().items.map((item) => item.id),
    ).toEqual([linked.json<AssetDetail>().id]);
  });

  it("does not let a read-only member mutate an asset linked to a restricted case", async () => {
    const reader = await harness.createUser({ role: "MEMBER" });
    const caseResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: author.headers,
      payload: {
        title: "Confidential vendor coordination",
        profile: "CRITICAL_ZERO_DAY",
        restricted: true,
      },
    });
    const caseId = caseResponse.json<{ id: string }>().id;
    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/assets",
      headers: author.headers,
      payload: {
        name: "Unreleased security target",
        kind: "DEVICE",
        caseId,
      },
    });
    const asset = created.json<AssetDetail>();

    await harness.dbHandle.db.insert(schema.caseMembers).values({
      caseId,
      userId: reader.id,
      access: "READ",
      addedBy: author.id,
    });

    const response = await harness.app.inject({
      method: "PATCH",
      url: `/v1/assets/${asset.id}`,
      headers: reader.headers,
      payload: { name: "Tampered target", expectedRevision: asset.revision },
    });

    expect(response.statusCode).toBe(403);
  });

  it("seeds editable starter vendors without importing an unverified key", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/v1/vendors?query=TP-Link",
      headers: author.headers,
    });
    const [tpLink] = response.json<{ items: VendorSummary[] }>().items;

    expect(tpLink?.builtIn).toBe(true);
    expect(tpLink?.sourceUrl).toMatch(/^https:\/\//);

    const detail = await harness.app.inject({
      method: "GET",
      url: `/v1/vendors/${tpLink?.id}`,
      headers: author.headers,
    });
    expect(detail.json<VendorDetail>().publicKeys).toHaveLength(0);
  });
});
