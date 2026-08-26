import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { schema } from "@codevault/db";

import { hashToken } from "./auth/tokens.js";
import { generateTotpAt } from "./auth/totp.js";
import {
  clearLoginAttempts,
  createHarness,
  TEST_PASSWORD,
  type TestHarness,
} from "./testing/harness.js";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration("authentication boundary", () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("password success returns only a hashed-at-rest MFA challenge", async () => {
    const user = await harness.createUser();
    await clearLoginAttempts(harness);
    const before = await sessionCount(user.id);
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/login/start",
      payload: { email: user.email, password: TEST_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      challengeToken: string;
      challenge: string;
    }>();
    expect(body.challenge).toBe("MFA_REQUIRED");
    expect(await sessionCount(user.id)).toBe(before);
    const stored = await harness.dbHandle.db
      .select({ tokenHash: schema.mfaChallenges.tokenHash })
      .from(schema.mfaChallenges)
      .where(
        eq(schema.mfaChallenges.tokenHash, hashToken(body.challengeToken)),
      );
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).not.toBe(body.challengeToken);
  });

  it("issues a password-authenticated session when organization MFA is disabled", async () => {
    const user = await harness.createUser();
    await harness.dbHandle.db
      .update(schema.organizationSecurityPolicies)
      .set({ mfaRequired: false })
      .where(
        eq(
          schema.organizationSecurityPolicies.organizationId,
          user.organizationId,
        ),
      );
    await clearLoginAttempts(harness);
    const before = await sessionCount(user.id);

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/login/start",
      payload: {
        email: user.email,
        password: TEST_PASSWORD,
        rememberMe: false,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(
      response.json<{ token?: string; challenge?: string }>(),
    ).toMatchObject({ token: expect.any(String) });
    expect(response.json<{ challenge?: string }>().challenge).toBeUndefined();
    expect(await sessionCount(user.id)).toBe(before + 1);

    await harness.dbHandle.db
      .update(schema.organizationSecurityPolicies)
      .set({ mfaRequired: true })
      .where(
        eq(
          schema.organizationSecurityPolicies.organizationId,
          user.organizationId,
        ),
      );
  });

  it("uses the same response for unknown users and wrong passwords", async () => {
    await clearLoginAttempts(harness);
    const unknown = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/login/start",
      payload: { email: "nobody@codevault.test", password: TEST_PASSWORD },
    });
    const user = await harness.createUser();
    await clearLoginAttempts(harness);
    const wrong = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/login/start",
      payload: { email: user.email, password: `${TEST_PASSWORD}-wrong` },
    });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json<{ error: { message: string } }>().error.message).toBe(
      wrong.json<{ error: { message: string } }>().error.message,
    );
  });

  it("invalidates revoked, expired, and disabled-user sessions", async () => {
    const revokedUser = await harness.createUser();
    await harness.dbHandle.db
      .update(schema.sessions)
      .set({ revokedAt: sql`now()` })
      .where(eq(schema.sessions.tokenHash, hashToken(revokedUser.token)));
    await expectExpiredSession(revokedUser.token);

    const expiredUser = await harness.createUser();
    const expired = await harness.issueSession(
      expiredUser.id,
      new Date(Date.now() - 1_000),
    );
    await expectExpiredSession(expired);

    const disabledUser = await harness.createUser();
    await harness.dbHandle.db
      .update(schema.users)
      .set({ disabled: true })
      .where(eq(schema.users.id, disabledUser.id));
    await expectExpiredSession(disabledUser.token);
  });

  it("has no public registration or legacy invite-accept route", async () => {
    for (const url of [
      "/v1/auth/register",
      "/v1/register",
      "/v1/signup",
      "/v1/invites/accept",
    ]) {
      const response = await harness.app.inject({
        method: "POST",
        url,
        payload: { email: "intruder@example.test", password: TEST_PASSWORD },
      });
      expect([401, 404]).toContain(response.statusCode);
    }
  });

  it("lets a password-authenticated migrated account enroll MFA once", async () => {
    const user = await harness.createUser();
    await harness.dbHandle.db
      .delete(schema.mfaRecoveryCodes)
      .where(eq(schema.mfaRecoveryCodes.userId, user.id));
    await harness.dbHandle.db
      .delete(schema.totpCredentials)
      .where(eq(schema.totpCredentials.userId, user.id));
    await clearLoginAttempts(harness);

    const login = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/login/start",
      payload: { email: user.email, password: TEST_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    const challenge = login.json<{
      challenge: string;
      challengeToken: string;
    }>();
    expect(challenge.challenge).toBe("ENROLLMENT_REQUIRED");

    const start = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/enrollment/start",
      payload: { challengeToken: challenge.challengeToken },
    });
    expect(start.statusCode).toBe(200);
    const enrollment = start.json<{
      enrollmentToken: string;
      manualSecret: string;
    }>();
    const confirm = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/enrollment/confirm",
      payload: {
        enrollmentToken: enrollment.enrollmentToken,
        totp: generateTotpAt(enrollment.manualSecret, Date.now()),
      },
    });
    expect(confirm.statusCode).toBe(200);
    expect(
      confirm.json<{ recoveryCodes: string[] }>().recoveryCodes,
    ).toHaveLength(10);
    const credentials = await harness.dbHandle.db
      .select({ id: schema.totpCredentials.id })
      .from(schema.totpCredentials)
      .where(eq(schema.totpCredentials.userId, user.id));
    expect(credentials).toHaveLength(1);

    const replay = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/enrollment/confirm",
      payload: {
        enrollmentToken: enrollment.enrollmentToken,
        totp: generateTotpAt(enrollment.manualSecret, Date.now()),
      },
    });
    expect(replay.statusCode).toBe(400);
  });

  async function me(token: string) {
    return harness.app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
  }

  async function expectExpiredSession(token: string): Promise<void> {
    const response = await me(token);

    expect(response.statusCode).toBe(401);
    expect(
      response.json<{ error: { category: string } }>().error.category,
    ).toBe("SESSION_EXPIRED");
  }

  async function sessionCount(userId: string): Promise<number> {
    const [row] = await harness.dbHandle.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, userId));
    return row?.count ?? 0;
  }
});
