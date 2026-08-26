import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import type {
  CaseArchiveSnapshot,
  CaseDetail,
  FindingDetail,
  ImportCaseArchiveResult,
  PrepareCaseArchiveImportResult,
} from "@codevault/contracts";
import { uuidv7 } from "@codevault/core/crypto";
import { allocateReference, schema } from "@codevault/db";

import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "../../testing/harness.js";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration("case archive transfer", () => {
  let harness: TestHarness;
  let owner: TestUser;
  let source: CaseDetail;

  beforeAll(async () => {
    harness = await createHarness();
    owner = await harness.createUser();
    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: owner.headers,
      payload: {
        title: "Historical archive source",
        profile: "STANDARD",
        summary: "A case moved between clean deployments.",
      },
    });
    source = created.json<CaseDetail>();
    const finding = await harness.app.inject({
      method: "POST",
      url: "/v1/findings",
      headers: owner.headers,
      payload: {
        caseId: source.id,
        title: "Archive round-trip finding",
        summaryMarkdown: "The archive keeps this finding.",
      },
    });
    expect(finding.statusCode).toBe(200);

    const vendorId = uuidv7();
    const routeId = uuidv7();
    const submissionId = uuidv7();
    const rawArtifactId = uuidv7();
    await harness.dbHandle.db.transaction(async (tx) => {
      await tx.insert(schema.vendors).values({
        id: vendorId,
        ref: await allocateReference(tx, owner.organizationId, "vendor"),
        slug: `archive-vendor-${vendorId}`,
        name: `Archive Vendor ${vendorId}`,
        normalizedName: `archive vendor ${vendorId}`,
        createdBy: owner.id,
      });
      await tx.insert(schema.vendorRoutes).values({
        id: routeId,
        vendorId,
        name: "Portable route",
        type: "MANUAL",
        requirements: {},
        createdBy: owner.id,
      });
      await tx.insert(schema.submissions).values({
        id: submissionId,
        ref: await allocateReference(tx, owner.organizationId, "submission"),
        caseId: source.id,
        vendorId,
        routeId,
        routeSnapshot: {
          routeId,
          routeRevision: 1,
          vendorId,
          capturedAt: new Date().toISOString(),
          route: {},
        },
        status: "SENT",
        coordinationState: "AWAITING_ACKNOWLEDGEMENT",
        subject: "Portable disclosure",
        bodyMarkdown: "The submission body is portable.",
        createdBy: owner.id,
        lastEditedBy: owner.id,
      });
      await tx.insert(schema.artifacts).values({
        id: rawArtifactId,
        caseId: source.id,
        filename: "original.eml",
        objectKey: `archive-test/${rawArtifactId}`,
        mimeType: "message/rfc822",
        sizeBytes: 24,
        sha256: "1".repeat(64),
        artifactKind: "OTHER",
        visibility: "VENDOR",
        status: "STORED",
        uploadedBy: owner.id,
      });
      await tx.insert(schema.correspondenceMessages).values({
        submissionId,
        mailboxConnectionId: null,
        direction: "INBOUND",
        providerMessageId: "provider-secret",
        providerThreadId: "thread-secret",
        rfcMessageId: `<archive-${submissionId}@example.test>`,
        references: [],
        fromAddress: "security@example.test",
        toAddresses: [owner.email],
        ccAddresses: [],
        subject: "Re: Portable disclosure",
        bodyText: "Reviewed plaintext must not enter the archive.",
        bodyEncrypted: "PLAIN",
        rawArtifactId,
        classification: "REQUEST_FOR_INFORMATION",
        visibility: "VENDOR",
        receivedAt: new Date().toISOString(),
        reviewedPlaintextSavedAt: new Date().toISOString(),
      });
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  it("imports verified records in one transaction with new references", async () => {
    const exported = await harness.app.inject({
      method: "GET",
      url: `/v1/cases/${source.id}/archive-snapshot`,
      headers: owner.headers,
    });
    expect(exported.statusCode).toBe(200);
    const snapshot = exported.json<CaseArchiveSnapshot>();
    expect(snapshot.artifacts).toEqual([]);
    expect(snapshot.manifest["version"]).toBe(2);
    const archivedMessages = snapshot.records[
      "correspondenceMessages"
    ] as Array<Record<string, unknown>>;
    expect(archivedMessages).toHaveLength(1);
    expect(archivedMessages[0]).toMatchObject({
      direction: "INBOUND",
      subject: "Re: Portable disclosure",
      classification: "REQUEST_FOR_INFORMATION",
    });
    expect(archivedMessages[0]).not.toHaveProperty("bodyText");
    expect(archivedMessages[0]).not.toHaveProperty("rawArtifactId");
    expect(archivedMessages[0]).not.toHaveProperty("providerMessageId");

    const preparedResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/case-archives/imports",
      headers: owner.headers,
      payload: { manifest: snapshot.manifest, records: snapshot.records },
    });
    expect(preparedResponse.statusCode).toBe(200);
    const prepared = preparedResponse.json<PrepareCaseArchiveImportResult>();
    expect(prepared.uploads).toEqual([]);

    const committed = await harness.app.inject({
      method: "POST",
      url: `/v1/case-archives/imports/${prepared.importId}/commit`,
      headers: owner.headers,
      payload: { uploads: [] },
    });
    expect(committed.statusCode).toBe(200);
    const result = committed.json<ImportCaseArchiveResult>();
    expect(result.caseId).not.toBe(source.id);
    expect(result.recordCounts.findings).toBe(1);
    expect(result.recordCounts.submissions).toBe(1);
    expect(result.recordCounts.correspondenceMessages).toBe(1);

    const [restoredSubmission] = await harness.dbHandle.db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.caseId, result.caseId));
    expect(restoredSubmission).toMatchObject({
      status: "DRAFT",
      coordinationState: "PREPARING",
      subject: "Portable disclosure",
    });
    const [restoredMessage] = await harness.dbHandle.db
      .select()
      .from(schema.correspondenceMessages)
      .where(
        eq(schema.correspondenceMessages.submissionId, restoredSubmission!.id),
      );
    expect(restoredMessage).toMatchObject({
      subject: "Re: Portable disclosure",
      bodyText: null,
      rawArtifactId: null,
      providerMessageId: null,
      providerThreadId: null,
    });

    const imported = await harness.app.inject({
      method: "GET",
      url: `/v1/findings?caseId=${result.caseId}`,
      headers: owner.headers,
    });
    expect(
      imported
        .json<{ items: FindingDetail[] }>()
        .items.map((item) => item.title),
    ).toContain("Archive round-trip finding");
  });

  it("accepts CodeVault UUIDv7 artifact IDs during import preparation", async () => {
    const exported = await harness.app.inject({
      method: "GET",
      url: `/v1/cases/${source.id}/archive-snapshot`,
      headers: owner.headers,
    });
    expect(exported.statusCode).toBe(200);
    const snapshot = exported.json<CaseArchiveSnapshot>();
    const artifactId = "018f47d2-7d20-7a31-8fb8-9d5f3d680002";
    const sha256 = "0".repeat(64);
    const artifact = {
      id: artifactId,
      filename: "uuidv7.txt",
      mimeType: "text/plain",
      sizeBytes: 0,
      sha256,
      artifactKind: "OTHER",
      visibility: "INTERNAL",
    };
    const preparedResponse = await harness.app.inject({
      method: "POST",
      url: "/v1/case-archives/imports",
      headers: owner.headers,
      payload: {
        manifest: {
          ...snapshot.manifest,
          recordCounts: {
            ...(snapshot.manifest["recordCounts"] as Record<string, number>),
            artifacts: 1,
          },
          artifacts: [
            {
              sourceId: artifactId,
              archivePath: `artifacts/${artifactId}/blob`,
              filename: artifact.filename,
              mimeType: artifact.mimeType,
              sizeBytes: artifact.sizeBytes,
              sha256,
              artifactKind: artifact.artifactKind,
              visibility: artifact.visibility,
              capturedAt: null,
              metadata: {},
            },
          ],
        },
        records: {
          ...snapshot.records,
          artifacts: [artifact],
        },
      },
    });

    expect(preparedResponse.statusCode).toBe(200);
    const prepared = preparedResponse.json<PrepareCaseArchiveImportResult>();
    expect(prepared.uploads.map((upload) => upload.sourceId)).toEqual([
      artifactId,
    ]);
  });

  it("rejects plaintext correspondence bodies in version 2 archives", async () => {
    const exported = await harness.app.inject({
      method: "GET",
      url: `/v1/cases/${source.id}/archive-snapshot`,
      headers: owner.headers,
    });
    const snapshot = exported.json<CaseArchiveSnapshot>();
    const messages = snapshot.records["correspondenceMessages"] as Array<
      Record<string, unknown>
    >;

    const prepared = await harness.app.inject({
      method: "POST",
      url: "/v1/case-archives/imports",
      headers: owner.headers,
      payload: {
        manifest: snapshot.manifest,
        records: {
          ...snapshot.records,
          correspondenceMessages: [
            { ...messages[0], bodyText: "should be rejected" },
          ],
        },
      },
    });

    expect(prepared.statusCode).toBe(400);
    expect(
      prepared.json<{ error: { message: string } }>().error.message,
    ).toContain("metadata only");
  });
});
