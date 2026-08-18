import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "../../server/src/testing/harness.js";
import { schema } from "@codevault/db";
import { runOneMediaJob } from "./claim-job.js";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4z8AAAAMBAQCc479ZAAAAAElFTkSuQmCC",
  "base64",
);

describeIntegration("least-privilege avatar media workflow", () => {
  let harness: TestHarness;
  let member: TestUser;
  beforeAll(async () => {
    harness = await createHarness();
    member = await harness.createUser({ role: "MEMBER" });
  });
  afterAll(async () => harness.close());

  it("publishes only a fresh sanitized derivative and deletes quarantine", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/avatar-uploads",
      headers: member.headers,
      payload: {
        target: "USER",
        originalFilename: "avatar.png",
        declaredSizeBytes: PNG.byteLength,
        declaredSha256: createHash("sha256").update(PNG).digest("hex"),
      },
    });
    const upload = created.json<{ id: string }>();
    const quarantined = await harness.app.inject({
      method: "PUT",
      url: `/v1/avatar-uploads/${upload.id}/content`,
      headers: {
        ...member.headers,
        "content-type": "application/octet-stream",
        "content-length": String(PNG.byteLength),
      },
      payload: PNG,
    });
    expect(quarantined.statusCode).toBe(200);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await runOneMediaJob(harness.dbHandle.db, harness.storage);
      const [row] = await harness.dbHandle.db
        .select({ status: schema.avatarImages.status })
        .from(schema.avatarImages)
        .where(eq(schema.avatarImages.id, upload.id));
      if (row?.status === "READY") break;
    }

    expect(harness.storage.objects.has(`quarantine/avatars/${upload.id}`)).toBe(
      false,
    );
    const content = await harness.app.inject({
      method: "GET",
      url: `/v1/avatars/${upload.id}/content`,
      headers: member.headers,
    });
    expect(content.statusCode).toBe(200);
    expect(content.headers["content-type"]).toContain("image/webp");
    expect(content.rawPayload.toString("ascii", 8, 12)).toBe("WEBP");

    const [ready] = await harness.dbHandle.db
      .select({ objectKey: schema.avatarImages.sanitizedObjectKey })
      .from(schema.avatarImages)
      .where(eq(schema.avatarImages.id, upload.id));
    harness.storage.objects.set(
      ready!.objectKey!,
      Buffer.from("RIFF0000WEBPtampered"),
    );
    const tampered = await harness.app.inject({
      method: "GET",
      url: `/v1/avatars/${upload.id}/content`,
      headers: member.headers,
    });
    expect(tampered.statusCode).toBe(500);
  });

  it("gives the media runtime functions but no application-table reads", async () => {
    const client = await harness.dbHandle.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE codevault_media_runtime");
      await expect(
        client.query("SELECT id FROM public.users LIMIT 1"),
      ).rejects.toMatchObject({
        code: "42501",
      });
      await client.query("ROLLBACK");

      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE codevault_media_runtime");
      const allowed = await client.query(
        "SELECT * FROM public.claim_media_job($1, $2)",
        ["least-privilege-test", "x".repeat(43)],
      );
      expect(Array.isArray(allowed.rows)).toBe(true);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
