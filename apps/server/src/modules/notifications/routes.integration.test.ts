import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { schema } from "@codevault/db";

import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "../../testing/harness.js";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration("security notification inbox", () => {
  let harness: TestHarness;
  let user: TestUser;
  let other: TestUser;
  let notificationId: string;

  beforeAll(async () => {
    harness = await createHarness();
    user = await harness.createUser({ role: "MEMBER" });
    other = await harness.createUser({ role: "MEMBER" });
    const inserted = await harness.dbHandle.db
      .insert(schema.securityNotifications)
      .values({
        organizationId: user.organizationId,
        userId: user.id,
        eventType: "RECOVERY_CODE_USED",
        details: { recoveryCodesRemaining: 4 },
      })
      .returning({ id: schema.securityNotifications.id });
    notificationId = inserted[0]!.id;
  });

  afterAll(async () => harness.close());

  it("lists only the current user's durable security events", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/v1/notifications",
      headers: user.headers,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      unreadCount: 1,
      items: [
        {
          id: notificationId,
          eventType: "RECOVERY_CODE_USED",
          details: { recoveryCodesRemaining: 4 },
          readAt: null,
        },
      ],
    });

    const hidden = await harness.app.inject({
      method: "POST",
      url: `/v1/notifications/${notificationId}/read`,
      headers: other.headers,
    });
    expect(hidden.statusCode).toBe(404);
  });

  it("marks individual and all remaining notifications as read", async () => {
    const read = await harness.app.inject({
      method: "POST",
      url: `/v1/notifications/${notificationId}/read`,
      headers: user.headers,
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toMatchObject({ id: notificationId });
    expect(read.json().readAt).not.toBeNull();

    const all = await harness.app.inject({
      method: "POST",
      url: "/v1/notifications/read-all",
      headers: user.headers,
    });
    expect(all.statusCode, all.body).toBe(200);
    expect(all.json()).toEqual({ updatedCount: 0 });

    const stored = await harness.dbHandle.db
      .select({ readAt: schema.securityNotifications.readAt })
      .from(schema.securityNotifications)
      .where(eq(schema.securityNotifications.id, notificationId));
    expect(stored[0]?.readAt).not.toBeNull();
  });

  it("hides case-derived notifications as soon as read access is revoked", async () => {
    const owner = await harness.createUser({ role: "MEMBER" });
    const revoked = await harness.createUser({ role: "MEMBER" });
    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: owner.headers,
      payload: { title: "Hidden notification case", profile: "STANDARD" },
    });
    const caseId = created.json<{ id: string }>().id;

    await harness.app.inject({
      method: "POST",
      url: `/v1/cases/${caseId}/members`,
      headers: owner.headers,
      payload: { userId: revoked.id, capabilities: ["READ"] },
    });
    const [notification] = await harness.dbHandle.db
      .insert(schema.securityNotifications)
      .values({
        organizationId: revoked.organizationId,
        userId: revoked.id,
        caseId,
        eventType: "VENDOR_REPLY_RECEIVED",
        details: { caseId, caseRef: "CASE-HIDDEN" },
      })
      .returning({ id: schema.securityNotifications.id });

    await harness.app.inject({
      method: "DELETE",
      url: `/v1/cases/${caseId}/members/${revoked.id}`,
      headers: owner.headers,
    });

    const inbox = await harness.app.inject({
      method: "GET",
      url: "/v1/notifications",
      headers: revoked.headers,
    });
    expect(inbox.statusCode, inbox.body).toBe(200);
    expect(inbox.json()).toMatchObject({ unreadCount: 0, items: [] });

    const direct = await harness.app.inject({
      method: "POST",
      url: `/v1/notifications/${notification!.id}/read`,
      headers: revoked.headers,
    });
    expect(direct.statusCode).toBe(404);
  });
});
