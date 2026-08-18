import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  CaseDetail,
  SubmissionDetail,
  SubmissionSealIntent,
  SubmissionValidationResult,
  VendorDetail,
  VendorRoute,
} from "@codevault/contracts";
import { generateObjectKey, uuidv7 } from "@codevault/core/crypto";
import { allocateReference, schema } from "@codevault/db";

import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "../../testing/harness.js";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration("validated manual submissions", () => {
  let harness: TestHarness;
  let author: TestUser;
  let researchCase: CaseDetail;
  let vendor: VendorDetail;
  let route: VendorRoute;
  let reportExportId: string;

  beforeAll(async () => {
    harness = await createHarness();
    author = await harness.createUser({ role: "MEMBER" });

    const caseResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: author.headers,
      payload: {
        title: `Submission test ${uuidv7()}`,
        profile: "COORDINATED_DISCLOSURE",
      },
    });
    researchCase = caseResponse.json<CaseDetail>();

    const vendorResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/vendors",
      headers: author.headers,
      payload: { name: `Manual Portal ${uuidv7()}` },
    });
    vendor = vendorResponse.json<VendorDetail>();

    const routeResponse = await harness.app.inject({
      method: "POST",
      url: `/v1/vendors/${vendor.id}/routes`,
      headers: author.headers,
      payload: {
        name: "Security portal",
        type: "MANUAL",
        destinationUrl: "https://security.example.test/report",
        fieldMappings: [
          {
            key: "description",
            label: "Description",
            required: true,
            format: "MULTILINE_TEXT",
            submissionField: "reproduction",
            helpText: null,
          },
        ],
        acceptedExtensions: [".pdf"],
        maximumFileBytes: 10_000_000,
        maximumFileCount: 2,
        acknowledgementBusinessDays: 5,
        updateCadenceDays: 42,
        instructions: "Upload the PDF and paste the description.",
        sourceUrl: "https://security.example.test/reporting-policy",
        sourceReviewedAt: new Date().toISOString(),
      },
    });
    route = routeResponse.json<VendorRoute>();

    const artifactId = uuidv7();
    const reportId = uuidv7();
    reportExportId = uuidv7();
    await harness.dbHandle.db.transaction(async (tx) => {
      const ref = await allocateReference(tx, author.organizationId, "report");
      await tx.insert(schema.reports).values({
        id: reportId,
        ref,
        caseId: researchCase.id,
        audience: "VENDOR",
        templateId: "CODEVAULT_VENDOR_V1",
        title: "Vendor security report",
        tlp: "TLP:AMBER+STRICT",
        visibilityCeiling: "VENDOR",
        status: "APPROVED",
        createdBy: author.id,
      });
      await tx.insert(schema.artifacts).values({
        id: artifactId,
        caseId: researchCase.id,
        filename: "vendor-report.pdf",
        objectKey: generateObjectKey(researchCase.id, artifactId),
        mimeType: "application/pdf",
        sizeBytes: 128,
        sha256: "a".repeat(64),
        artifactKind: "DOCUMENT",
        visibility: "VENDOR",
        status: "STORED",
        uploadedBy: author.id,
      });
      await tx.insert(schema.reportExports).values({
        id: reportExportId,
        reportId,
        format: "PDF",
        status: "COMPLETED",
        artifactId,
        sha256: "a".repeat(64),
        tlp: "TLP:AMBER+STRICT",
        templateVersion: "1.0.0",
        requestedBy: author.id,
        completedAt: new Date().toISOString(),
      });
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  it("reviews, approves, seals, and records one exact manual package", async () => {
    const createdResponse = await harness.app.inject({
      method: "POST",
      url: `/v1/cases/${researchCase.id}/submissions`,
      headers: author.headers,
      payload: { vendorId: vendor.id, routeId: route.id, cryptoMode: "PLAIN" },
    });
    expect(createdResponse.statusCode).toBe(200);
    let submission = createdResponse.json<SubmissionDetail>();
    expect(submission.routeSnapshot.routeRevision).toBe(route.revision);

    const updatedResponse = await harness.app.inject({
      method: "PATCH",
      url: `/v1/submissions/${submission.id}`,
      headers: author.headers,
      payload: {
        subject: "",
        bodyMarkdown: "Reproduction details",
        manualFields: { description: "Reproduction details" },
        expectedRevision: submission.revision,
      },
    });
    submission = updatedResponse.json<SubmissionDetail>();

    const attachmentsResponse = await harness.app.inject({
      method: "POST",
      url: `/v1/submissions/${submission.id}/attachments`,
      headers: author.headers,
      payload: {
        artifactIds: [],
        reportExportId,
        expectedRevision: submission.revision,
      },
    });
    submission = attachmentsResponse.json<SubmissionDetail>();

    const validationResponse = await harness.app.inject({
      method: "GET",
      url: `/v1/submissions/${submission.id}/validation`,
      headers: author.headers,
    });
    expect(validationResponse.statusCode).toBe(200);
    expect(validationResponse.json<SubmissionValidationResult>().blocking).toBe(
      false,
    );

    const reviewResponse = await harness.app.inject({
      method: "POST",
      url: `/v1/submissions/${submission.id}/review`,
      headers: author.headers,
      payload: { expectedRevision: submission.revision },
    });
    submission = reviewResponse.json<SubmissionDetail>();
    expect(submission.status).toBe("IN_REVIEW");

    const approveResponse = await harness.app.inject({
      method: "POST",
      url: `/v1/submissions/${submission.id}/approve`,
      headers: author.headers,
      payload: { expectedRevision: submission.revision },
    });
    submission = approveResponse.json<SubmissionDetail>();
    expect(submission.status).toBe("APPROVED");
    expect(submission.currentApproval?.submissionRevision).toBe(
      submission.revision,
    );

    const intentResponse = await harness.app.inject({
      method: "POST",
      url: `/v1/submissions/${submission.id}/seal-intent`,
      headers: author.headers,
    });
    expect(intentResponse.statusCode).toBe(200);
    const intent = intentResponse.json<SubmissionSealIntent>();
    const objectKey = intent.uploadUrl.replace("memory://", "");
    const packageBytes = new TextEncoder().encode("exact sealed package bytes");
    harness.storage.objects.set(objectKey, packageBytes);
    const packageSha256 = createHash("sha256")
      .update(packageBytes)
      .digest("hex");

    const sealResponse = await harness.app.inject({
      method: "POST",
      url: `/v1/submissions/${submission.id}/seal`,
      headers: author.headers,
      payload: {
        intentId: intent.id,
        sha256: packageSha256,
        sizeBytes: packageBytes.byteLength,
        rfcMessageId: null,
      },
    });
    expect(sealResponse.statusCode, sealResponse.body).toBe(200);
    const sealedPackage = sealResponse.json<{ id: string }>();

    const reused = await harness.app.inject({
      method: "POST",
      url: `/v1/submissions/${submission.id}/seal`,
      headers: author.headers,
      payload: {
        intentId: intent.id,
        sha256: packageSha256,
        sizeBytes: packageBytes.byteLength,
        rfcMessageId: null,
      },
    });
    expect(reused.statusCode).toBe(409);

    const delivered = await harness.app.inject({
      method: "POST",
      url: `/v1/submissions/${submission.id}/manual-deliveries`,
      headers: author.headers,
      payload: {
        packageId: sealedPackage.id,
        deliveredAt: new Date().toISOString(),
        destinationUrl: "https://security.example.test/report",
        externalReference: "PORTAL-123",
      },
    });
    expect(delivered.statusCode, delivered.body).toBe(200);
    expect(delivered.json<SubmissionDetail>().status).toBe("RECORDED_MANUALLY");

    const events = await harness.dbHandle.db
      .select({ type: schema.disclosureEvents.type })
      .from(schema.disclosureEvents);
    expect(events.map((event) => event.type)).toContain("DETAILS_SENT");
  });

  it("creates only one in-flight Gmail delivery for repeated native clicks", async () => {
    const routeResponse = await harness.app.inject({
      method: "POST",
      url: `/v1/vendors/${vendor.id}/routes`,
      headers: author.headers,
      payload: {
        name: "PSIRT Gmail",
        type: "EMAIL",
        to: ["security@example.test"],
        cc: [],
        subjectTemplate: "Security report {caseRef}",
        encryptionPolicy: "FORBIDDEN",
        publicKeyId: null,
        maximumAttachmentBytes: 20_000_000,
        acknowledgementBusinessDays: 5,
        updateCadenceDays: 42,
        requiredFields: ["reproduction"],
      },
    });
    const emailRoute = routeResponse.json<VendorRoute>();
    const mailboxId = uuidv7();
    await harness.dbHandle.db.insert(schema.mailboxConnections).values({
      id: mailboxId,
      userId: author.id,
      provider: "gmail",
      externalAccountId: `google-${uuidv7()}`,
      emailAddress: "researcher@example.test",
      capabilities: ["SEND"],
      grantedScopes: ["https://www.googleapis.com/auth/gmail.send"],
      refreshTokenCiphertext: new Uint8Array([1]),
      refreshTokenNonce: new Uint8Array(12),
      refreshTokenAuthTag: new Uint8Array(16),
      tokenKeyVersion: 1,
    });

    const created = await harness.app.inject({
      method: "POST",
      url: `/v1/cases/${researchCase.id}/submissions`,
      headers: author.headers,
      payload: {
        vendorId: vendor.id,
        routeId: emailRoute.id,
        cryptoMode: "PLAIN",
      },
    });
    let submission = created.json<SubmissionDetail>();
    submission = (
      await harness.app.inject({
        method: "PATCH",
        url: `/v1/submissions/${submission.id}`,
        headers: author.headers,
        payload: {
          subject: "Private security report",
          bodyMarkdown: "Reliable reproduction details",
          manualFields: {},
          mailboxConnectionId: mailboxId,
          expectedRevision: submission.revision,
        },
      })
    ).json<SubmissionDetail>();
    submission = (
      await harness.app.inject({
        method: "POST",
        url: `/v1/submissions/${submission.id}/attachments`,
        headers: author.headers,
        payload: {
          artifactIds: [],
          reportExportId,
          expectedRevision: submission.revision,
        },
      })
    ).json<SubmissionDetail>();
    submission = (
      await harness.app.inject({
        method: "POST",
        url: `/v1/submissions/${submission.id}/review`,
        headers: author.headers,
        payload: { expectedRevision: submission.revision },
      })
    ).json<SubmissionDetail>();
    submission = (
      await harness.app.inject({
        method: "POST",
        url: `/v1/submissions/${submission.id}/approve`,
        headers: author.headers,
        payload: { expectedRevision: submission.revision },
      })
    ).json<SubmissionDetail>();
    const intent = (
      await harness.app.inject({
        method: "POST",
        url: `/v1/submissions/${submission.id}/seal-intent`,
        headers: author.headers,
      })
    ).json<SubmissionSealIntent>();
    const bytes = new TextEncoder().encode(
      "From: researcher@example.test\r\nMessage-ID: <stable@codevault.test>\r\n\r\nBody",
    );
    harness.storage.objects.set(
      intent.uploadUrl.replace("memory://", ""),
      bytes,
    );
    const digest = createHash("sha256").update(bytes).digest("hex");
    const sealed = await harness.app.inject({
      method: "POST",
      url: `/v1/submissions/${submission.id}/seal`,
      headers: author.headers,
      payload: {
        intentId: intent.id,
        sha256: digest,
        sizeBytes: bytes.byteLength,
        rfcMessageId: "<stable@codevault.test>",
      },
    });
    expect(sealed.statusCode, sealed.body).toBe(200);

    const first = await harness.app.inject({
      method: "POST",
      url: `/v1/submissions/${submission.id}/send`,
      headers: author.headers,
    });
    const second = await harness.app.inject({
      method: "POST",
      url: `/v1/submissions/${submission.id}/send`,
      headers: author.headers,
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json<{ id: string }>().id).toBe(
      first.json<{ id: string }>().id,
    );
    expect(
      harness.jobs.sent.filter((job) => job.queue === "gmail-send"),
    ).toHaveLength(1);
  });
});
