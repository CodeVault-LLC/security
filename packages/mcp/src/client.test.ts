import { describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CodeVaultClient, type CodeVaultApiError } from "./client.js";

const TOKEN = "t".repeat(64);
const ID1 = "00000000-0000-4000-8000-000000000001";
const ID2 = "00000000-0000-4000-8000-000000000002";

describe("CodeVaultClient", () => {
  it("rejects cleartext connections to non-loopback servers", () => {
    expect(
      () =>
        new CodeVaultClient({
          baseUrl: "http://codevault.example",
          token: TOKEN,
        }),
    ).toThrow("must use https");
  });

  it("sends the bearer token only in the authorization header", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({
        user: { id: "user" },
        session: { id: "session" },
      }),
    );
    const client = new CodeVaultClient({
      baseUrl: "http://127.0.0.1:4310/",
      token: TOKEN,
      fetch,
    });

    await client.whoAmI();

    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:4310/v1/auth/me", {
      method: "GET",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        accept: "application/json",
      },
    });
  });

  it("returns bounded server errors without including the credential", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            category: "PERMISSION_DENIED",
            message: "This action requires a writer.",
            requestId: "request-1",
          },
        },
        403,
      ),
    );
    const client = new CodeVaultClient({
      baseUrl: "https://codevault.example",
      token: TOKEN,
      fetch,
    });

    const promise = client.createVendor({ name: "Example" });

    await expect(promise).rejects.toMatchObject({
      status: 403,
      category: "PERMISSION_DENIED",
      requestId: "request-1",
      message: "This action requires a writer.",
    } satisfies Partial<CodeVaultApiError>);
    await expect(promise).rejects.not.toThrow(TOKEN);
  });

  it("records narrative, assets, and affected ranges after draft creation", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(finding(1)))
      .mockResolvedValueOnce(jsonResponse(finding(2)))
      .mockResolvedValueOnce(jsonResponse(finding(2)))
      .mockResolvedValueOnce(jsonResponse(finding(2)));
    const client = new CodeVaultClient({
      baseUrl: "https://codevault.example",
      token: TOKEN,
      fetch,
    });

    await client.recordFinding({
      caseId: "00000000-0000-4000-8000-000000000001",
      title: "Repository path traversal permits file disclosure",
      summaryMarkdown: "A crafted path escapes the repository root.",
      primaryAssetId: "00000000-0000-4000-8000-000000000002",
      technicalMarkdown: "The path is joined before validation.",
      cweIds: ["CWE-22"],
      affectedRanges: [
        {
          assetId: "00000000-0000-4000-8000-000000000003",
          kind: "EXACT_VERSION",
          expression: "1.2.3",
          status: "CONFIRMED_VULNERABLE",
          evidenceNote: "Reproduced against the tagged release.",
        },
      ],
    });

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(requestAt(fetch, 0)).toMatchObject({
      url: "https://codevault.example/v1/findings",
      method: "POST",
      body: {
        title: "Repository path traversal permits file disclosure",
        primaryAssetId: "00000000-0000-4000-8000-000000000002",
      },
    });
    expect(requestAt(fetch, 1)).toMatchObject({
      method: "PATCH",
      body: {
        technicalMarkdown: "The path is joined before validation.",
        cweIds: ["CWE-22"],
        expectedRevision: 1,
      },
    });
    expect(requestAt(fetch, 2).url).toMatch(/\/assets$/u);
    expect(requestAt(fetch, 3).url).toMatch(/\/affected-ranges$/u);
  });

  it("maps finding, evidence, case, and disclosure operations to their API routes", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => jsonResponse({ items: [] }));
    const client = new CodeVaultClient({
      baseUrl: "https://codevault.example",
      token: TOKEN,
      fetch,
    });

    await client.updateFinding(ID1, { title: "Updated", expectedRevision: 3 });
    await client.addFindingScore(ID1, {
      scheme: "CVSS40",
      vector: "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N",
      approve: true,
    });
    await client.approveFindingScore(ID1, ID2);
    await client.addFindingIdentifier(ID1, {
      scheme: "CVE",
      value: "CVE-2026-1234",
    });
    await client.addFindingClaim(ID1, {
      key: "reproduction.result",
      statementMarkdown: "The issue reproduced.",
      sourceType: "EVIDENCE",
      sourceRef: "EVD-2026-0001",
      confidence: "HIGH",
      visibility: "INTERNAL",
    });
    await client.addFindingReference(ID1, {
      title: "Vendor advisory",
      url: "https://example.test/advisory",
      visibility: "PUBLIC",
    });
    await client.listEvidence({ caseId: ID1, findingId: ID2, limit: 20 });
    await client.createEvidence({
      caseId: ID1,
      findingId: ID2,
      title: "Reproduction output",
      visibility: "INTERNAL",
    });
    await client.updateEvidence(ID2, {
      descriptionMarkdown: "Updated evidence.",
      expectedRevision: 2,
    });
    await client.getArtifactDownload(ID2);
    await client.getCase(ID1);
    await client.updateCase(ID1, { summary: "Updated", expectedRevision: 4 });
    await client.listCaseNotes(ID1);
    await client.addCaseNote(ID1, { bodyMarkdown: "Coordination note" });
    await client.getCaseReadiness(ID1);
    await client.getCaseDisclosure(ID1);
    await client.addCaseStakeholder(ID1, {
      name: "Vendor PSIRT",
      role: "VENDOR_SECURITY",
      email: "security@example.test",
    });
    await client.addDisclosureEvent(ID1, {
      type: "VENDOR_CONTACTED",
      occurredAt: "2026-08-19T12:00:00.000Z",
      visibility: "VENDOR",
    });
    await client.setCaseEmbargo(ID1, {
      plannedDisclosureAt: "2026-11-17T12:00:00.000Z",
    });

    expect(fetch.mock.calls.map((_, index) => requestAt(fetch, index))).toEqual(
      [
        request("/v1/findings/00000000-0000-4000-8000-000000000001", "PATCH", {
          title: "Updated",
          expectedRevision: 3,
        }),
        request(
          "/v1/findings/00000000-0000-4000-8000-000000000001/scores",
          "POST",
          {
            scheme: "CVSS40",
            vector:
              "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N",
            approve: true,
          },
        ),
        request(
          "/v1/findings/00000000-0000-4000-8000-000000000001/scores/00000000-0000-4000-8000-000000000002/approve",
          "POST",
        ),
        request(
          "/v1/findings/00000000-0000-4000-8000-000000000001/identifiers",
          "POST",
          {
            scheme: "CVE",
            value: "CVE-2026-1234",
          },
        ),
        request(
          "/v1/findings/00000000-0000-4000-8000-000000000001/claims",
          "POST",
          {
            key: "reproduction.result",
            statementMarkdown: "The issue reproduced.",
            sourceType: "EVIDENCE",
            sourceRef: "EVD-2026-0001",
            confidence: "HIGH",
            visibility: "INTERNAL",
          },
        ),
        request(
          "/v1/findings/00000000-0000-4000-8000-000000000001/references",
          "POST",
          {
            title: "Vendor advisory",
            url: "https://example.test/advisory",
            visibility: "PUBLIC",
          },
        ),
        request(
          "/v1/evidence?caseId=00000000-0000-4000-8000-000000000001&findingId=00000000-0000-4000-8000-000000000002&limit=20",
        ),
        request("/v1/evidence", "POST", {
          caseId: ID1,
          findingId: ID2,
          title: "Reproduction output",
          visibility: "INTERNAL",
        }),
        request("/v1/evidence/00000000-0000-4000-8000-000000000002", "PATCH", {
          descriptionMarkdown: "Updated evidence.",
          expectedRevision: 2,
        }),
        request("/v1/artifacts/00000000-0000-4000-8000-000000000002"),
        request("/v1/cases/00000000-0000-4000-8000-000000000001"),
        request("/v1/cases/00000000-0000-4000-8000-000000000001", "PATCH", {
          summary: "Updated",
          expectedRevision: 4,
        }),
        request("/v1/cases/00000000-0000-4000-8000-000000000001/notes"),
        request(
          "/v1/cases/00000000-0000-4000-8000-000000000001/notes",
          "POST",
          {
            bodyMarkdown: "Coordination note",
          },
        ),
        request("/v1/cases/00000000-0000-4000-8000-000000000001/readiness"),
        request("/v1/cases/00000000-0000-4000-8000-000000000001/disclosure"),
        request(
          "/v1/cases/00000000-0000-4000-8000-000000000001/stakeholders",
          "POST",
          {
            name: "Vendor PSIRT",
            role: "VENDOR_SECURITY",
            email: "security@example.test",
          },
        ),
        request(
          "/v1/cases/00000000-0000-4000-8000-000000000001/disclosure-events",
          "POST",
          {
            type: "VENDOR_CONTACTED",
            occurredAt: "2026-08-19T12:00:00.000Z",
            visibility: "VENDOR",
          },
        ),
        request(
          "/v1/cases/00000000-0000-4000-8000-000000000001/embargo",
          "POST",
          {
            plannedDisclosureAt: "2026-11-17T12:00:00.000Z",
          },
        ),
      ],
    );
  });

  it("maps asset, vendor, and report operations to their API routes", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => jsonResponse({ items: [] }));
    const client = new CodeVaultClient({
      baseUrl: "https://codevault.example",
      token: TOKEN,
      fetch,
    });

    await client.getAsset(ID1);
    await client.updateAsset(ID1, { name: "Gateway", expectedRevision: 2 });
    await client.addAssetIdentifier(ID1, {
      scheme: "PURL",
      value: "pkg:npm/example@1.0.0",
      primary: true,
    });
    await client.addAssetVersion(ID1, { version: "1.0.1" });
    await client.addAssetRelationship(ID1, {
      relationship: "CONTAINS",
      toAssetId: ID2,
    });
    await client.getVendor(ID1);
    await client.updateVendor(ID1, {
      name: "Example Ltd",
      expectedRevision: 3,
    });
    await client.addVendorContactRoute(ID1, {
      name: "PSIRT email",
      type: "EMAIL",
      to: ["security@example.test"],
      cc: [],
      subjectTemplate: "Security report {caseRef}",
      maximumAttachmentBytes: 10_000_000,
      acknowledgementBusinessDays: 5,
      updateCadenceDays: 14,
      requiredFields: ["reproduction"],
      encryptionPolicy: "OPTIONAL",
      publicKeyId: null,
    });
    await client.getVendorContactRoute(ID2);
    await client.updateVendorContactRoute(ID2, {
      active: false,
      expectedRevision: 2,
    });
    await client.addVendorPublicKey(ID1, {
      armoredKey: "-----BEGIN PGP PUBLIC KEY BLOCK-----\n...",
      sourceUrl: "https://example.test/key.asc",
      expectedFingerprint: "A".repeat(40),
    });
    await client.verifyVendorPublicKey(ID1, ID2, {
      expectedFingerprint: "A".repeat(40),
      sourceUrl: "https://example.test/fingerprint",
      expectedRevision: 1,
    });
    await client.listReportTemplates();
    await client.listReports(ID1);
    await client.createReport({ caseId: ID1, audience: "VENDOR" });
    await client.getReport(ID1);
    await client.updateReport(ID1, {
      title: "Vendor report",
      expectedRevision: 2,
    });
    await client.updateReportSection(ID1, ID2, {
      contentMarkdown: "Technical details.",
      expectedRevision: 3,
    });
    await client.lintReport(ID1);
    await client.previewReport(ID1);
    await client.approveReport(ID1, { expectedRevision: 4 });
    await client.listReportExports(ID1);
    await client.exportReport(ID1, { format: "PDF" });

    expect(fetch.mock.calls.map((_, index) => requestAt(fetch, index))).toEqual(
      [
        request(`/v1/assets/${ID1}`),
        request(`/v1/assets/${ID1}`, "PATCH", {
          name: "Gateway",
          expectedRevision: 2,
        }),
        request(`/v1/assets/${ID1}/identifiers`, "POST", {
          scheme: "PURL",
          value: "pkg:npm/example@1.0.0",
          primary: true,
        }),
        request(`/v1/assets/${ID1}/versions`, "POST", { version: "1.0.1" }),
        request(`/v1/assets/${ID1}/relationships`, "POST", {
          relationship: "CONTAINS",
          toAssetId: ID2,
        }),
        request(`/v1/vendors/${ID1}`),
        request(`/v1/vendors/${ID1}`, "PATCH", {
          name: "Example Ltd",
          expectedRevision: 3,
        }),
        request(`/v1/vendors/${ID1}/routes`, "POST", {
          name: "PSIRT email",
          type: "EMAIL",
          to: ["security@example.test"],
          cc: [],
          subjectTemplate: "Security report {caseRef}",
          maximumAttachmentBytes: 10_000_000,
          acknowledgementBusinessDays: 5,
          updateCadenceDays: 14,
          requiredFields: ["reproduction"],
          encryptionPolicy: "OPTIONAL",
          publicKeyId: null,
        }),
        request(`/v1/vendor-routes/${ID2}`),
        request(`/v1/vendor-routes/${ID2}`, "PATCH", {
          active: false,
          expectedRevision: 2,
        }),
        request(`/v1/vendors/${ID1}/public-keys`, "POST", {
          armoredKey: "-----BEGIN PGP PUBLIC KEY BLOCK-----\n...",
          sourceUrl: "https://example.test/key.asc",
          expectedFingerprint: "A".repeat(40),
        }),
        request(`/v1/vendors/${ID1}/public-keys/${ID2}/verify`, "POST", {
          expectedFingerprint: "A".repeat(40),
          sourceUrl: "https://example.test/fingerprint",
          expectedRevision: 1,
        }),
        request("/v1/report-templates"),
        request(`/v1/reports?caseId=${ID1}`),
        request("/v1/reports", "POST", { caseId: ID1, audience: "VENDOR" }),
        request(`/v1/reports/${ID1}`),
        request(`/v1/reports/${ID1}`, "PATCH", {
          title: "Vendor report",
          expectedRevision: 2,
        }),
        request(`/v1/reports/${ID1}/sections/${ID2}`, "PATCH", {
          contentMarkdown: "Technical details.",
          expectedRevision: 3,
        }),
        request(`/v1/reports/${ID1}/lint`),
        request(`/v1/reports/${ID1}/preview`),
        request(`/v1/reports/${ID1}/approve`, "POST", { expectedRevision: 4 }),
        request(`/v1/reports/${ID1}/exports`),
        request(`/v1/reports/${ID1}/exports`, "POST", { format: "PDF" }),
      ],
    );
  });

  it("uploads evidence bytes to presigned storage without sending the bearer token", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codevault-mcp-upload-"));
    const filePath = join(directory, "reproduction.txt");
    await writeFile(filePath, "reproduced\n", "utf8");
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      const target = String(url);
      if (target === "https://storage.example/upload") {
        expect(init?.headers).toEqual({ "x-upload-token": "one-time" });
        expect(JSON.stringify(init?.headers)).not.toContain(TOKEN);
        return new Response(null, { status: 200, headers: { etag: "part-1" } });
      }
      if (target.endsWith("/v1/uploads")) {
        return jsonResponse({
          artifactId: ID2,
          objectKey: "opaque/key",
          strategy: "SINGLE",
          url: "https://storage.example/upload",
          multipartUploadId: null,
          partSizeBytes: 5_242_880,
          partUrls: [],
          requiredHeaders: { "x-upload-token": "one-time" },
          expiresAt: "2026-08-19T13:00:00.000Z",
        });
      }
      if (target.endsWith(`/v1/uploads/${ID2}/complete`)) {
        return jsonResponse({ id: ID2, status: "STORED" });
      }
      if (target.endsWith("/v1/evidence")) {
        return jsonResponse({ id: ID1, artifacts: [{ id: ID2 }] });
      }
      throw new Error(`Unexpected URL: ${target}`);
    });
    const client = new CodeVaultClient({
      baseUrl: "https://codevault.example",
      token: TOKEN,
      fetch,
    });

    const uploaded = await client.uploadEvidenceFile({
      caseId: ID1,
      filePath,
      mimeType: "text/plain",
      artifactKind: "TERMINAL_OUTPUT",
      visibility: "INTERNAL",
      evidenceTitle: "Reproduction output",
    });

    expect(uploaded).toMatchObject({
      artifact: { id: ID2, status: "STORED" },
      evidence: { id: ID1 },
    });
    expect(requestAt(fetch, 0)).toMatchObject({
      url: "https://codevault.example/v1/uploads",
      method: "POST",
      body: {
        caseId: ID1,
        filename: "reproduction.txt",
        mimeType: "text/plain",
        sizeBytes: 11,
        artifactKind: "TERMINAL_OUTPUT",
        visibility: "INTERNAL",
      },
    });
    expect(requestAt(fetch, 2)).toEqual(
      request(`/v1/uploads/${ID2}/complete`, "POST", {}),
    );
    expect(requestAt(fetch, 3)).toMatchObject({
      url: "https://codevault.example/v1/evidence",
      method: "POST",
      body: {
        caseId: ID1,
        title: "Reproduction output",
        visibility: "INTERNAL",
        artifactIds: [ID2],
      },
    });
  });

  it("completes multipart uploads and appends the artifact to existing evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codevault-mcp-parts-"));
    const filePath = join(directory, "capture.bin");
    await writeFile(filePath, "abcdefgh", "utf8");
    const oldArtifactId = "00000000-0000-4000-8000-000000000003";
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      const target = String(url);
      if (target === "https://storage.example/part-1") {
        expect(await new Response(init?.body).text()).toBe("abcd");
        return new Response(null, { status: 200, headers: { etag: "etag-1" } });
      }
      if (target === "https://storage.example/part-2") {
        expect(await new Response(init?.body).text()).toBe("efgh");
        return new Response(null, { status: 200, headers: { etag: "etag-2" } });
      }
      if (target.endsWith("/v1/uploads")) {
        return jsonResponse({
          artifactId: ID2,
          objectKey: "opaque/key",
          strategy: "MULTIPART",
          url: null,
          multipartUploadId: "multipart-1",
          partSizeBytes: 4,
          partUrls: [
            "https://storage.example/part-1",
            "https://storage.example/part-2",
          ],
          requiredHeaders: {},
          expiresAt: "2026-08-19T13:00:00.000Z",
        });
      }
      if (target.endsWith(`/v1/uploads/${ID2}/complete`)) {
        return jsonResponse({ id: ID2, status: "VERIFYING" });
      }
      if (target.includes("/v1/evidence?")) {
        return jsonResponse({
          items: [
            {
              id: ID1,
              revision: 7,
              artifacts: [{ id: oldArtifactId }],
            },
          ],
          nextCursor: null,
        });
      }
      if (target.endsWith(`/v1/evidence/${ID1}`)) {
        return jsonResponse({ id: ID1, artifacts: [] });
      }
      throw new Error(`Unexpected URL: ${target}`);
    });
    const client = new CodeVaultClient({
      baseUrl: "https://codevault.example",
      token: TOKEN,
      fetch,
    });

    await client.uploadEvidenceFile({
      caseId: ID1,
      evidenceId: ID1,
      filePath,
      mimeType: "application/octet-stream",
      artifactKind: "BINARY",
      visibility: "INTERNAL",
    });

    expect(requestAt(fetch, 3)).toEqual(
      request(`/v1/uploads/${ID2}/complete`, "POST", {
        parts: [
          { partNumber: 1, etag: "etag-1" },
          { partNumber: 2, etag: "etag-2" },
        ],
      }),
    );
    expect(requestAt(fetch, 5)).toEqual(
      request(`/v1/evidence/${ID1}`, "PATCH", {
        artifactIds: [oldArtifactId, ID2],
        expectedRevision: 7,
      }),
    );
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function finding(revision: number): Record<string, unknown> {
  return {
    id: "00000000-0000-4000-8000-000000000004",
    revision,
  };
}

function requestAt(
  fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>,
  index: number,
): { url: string; method: string; body: Record<string, unknown> } {
  const call = fetch.mock.calls[index];
  if (call === undefined) throw new Error("Missing fetch call.");
  const [url, init] = call;
  return {
    url: String(url),
    method: init?.method ?? "GET",
    body:
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {},
  };
}

function request(
  path: string,
  method = "GET",
  body: Record<string, unknown> = {},
): { url: string; method: string; body: Record<string, unknown> } {
  return { url: `https://codevault.example${path}`, method, body };
}
