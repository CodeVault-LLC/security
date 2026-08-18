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
  type TestUser,
} from "./testing/harness.js";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration("MFA session issuance", () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  async function start(user: TestUser): Promise<string> {
    await clearLoginAttempts(harness);
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/login/start",
      payload: { email: user.email, password: TEST_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    return response.json<{ challengeToken: string }>().challengeToken;
  }

  it("stores no session after password-only success", async () => {
    const user = await harness.createUser();
    const before = await countSessions(user.id);
    await start(user);
    expect(await countSessions(user.id)).toBe(before);
  });

  it("creates a policy-bounded session only after TOTP", async () => {
    const user = await harness.createUser();
    const challengeToken = await start(user);
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/login/complete",
      payload: {
        challengeToken,
        totp: generateTotpAt(user.totpSecret, Date.now()),
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ token: string; expiresAt: string }>();
    expect(body.token).not.toContain(".");
    expect(Date.parse(body.expiresAt) - Date.now()).toBeLessThanOrEqual(
      12 * 60 * 60_000,
    );
  });

  it("accepts only one concurrent use of a TOTP counter", async () => {
    const user = await harness.createUser();
    const [firstChallenge, secondChallenge] = await Promise.all([
      start(user),
      start(user),
    ]);
    const totp = generateTotpAt(user.totpSecret, Date.now());
    const responses = await Promise.all([
      harness.app.inject({
        method: "POST",
        url: "/v1/auth/login/complete",
        payload: { challengeToken: firstChallenge, totp },
      }),
      harness.app.inject({
        method: "POST",
        url: "/v1/auth/login/complete",
        payload: { challengeToken: secondChallenge, totp },
      }),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 400,
    ]);
  });

  it("rejects completion after the user is disabled", async () => {
    const user = await harness.createUser();
    const challengeToken = await start(user);
    await harness.dbHandle.db
      .update(schema.users)
      .set({ disabled: true })
      .where(eq(schema.users.id, user.id));
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/login/complete",
      payload: {
        challengeToken,
        totp: generateTotpAt(user.totpSecret, Date.now()),
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("consumes a challenge after five failed codes", async () => {
    const user = await harness.createUser();
    const challengeToken = await start(user);
    const valid = generateTotpAt(user.totpSecret, Date.now());
    const invalid = `${(Number(valid[0]) + 1) % 10}${valid.slice(1)}`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await harness.app.inject({
        method: "POST",
        url: "/v1/auth/login/complete",
        payload: { challengeToken, totp: invalid },
      });
      expect(response.statusCode).toBe(400);
    }
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/login/complete",
      payload: { challengeToken, totp: valid },
    });
    expect(response.statusCode).toBe(400);
  });

  it("uses recovery only for re-enrollment before issuing a new session", async () => {
    const user = await harness.createUser();
    const started = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/recovery/start",
      payload: {
        email: user.email,
        password: user.password,
        recoveryCode: user.recoveryCodes[0],
      },
    });
    expect(started.statusCode).toBe(200);
    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: "/v1/auth/me",
          headers: user.headers,
        })
      ).statusCode,
    ).toBe(401);
    const enrollment = started.json<{
      enrollmentToken: string;
      manualSecret: string;
    }>();
    const completed = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/recovery/confirm",
      payload: {
        enrollmentToken: enrollment.enrollmentToken,
        totp: generateTotpAt(enrollment.manualSecret, Date.now()),
      },
    });
    expect(completed.statusCode).toBe(200);
    expect(
      completed.json<{ recoveryCodes: string[] }>().recoveryCodes,
    ).toHaveLength(10);

    const replay = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/recovery/start",
      payload: {
        email: user.email,
        password: user.password,
        recoveryCode: user.recoveryCodes[0],
      },
    });
    expect(replay.statusCode).toBe(400);
  });

  it("requires recent MFA for organization authority mutations", async () => {
    const admin = await harness.createUser({ role: "ADMIN" });
    const target = await harness.createUser();
    await harness.dbHandle.db
      .update(schema.sessions)
      .set({ mfaVerifiedAt: new Date(Date.now() - 60 * 60_000).toISOString() })
      .where(eq(schema.sessions.tokenHash, hashToken(admin.token)));
    const response = await harness.app.inject({
      method: "PATCH",
      url: `/v1/users/${target.id}`,
      headers: admin.headers,
      payload: { displayName: "Must not change" },
    });
    expect(response.statusCode).toBe(403);
    expect(
      response.json<{ error: { category: string } }>().error.category,
    ).toBe("MFA_REAUTH_REQUIRED");
  });

  async function countSessions(userId: string): Promise<number> {
    const [row] = await harness.dbHandle.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, userId));
    return row?.count ?? 0;
  }
});
