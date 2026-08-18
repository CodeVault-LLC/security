import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { schema } from "@codevault/db";

import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "./testing/harness.js";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
const bytes = Buffer.from(
  "avatar bytes are independently decoded by the worker",
);
const digest = createHash("sha256").update(bytes).digest("hex");

describeIntegration("avatar upload boundary", () => {
  let harness: TestHarness;
  let admin: TestUser;
  let member: TestUser;

  beforeAll(async () => {
    harness = await createHarness();
    [admin, member] = await Promise.all([
      harness.createUser({ role: "ADMIN" }),
      harness.createUser({ role: "MEMBER" }),
    ]);
  });

  afterAll(async () => {
    await harness.close();
  });

  async function start(user: TestUser, target: "USER" | "ORGANIZATION") {
    return harness.app.inject({
      method: "POST",
      url: "/v1/avatar-uploads",
      headers: user.headers,
      payload: {
        target,
        originalFilename: "display-only.png",
        declaredSizeBytes: bytes.byteLength,
        declaredSha256: digest,
      },
    });
  }

  it("allows a member to quarantine exactly one self-avatar upload", async () => {
    const created = await start(member, "USER");
    expect(created.statusCode).toBe(201);
    const upload = created.json<{ id: string; status: string }>();

    const completed = await harness.app.inject({
      method: "PUT",
      url: `/v1/avatar-uploads/${upload.id}/content`,
      headers: {
        ...member.headers,
        "content-type": "application/octet-stream",
        "content-length": String(bytes.byteLength),
      },
      payload: bytes,
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json<{ status: string }>().status).toBe("QUARANTINED");

    const [stored] = await harness.dbHandle.db
      .select()
      .from(schema.avatarImages)
      .where(eq(schema.avatarImages.id, upload.id));
    expect(stored?.quarantineObjectKey).toMatch(
      /^quarantine\/avatars\/[0-9a-f-]+$/,
    );
    expect(stored?.quarantineObjectKey).not.toContain("display-only");
    expect(harness.storage.objects.has(stored!.quarantineObjectKey)).toBe(true);
    expect(
      await harness.dbHandle.db
        .select()
        .from(schema.mediaJobs)
        .where(
          and(
            eq(schema.mediaJobs.targetId, upload.id),
            eq(schema.mediaJobs.purpose, "AVATAR_SANITIZE"),
          ),
        ),
    ).toHaveLength(1);

    const replay = await harness.app.inject({
      method: "PUT",
      url: `/v1/avatar-uploads/${upload.id}/content`,
      headers: {
        ...member.headers,
        "content-type": "application/octet-stream",
        "content-length": String(bytes.byteLength),
      },
      payload: bytes,
    });
    expect(replay.statusCode).toBe(409);
  });

  it("denies organization-avatar changes to members", async () => {
    expect((await start(member, "ORGANIZATION")).statusCode).toBe(403);
    expect((await start(admin, "ORGANIZATION")).statusCode).toBe(201);
  });

  it("rejects an integrity mismatch without retaining raw bytes", async () => {
    const created = await start(member, "USER");
    const upload = created.json<{ id: string }>();
    const response = await harness.app.inject({
      method: "PUT",
      url: `/v1/avatar-uploads/${upload.id}/content`,
      headers: {
        ...member.headers,
        "content-type": "application/octet-stream",
        "content-length": "3",
      },
      payload: Buffer.from("bad"),
    });
    expect(response.statusCode).toBe(400);
    const [row] = await harness.dbHandle.db
      .select()
      .from(schema.avatarImages)
      .where(eq(schema.avatarImages.id, upload.id));
    expect(row?.status).toBe("REJECTED");
    expect(row?.rejectionCode).toBe("INTEGRITY_MISMATCH");
    expect(harness.storage.objects.has(row!.quarantineObjectKey)).toBe(false);
  });
});
