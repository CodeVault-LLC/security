import { createHash, randomUUID } from "node:crypto";
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
const sanitizedBytes = Buffer.from("RIFF\u0004\u0000\u0000\u0000WEBP");
const sanitizedDigest = createHash("sha256")
  .update(sanitizedBytes)
  .digest("hex");

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

  it("serves a member's current sanitized avatar by stable user id", async () => {
    const avatarId = randomUUID();
    const objectKey = `derivatives/avatars/${avatarId}.webp`;
    await harness.dbHandle.db.insert(schema.avatarImages).values({
      id: avatarId,
      organizationId: member.organizationId,
      target: "USER",
      targetUserId: member.id,
      status: "READY",
      originalFilename: "avatar.png",
      declaredSizeBytes: bytes.byteLength,
      declaredSha256: digest,
      observedSizeBytes: bytes.byteLength,
      observedSha256: digest,
      quarantineObjectKey: `quarantine/avatars/${avatarId}`,
      sanitizedObjectKey: objectKey,
      sanitizedSha256: sanitizedDigest,
      width: 64,
      height: 64,
      requestedBy: member.id,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      readyAt: new Date().toISOString(),
    });
    harness.storage.objects.set(objectKey, sanitizedBytes);

    const response = await harness.app.inject({
      method: "GET",
      url: `/v1/user-avatars/${member.id}/content`,
      headers: admin.headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/webp");
    expect(response.rawPayload).toEqual(sanitizedBytes);
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
