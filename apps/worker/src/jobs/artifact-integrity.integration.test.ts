import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CaseDetail, UploadInstructions } from "@codevault/contracts";
import { schema } from "@codevault/db";
import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "../../../server/src/testing/harness.js";
import type { WorkerContext } from "../context.js";
import { verifyArtifactIntegrity } from "./artifact-integrity.js";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration("streaming artifact integrity", () => {
  let harness: TestHarness;
  let user: TestUser;
  let researchCase: CaseDetail;
  let context: WorkerContext;

  beforeAll(async () => {
    harness = await createHarness();
    user = await harness.createUser({ role: "MEMBER" });
    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: user.headers,
      payload: { title: "Integrity", profile: "STANDARD" },
    });
    researchCase = created.json<CaseDetail>();
    context = {
      config: harness.config,
      dbHandle: harness.dbHandle,
      db: harness.dbHandle.db,
      storage: harness.storage,
      log() {},
    };
  });
  afterAll(async () => harness.close());

  async function begin(
    bytes: Uint8Array,
    declaredSha256: string,
    mimeType = "application/json",
  ) {
    const started = await harness.app.inject({
      method: "POST",
      url: "/v1/uploads",
      headers: user.headers,
      payload: {
        caseId: researchCase.id,
        filename:
          mimeType === "application/json" ? "sample.json" : "sample.png",
        mimeType,
        sizeBytes: bytes.byteLength,
        sha256: declaredSha256,
        artifactKind: "HAR",
        visibility: "INTERNAL",
      },
    });
    const instructions = started.json<UploadInstructions>();
    harness.storage.objects.set(instructions.objectKey, bytes);
    const completed = await harness.app.inject({
      method: "POST",
      url: `/v1/uploads/${instructions.artifactId}/complete`,
      headers: user.headers,
      payload: {},
    });
    expect(completed.statusCode).toBe(200);
    return instructions;
  }

  it("publishes only after the streamed full digest matches", async () => {
    const bytes = Buffer.from('{"safe":true}');
    const instructions = await begin(
      bytes,
      createHash("sha256").update(bytes).digest("hex"),
    );
    await verifyArtifactIntegrity(context, {
      artifactId: instructions.artifactId,
      caseId: researchCase.id,
    });
    const [row] = await harness.dbHandle.db
      .select()
      .from(schema.artifacts)
      .where(eq(schema.artifacts.id, instructions.artifactId));
    expect(row?.status).toBe("STORED");
    expect(row?.previewKind).toBe("TEXT_EXCERPT");
  });

  it("rejects and deletes a same-size object with a different digest", async () => {
    const bytes = Buffer.from("wrong digest");
    const instructions = await begin(bytes, "d".repeat(64));
    await verifyArtifactIntegrity(context, {
      artifactId: instructions.artifactId,
      caseId: researchCase.id,
    });
    const [row] = await harness.dbHandle.db
      .select()
      .from(schema.artifacts)
      .where(eq(schema.artifacts.id, instructions.artifactId));
    expect(row?.status).toBe("REJECTED");
    expect(harness.storage.objects.has(instructions.objectKey)).toBe(false);
  });

  it("never invokes a native decoder for image evidence in the general worker", async () => {
    const bytes = Buffer.from("not-even-a-real-png");
    const instructions = await begin(
      bytes,
      createHash("sha256").update(bytes).digest("hex"),
      "image/png",
    );
    await verifyArtifactIntegrity(context, {
      artifactId: instructions.artifactId,
      caseId: researchCase.id,
    });
    const [row] = await harness.dbHandle.db
      .select()
      .from(schema.artifacts)
      .where(eq(schema.artifacts.id, instructions.artifactId));
    expect(row?.status).toBe("STORED");
    expect(row?.previewKind).toBe("NONE");
    expect(row?.previewObjectKey).toBeNull();
  });
});
