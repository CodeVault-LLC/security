import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  CaseArchiveSnapshot,
  CaseDetail,
  FindingDetail,
  ImportCaseArchiveResult,
  PrepareCaseArchiveImportResult,
} from "@codevault/contracts";

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
});
