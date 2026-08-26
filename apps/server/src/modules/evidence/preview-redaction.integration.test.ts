import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import type { Artifact, CaseDetail, Evidence } from "@codevault/contracts";
import { uuidv7 } from "@codevault/core/crypto";
import { allocateReference, schema } from "@codevault/db";

import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "../../testing/harness.js";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration("artifact preview redaction", () => {
  let harness: TestHarness;
  let user: TestUser;
  let researchCase: CaseDetail;
  let artifactId: string;

  beforeAll(async () => {
    harness = await createHarness();
    user = await harness.createUser();
    researchCase = (
      await harness.app.inject({
        method: "POST",
        url: "/v1/cases",
        headers: user.headers,
        payload: { title: `Redaction ${uuidv7()}`, profile: "STANDARD" },
      })
    ).json<CaseDetail>();
    artifactId = uuidv7();
    const evidenceId = uuidv7();
    await harness.dbHandle.db.transaction(async (tx) => {
      await tx.insert(schema.artifacts).values({
        id: artifactId,
        caseId: researchCase.id,
        filename: "request.txt",
        objectKey: `redaction/${artifactId}`,
        mimeType: "text/plain",
        sizeBytes: 40,
        sha256: "a".repeat(64),
        artifactKind: "HTTP_CAPTURE",
        visibility: "INTERNAL",
        status: "STORED",
        previewKind: "TEXT_EXCERPT",
        previewText: "Authorization: secret-token\nHost: internal.test",
        uploadedBy: user.id,
      });
      await tx.insert(schema.evidence).values({
        id: evidenceId,
        ref: await allocateReference(tx, user.organizationId, "evidence"),
        caseId: researchCase.id,
        title: "Captured request",
        visibility: "INTERNAL",
        createdBy: user.id,
      });
      await tx
        .insert(schema.evidenceArtifacts)
        .values({ evidenceId, artifactId });
    });
  });

  afterAll(async () => harness.close());

  it("redacts effective previews without changing the source excerpt", async () => {
    const saved = await harness.app.inject({
      method: "PATCH",
      url: `/v1/artifacts/${artifactId}/preview-redaction`,
      headers: user.headers,
      payload: {
        rules: [
          { match: "secret-token", replacement: "[REDACTED]" },
          { match: "internal.test", replacement: "[HOST]" },
        ],
        expectedRevision: null,
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json<Artifact>()).toMatchObject({
      previewText: "Authorization: [REDACTED]\nHost: [HOST]",
      previewRedaction: { revision: 1 },
    });

    const [stored] = await harness.dbHandle.db
      .select({ previewText: schema.artifacts.previewText })
      .from(schema.artifacts)
      .where(eq(schema.artifacts.id, artifactId));
    expect(stored?.previewText).toContain("secret-token");

    const listed = await harness.app.inject({
      method: "GET",
      url: `/v1/evidence?caseId=${researchCase.id}`,
      headers: user.headers,
    });
    const evidence = listed.json<{ items: Evidence[] }>().items[0]!;
    expect(evidence.artifacts[0]?.previewText).not.toContain("secret-token");
  });

  it("enforces revisions and can clear the redaction", async () => {
    const stale = await harness.app.inject({
      method: "PATCH",
      url: `/v1/artifacts/${artifactId}/preview-redaction`,
      headers: user.headers,
      payload: {
        rules: [{ match: "secret-token", replacement: "[SECRET]" }],
        expectedRevision: 99,
      },
    });
    expect(stale.statusCode).toBe(409);

    const cleared = await harness.app.inject({
      method: "PATCH",
      url: `/v1/artifacts/${artifactId}/preview-redaction`,
      headers: user.headers,
      payload: { rules: [], expectedRevision: 1 },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json<Artifact>()).toMatchObject({
      previewText: "Authorization: secret-token\nHost: internal.test",
      previewRedaction: null,
    });
  });
});
