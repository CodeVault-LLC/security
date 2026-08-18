import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { schema } from "@codevault/db";

import { hashToken } from "./auth/tokens.js";
import {
  createHarness,
  type TestHarness,
  type TestUser,
} from "./testing/harness.js";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration("organization and personal settings APIs", () => {
  let harness: TestHarness;
  let admin: TestUser;
  let member: TestUser;
  let viewer: TestUser;

  beforeAll(async () => {
    harness = await createHarness();
    [admin, member, viewer] = await Promise.all([
      harness.createUser({ role: "ADMIN" }),
      harness.createUser({ role: "MEMBER" }),
      harness.createUser({ role: "VIEWER" }),
    ]);
  });

  afterAll(async () => {
    await harness.close();
  });

  it.each([
    "/v1/organization/users",
    "/v1/organization/settings",
    "/v1/organization/security",
  ])("lets every active member read %s", async (url) => {
    for (const user of [admin, member, viewer]) {
      expect(
        (
          await harness.app.inject({
            method: "GET",
            url,
            headers: user.headers,
          })
        ).statusCode,
      ).toBe(200);
    }
  });

  it("allows only a recent-MFA administrator to update policy", async () => {
    const denied = await harness.app.inject({
      method: "PATCH",
      url: "/v1/organization/security",
      headers: member.headers,
      payload: { recentMfaMinutes: 12 },
    });
    expect(denied.statusCode).toBe(403);

    await harness.dbHandle.db
      .update(schema.sessions)
      .set({ mfaVerifiedAt: new Date(Date.now() - 60 * 60_000).toISOString() })
      .where(eq(schema.sessions.tokenHash, hashToken(admin.token)));
    const stale = await harness.app.inject({
      method: "PATCH",
      url: "/v1/organization/security",
      headers: admin.headers,
      payload: { recentMfaMinutes: 12 },
    });
    expect(stale.statusCode).toBe(403);
    expect(stale.json<{ error: { category: string } }>().error.category).toBe(
      "MFA_REAUTH_REQUIRED",
    );

    await harness.dbHandle.db
      .update(schema.sessions)
      .set({ mfaVerifiedAt: new Date().toISOString() })
      .where(eq(schema.sessions.tokenHash, hashToken(admin.token)));
    const allowed = await harness.app.inject({
      method: "PATCH",
      url: "/v1/organization/security",
      headers: admin.headers,
      payload: { recentMfaMinutes: 12 },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json<{ recentMfaMinutes: number }>().recentMfaMinutes).toBe(
      12,
    );
  });

  it("limits profile changes to the current user's display name", async () => {
    const response = await harness.app.inject({
      method: "PATCH",
      url: "/v1/settings/profile",
      headers: member.headers,
      payload: { displayName: "Updated Member" },
    });
    expect(response.statusCode).toBe(200);
    const [adminRow] = await harness.dbHandle.db
      .select({ name: schema.users.displayName })
      .from(schema.users)
      .where(eq(schema.users.id, admin.id));
    expect(adminRow?.name).not.toBe("Updated Member");
  });
});
