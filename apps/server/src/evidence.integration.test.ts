import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  Artifact,
  CaseDetail,
  Evidence,
  FindingDetail,
  UploadInstructions,
} from "@codevault/contracts";
import { schema } from "@codevault/db";

import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "./testing/harness.js";

/**
 * Uploads and evidence.
 *
 * The upload path is where attacker-controlled bytes and filenames enter the
 * system, so these tests care about three things: the object key is never
 * derived from the filename, an upload cannot be marked complete unless the
 * object is really there and the right size, and a download from a restricted
 * case is audited.
 */

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

const DIGEST = "c".repeat(64);

describeIntegration("uploads", () => {
  let harness: TestHarness;
  let user: TestUser;
  let researchCase: CaseDetail;

  beforeAll(async () => {
    harness = await createHarness();
    user = await harness.createUser({ role: "MEMBER" });

    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: user.headers,
      payload: { title: "Uploads", profile: "STANDARD" },
    });

    researchCase = created.json<CaseDetail>();
  });

  afterAll(async () => {
    await harness.close();
  });

  async function startUpload(
    overrides: Record<string, unknown> = {},
  ): Promise<UploadInstructions> {
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/uploads",
      headers: user.headers,
      payload: {
        caseId: researchCase.id,
        filename: "capture.har",
        mimeType: "application/json",
        sizeBytes: 1_024,
        sha256: DIGEST,
        artifactKind: "HAR",
        visibility: "INTERNAL",
        ...overrides,
      },
    });

    expect(response.statusCode).toBe(200);

    return response.json<UploadInstructions>();
  }

  it("never puts the uploaded filename in the object key", async () => {
    const instructions = await startUpload({
      filename: "../../etc/passwd; rm -rf /.har",
    });

    expect(instructions.objectKey).not.toContain("passwd");
    expect(instructions.objectKey).not.toContain("..");
    expect(instructions.objectKey).toMatch(
      new RegExp(`^cases/${researchCase.id}/artifacts/[0-9a-f-]+/[0-9a-f]+$`),
    );
  });

  it("keeps the original filename in the database", async () => {
    const filename = "weird name (1).pcap";
    const instructions = await startUpload({ filename, artifactKind: "PCAP" });

    const rows = await harness.dbHandle.db
      .select({ filename: schema.artifacts.filename })
      .from(schema.artifacts)
      .where(eq(schema.artifacts.id, instructions.artifactId))
      .limit(1);

    expect(rows[0]?.filename).toBe(filename);
  });

  it("refuses a digest that is not a SHA-256 hex string", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/uploads",
      headers: user.headers,
      payload: {
        caseId: researchCase.id,
        filename: "x.txt",
        mimeType: "text/plain",
        sizeBytes: 10,
        sha256: "not-a-digest",
        artifactKind: "LOG",
        visibility: "INTERNAL",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("refuses a file above the configured maximum", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/uploads",
      headers: user.headers,
      payload: {
        caseId: researchCase.id,
        filename: "huge.bin",
        mimeType: "application/octet-stream",
        sizeBytes: harness.config.storage.maxUploadBytes + 1,
        sha256: DIGEST,
        artifactKind: "BINARY",
        visibility: "INTERNAL",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("refuses to complete an upload whose object is not in storage", async () => {
    const instructions = await startUpload();

    const response = await harness.app.inject({
      method: "POST",
      url: `/v1/uploads/${instructions.artifactId}/complete`,
      headers: user.headers,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it("refuses to complete an upload whose stored size differs", async () => {
    const instructions = await startUpload();

    harness.storage.objects.set(instructions.objectKey, new Uint8Array(1_024));
    harness.storage.reportedSizeOverride = 999;

    const response = await harness.app.inject({
      method: "POST",
      url: `/v1/uploads/${instructions.artifactId}/complete`,
      headers: user.headers,
      payload: {},
    });

    harness.storage.reportedSizeOverride = null;

    expect(response.statusCode).toBe(400);
    expect(
      response.json<{ error: { message: string } }>().error.message,
    ).toContain("999 bytes");

    const rows = await harness.dbHandle.db
      .select({ status: schema.artifacts.status })
      .from(schema.artifacts)
      .where(eq(schema.artifacts.id, instructions.artifactId))
      .limit(1);

    // A mismatch quarantines the artifact rather than leaving it pending, so
    // it can never be attached to evidence later.
    expect(rows[0]?.status).toBe("QUARANTINED");
  });

  it("keeps a matching-size upload unavailable until digest verification", async () => {
    const before = harness.jobs.sent.length;
    const instructions = await startUpload();

    harness.storage.objects.set(instructions.objectKey, new Uint8Array(1_024));

    const response = await harness.app.inject({
      method: "POST",
      url: `/v1/uploads/${instructions.artifactId}/complete`,
      headers: user.headers,
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<Artifact>().status).toBe("VERIFYING");
    expect(harness.jobs.sent.length).toBe(before + 1);
    expect(harness.jobs.sent.at(-1)?.queue).toBe("artifact-integrity");
  });

  it("discards an uploaded artifact that was never attached", async () => {
    const instructions = await startUpload();
    harness.storage.objects.set(instructions.objectKey, new Uint8Array(1_024));
    await harness.app.inject({
      method: "POST",
      url: `/v1/uploads/${instructions.artifactId}/complete`,
      headers: user.headers,
      payload: {},
    });

    const response = await harness.app.inject({
      method: "DELETE",
      url: `/v1/artifacts/${instructions.artifactId}`,
      headers: user.headers,
    });

    expect(response.statusCode).toBe(200);
    const [artifact] = await harness.dbHandle.db
      .select({ status: schema.artifacts.status })
      .from(schema.artifacts)
      .where(eq(schema.artifacts.id, instructions.artifactId));
    expect(artifact?.status).toBe("DELETED");
    expect(harness.jobs.sent.at(-1)?.queue).toBe("artifact-delete");
  });

  it("does not discard an artifact after it is attached", async () => {
    const instructions = await startUpload();
    await harness.app.inject({
      method: "POST",
      url: "/v1/evidence",
      headers: user.headers,
      payload: {
        caseId: researchCase.id,
        title: "Attached capture",
        visibility: "INTERNAL",
        artifactIds: [instructions.artifactId],
      },
    });

    const response = await harness.app.inject({
      method: "DELETE",
      url: `/v1/artifacts/${instructions.artifactId}`,
      headers: user.headers,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { message: string } }>().error.message).toBe(
      "An attached artifact cannot be discarded.",
    );
  });

  it("refuses to complete the same upload twice", async () => {
    const instructions = await startUpload();

    harness.storage.objects.set(instructions.objectKey, new Uint8Array(1_024));

    await harness.app.inject({
      method: "POST",
      url: `/v1/uploads/${instructions.artifactId}/complete`,
      headers: user.headers,
      payload: {},
    });

    const second = await harness.app.inject({
      method: "POST",
      url: `/v1/uploads/${instructions.artifactId}/complete`,
      headers: user.headers,
      payload: {},
    });

    expect(second.statusCode).toBe(400);
  });

  it("refuses an upload into a case the user cannot write", async () => {
    const other = await harness.createUser({ role: "VIEWER" });

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/uploads",
      headers: other.headers,
      payload: {
        caseId: researchCase.id,
        filename: "x.txt",
        mimeType: "text/plain",
        sizeBytes: 10,
        sha256: DIGEST,
        artifactKind: "LOG",
        visibility: "INTERNAL",
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it("refuses to attach an artifact belonging to another case", async () => {
    const otherCase = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: user.headers,
      payload: { title: "Other case", profile: "STANDARD" },
    });

    const instructions = await startUpload();

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/evidence",
      headers: user.headers,
      payload: {
        caseId: otherCase.json<CaseDetail>().id,
        title: "Cross-case attachment",
        visibility: "INTERNAL",
        artifactIds: [instructions.artifactId],
      },
    });

    expect(response.statusCode).toBe(400);
  });
});

describeIntegration("artifact downloads", () => {
  let harness: TestHarness;
  let user: TestUser;

  beforeAll(async () => {
    harness = await createHarness();
    user = await harness.createUser({ role: "MEMBER" });
  });

  afterAll(async () => {
    await harness.close();
  });

  async function storedArtifact(restricted: boolean): Promise<{
    artifactId: string;
    caseId: string;
  }> {
    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: user.headers,
      payload: {
        title: restricted ? "Restricted downloads" : "Open downloads",
        profile: "STANDARD",
        restricted,
      },
    });

    const caseId = created.json<CaseDetail>().id;

    const upload = await harness.app.inject({
      method: "POST",
      url: "/v1/uploads",
      headers: user.headers,
      payload: {
        caseId,
        filename: "poc.py",
        mimeType: "text/x-python",
        sizeBytes: 64,
        sha256: DIGEST,
        artifactKind: "POC",
        visibility: "INTERNAL",
      },
    });

    const instructions = upload.json<UploadInstructions>();

    harness.storage.objects.set(instructions.objectKey, new Uint8Array(64));

    await harness.app.inject({
      method: "POST",
      url: `/v1/uploads/${instructions.artifactId}/complete`,
      headers: user.headers,
      payload: {},
    });

    // This helper creates a record for download authorization tests. Streaming
    // integrity itself is exercised by the worker integration suite.
    await harness.dbHandle.db
      .update(schema.artifacts)
      .set({ status: "STORED" })
      .where(eq(schema.artifacts.id, instructions.artifactId));

    return { artifactId: instructions.artifactId, caseId };
  }

  it("issues a short-lived URL rather than serving the bytes", async () => {
    const { artifactId } = await storedArtifact(false);

    const response = await harness.app.inject({
      method: "GET",
      url: `/v1/artifacts/${artifactId}`,
      headers: user.headers,
    });

    expect(response.statusCode).toBe(200);

    const body = response.json<{
      url: string;
      expiresAt: string;
      sha256: string;
    }>();

    expect(body.url).toContain("memory://");
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(body.sha256).toBe(DIGEST);
  });

  it("audits a download from a restricted case", async () => {
    const { artifactId } = await storedArtifact(true);

    await harness.app.inject({
      method: "GET",
      url: `/v1/artifacts/${artifactId}`,
      headers: user.headers,
    });

    const audit = await harness.dbHandle.db
      .select({ action: schema.auditEvents.action })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, artifactId));

    expect(audit.map((row) => row.action)).toContain("artifact.downloaded");
  });

  it("hides a restricted-case artifact from an ungranted member", async () => {
    const { artifactId } = await storedArtifact(true);
    const outsider = await harness.createUser({ role: "MEMBER" });

    const response = await harness.app.inject({
      method: "GET",
      url: `/v1/artifacts/${artifactId}`,
      headers: outsider.headers,
    });

    expect(response.statusCode).toBe(404);
  });
});

describeIntegration("proof of concept records", () => {
  let harness: TestHarness;
  let user: TestUser;
  let finding: FindingDetail;

  beforeAll(async () => {
    harness = await createHarness();
    user = await harness.createUser({ role: "MEMBER" });

    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: user.headers,
      payload: { title: "PoC", profile: "STANDARD" },
    });

    const createdFinding = await harness.app.inject({
      method: "POST",
      url: "/v1/findings",
      headers: user.headers,
      payload: {
        caseId: created.json<CaseDetail>().id,
        title: "PoC target",
      },
    });

    finding = createdFinding.json<FindingDetail>();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("records a run and derives the status from its outcome", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/pocs",
      headers: user.headers,
      payload: {
        findingId: finding.id,
        title: "Trigger the injection",
        instructionsMarkdown: "1. POST the payload.\n2. Observe the response.",
        visibility: "INTERNAL",
      },
    });

    expect(created.statusCode).toBe(200);

    const poc = created.json<{ id: string; status: string }>();

    expect(poc.status).toBe("DRAFT");

    const run = await harness.app.inject({
      method: "POST",
      url: `/v1/pocs/${poc.id}/runs`,
      headers: user.headers,
      payload: { outcome: "SUCCESS", environment: "4.1.6 on Debian 12" },
    });

    expect(run.statusCode).toBe(200);

    const updated = run.json<{
      status: string;
      lastVerifiedAt: string | null;
      runs: Array<{ outcome: string; ranBy: { id: string } }>;
    }>();

    // "Verified" always traces back to a specific run by a specific person.
    expect(updated.status).toBe("VERIFIED");
    expect(updated.lastVerifiedAt).not.toBeNull();
    expect(updated.runs[0]?.outcome).toBe("SUCCESS");
    expect(updated.runs[0]?.ranBy.id).toBe(user.id);
  });

  it("marks a PoC failed when a run fails", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/pocs",
      headers: user.headers,
      payload: {
        findingId: finding.id,
        title: "Second attempt",
        instructionsMarkdown: "Try the other parameter.",
        visibility: "INTERNAL",
      },
    });

    const poc = created.json<{ id: string }>();

    const run = await harness.app.inject({
      method: "POST",
      url: `/v1/pocs/${poc.id}/runs`,
      headers: user.headers,
      payload: { outcome: "FAILURE" },
    });

    expect(run.json<{ status: string }>().status).toBe("FAILED");
  });
});

describeIntegration("evidence visibility", () => {
  let harness: TestHarness;
  let user: TestUser;

  beforeAll(async () => {
    harness = await createHarness();
    user = await harness.createUser({ role: "MEMBER" });
  });

  afterAll(async () => {
    await harness.close();
  });

  it("audits a change of visibility separately from an ordinary edit", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: user.headers,
      payload: { title: "Promotion", profile: "COORDINATED_DISCLOSURE" },
    });

    const caseId = created.json<CaseDetail>().id;

    const evidence = await harness.app.inject({
      method: "POST",
      url: "/v1/evidence",
      headers: user.headers,
      payload: {
        caseId,
        title: "Screenshot",
        visibility: "INTERNAL",
      },
    });

    const record = evidence.json<Evidence>();

    const promoted = await harness.app.inject({
      method: "PATCH",
      url: `/v1/evidence/${record.id}`,
      headers: user.headers,
      payload: { visibility: "VENDOR", expectedRevision: record.revision },
    });

    expect(promoted.statusCode).toBe(200);
    expect(promoted.json<Evidence>().visibility).toBe("VENDOR");

    const audit = await harness.dbHandle.db
      .select({ action: schema.auditEvents.action })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, record.id));

    expect(audit.map((row) => row.action)).toContain(
      "evidence.visibility_changed",
    );
  });

  it("excludes restricted-case evidence for an ungranted member", async () => {
    const other = await harness.createUser({ role: "MEMBER" });
    const createdCase = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: user.headers,
      payload: {
        title: "Organization-wide evidence",
        profile: "CRITICAL_ZERO_DAY",
        restricted: true,
      },
    });
    const evidence = await harness.app.inject({
      method: "POST",
      url: "/v1/evidence",
      headers: user.headers,
      payload: {
        caseId: createdCase.json<CaseDetail>().id,
        title: "Restricted reproduction details",
        visibility: "INTERNAL",
      },
    });

    const response = await harness.app.inject({
      method: "GET",
      url: "/v1/evidence?limit=200",
      headers: other.headers,
    });
    const ids = response
      .json<{ items: Evidence[] }>()
      .items.map((item) => item.id);

    expect(response.statusCode).toBe(200);
    expect(ids).not.toContain(evidence.json<Evidence>().id);
  });
});
