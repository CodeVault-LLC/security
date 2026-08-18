import { expect, test } from "playwright/test";
import { generateKey, readKey } from "openpgp";

import type {
  AssetDetail,
  CaseDetail,
  SubmissionDetail,
  VendorDetail,
  VendorPublicKey,
  VendorRoute,
} from "@codevault/contracts";
import { uuidv7 } from "@codevault/core/crypto";
import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "../../apps/server/src/testing/harness.js";

test.describe("vendor submission acceptance", () => {
  test.skip(
    !process.env.DATABASE_URL,
    "DATABASE_URL is required for E2E acceptance.",
  );

  let harness: TestHarness;
  let author: TestUser;

  test.beforeAll(async () => {
    harness = await createHarness();
    author = await harness.createUser({ role: "MEMBER" });
  });

  test.afterAll(async () => {
    await harness.close();
  });

  test("captures a required-PGP email route without contacting a vendor", async () => {
    const vendor = await createVendor("TP-Link-style test PSIRT");
    const generated = await generateKey({
      type: "ecc",
      curve: "curve25519Legacy",
      userIDs: [{ name: "Test PSIRT", email: "psirt@example.test" }],
      format: "armored",
    });
    const fingerprint = (await readKey({ armoredKey: generated.publicKey }))
      .getFingerprint()
      .toUpperCase();
    const keyResponse = await harness.app.inject({
      method: "POST",
      url: `/v1/vendors/${vendor.id}/public-keys`,
      headers: author.headers,
      payload: {
        armoredKey: generated.publicKey,
        sourceUrl: "https://security.example.test/pgp.asc",
        expectedFingerprint: fingerprint,
      },
    });
    expect(keyResponse.statusCode, keyResponse.body).toBe(200);
    const key = keyResponse.json<VendorPublicKey>();
    const verifyResponse = await harness.app.inject({
      method: "POST",
      url: `/v1/vendors/${vendor.id}/public-keys/${key.id}/verify`,
      headers: author.headers,
      payload: {
        expectedFingerprint: fingerprint,
        sourceUrl: "https://security.example.test/pgp.asc",
        expectedRevision: key.revision,
      },
    });
    expect(verifyResponse.statusCode, verifyResponse.body).toBe(200);

    const routeResponse = await harness.app.inject({
      method: "POST",
      url: `/v1/vendors/${vendor.id}/routes`,
      headers: author.headers,
      payload: {
        name: "Required encrypted PSIRT email",
        type: "EMAIL",
        to: ["psirt@example.test"],
        cc: [],
        subjectTemplate: "[UNENCRYPTED SUBJECT] Security report {caseRef}",
        encryptionPolicy: "REQUIRED",
        publicKeyId: key.id,
        maximumAttachmentBytes: 20 * 1024 * 1024,
        acknowledgementBusinessDays: 5,
        updateCadenceDays: 30,
        requiredFields: ["affected_product", "reproduction", "impact"],
      },
    });
    expect(routeResponse.statusCode, routeResponse.body).toBe(200);
    const route = routeResponse.json<VendorRoute>();
    const researchCase = await createCaseAndAsset(vendor, "CRITICAL_ZERO_DAY");

    const submissionResponse = await harness.app.inject({
      method: "POST",
      url: `/v1/cases/${researchCase.id}/submissions`,
      headers: author.headers,
      payload: {
        vendorId: vendor.id,
        routeId: route.id,
        cryptoMode: "ENCRYPTED",
      },
    });
    expect(submissionResponse.statusCode, submissionResponse.body).toBe(200);
    const submission = submissionResponse.json<SubmissionDetail>();
    expect(submission.routeSnapshot.route).toMatchObject({
      type: "EMAIL",
      to: ["psirt@example.test"],
      encryptionPolicy: "REQUIRED",
      publicKeyId: key.id,
    });
    expect(submission.cryptoMode).toBe("ENCRYPTED");
    expect(fakeDestinationOnly(route)).toBe(true);
  });

  test("captures explicit WordPress-style manual fields for the real maintainer", async () => {
    const vendor = await createVendor("Hummingbird maintainer test fixture");
    const routeResponse = await harness.app.inject({
      method: "POST",
      url: `/v1/vendors/${vendor.id}/routes`,
      headers: author.headers,
      payload: {
        name: "Plugin vulnerability form",
        type: "MANUAL",
        destinationUrl: "https://wordpress.example.test/report",
        fieldMappings: [
          {
            key: "plugin_slug",
            label: "Plugin slug",
            required: true,
            format: "TEXT",
            submissionField: "affected_product",
            helpText: null,
          },
          {
            key: "reproduction",
            label: "Reproduction",
            required: true,
            format: "MULTILINE_TEXT",
            submissionField: "reproduction",
            helpText: "Paste reviewed steps only.",
          },
        ],
        acceptedExtensions: [".pdf", ".txt"],
        maximumFileBytes: 10 * 1024 * 1024,
        maximumFileCount: 3,
        acknowledgementBusinessDays: 7,
        updateCadenceDays: 45,
        instructions: "Submit manually; CodeVault never automates this portal.",
        sourceUrl: "https://wordpress.example.test/security",
        sourceReviewedAt: "2026-08-18T00:00:00.000Z",
      },
    });
    expect(routeResponse.statusCode, routeResponse.body).toBe(200);
    const route = routeResponse.json<VendorRoute>();
    const researchCase = await createCaseAndAsset(
      vendor,
      "COORDINATED_DISCLOSURE",
    );
    const createdResponse = await harness.app.inject({
      method: "POST",
      url: `/v1/cases/${researchCase.id}/submissions`,
      headers: author.headers,
      payload: { vendorId: vendor.id, routeId: route.id, cryptoMode: "PLAIN" },
    });
    expect(createdResponse.statusCode, createdResponse.body).toBe(200);
    let submission = createdResponse.json<SubmissionDetail>();
    const updateResponse = await harness.app.inject({
      method: "PATCH",
      url: `/v1/submissions/${submission.id}`,
      headers: author.headers,
      payload: {
        subject: "Hummingbird vulnerability report",
        bodyMarkdown: "Reviewed disclosure details.",
        manualFields: {
          plugin_slug: "hummingbird-performance",
          reproduction: "1. Install fixture.\n2. Send the controlled request.",
        },
        expectedRevision: submission.revision,
      },
    });
    expect(updateResponse.statusCode, updateResponse.body).toBe(200);
    submission = updateResponse.json<SubmissionDetail>();
    expect(submission.manualFields).toEqual({
      plugin_slug: "hummingbird-performance",
      reproduction: "1. Install fixture.\n2. Send the controlled request.",
    });
    expect(submission.vendor.id).toBe(vendor.id);
  });

  async function createVendor(label: string): Promise<VendorDetail> {
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/vendors",
      headers: author.headers,
      payload: {
        name: `${label} ${uuidv7()}`,
        websiteUrl: "https://security.example.test",
        sourceUrl: "https://security.example.test/reporting",
        sourceReviewedAt: "2026-08-18T00:00:00.000Z",
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<VendorDetail>();
  }

  async function createCaseAndAsset(
    vendor: VendorDetail,
    profile: "CRITICAL_ZERO_DAY" | "COORDINATED_DISCLOSURE",
  ): Promise<CaseDetail> {
    const caseResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: author.headers,
      payload: {
        title: `E2E vendor workflow ${uuidv7()}`,
        profile,
        restricted: profile === "CRITICAL_ZERO_DAY",
      },
    });
    expect(caseResponse.statusCode, caseResponse.body).toBe(200);
    const researchCase = caseResponse.json<CaseDetail>();
    const assetResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/assets",
      headers: author.headers,
      payload: {
        name: "E2E vulnerable target",
        kind: "SOFTWARE_COMPONENT",
        version: "1.0.0",
        vendorId: vendor.id,
        caseId: researchCase.id,
      },
    });
    expect(assetResponse.statusCode, assetResponse.body).toBe(200);
    expect(assetResponse.json<AssetDetail>().vendorId).toBe(vendor.id);
    return researchCase;
  }
});

function fakeDestinationOnly(route: VendorRoute): boolean {
  return (
    route.type === "EMAIL" &&
    route.to.every((address) => address.endsWith(".test"))
  );
}
