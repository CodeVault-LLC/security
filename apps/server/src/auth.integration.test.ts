import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateOpaqueToken } from "@codevault/core/crypto";
import { schema } from "@codevault/db";

import { hashToken } from "./auth/tokens.js";
import {
  clearLoginAttempts,
  createHarness,
  TEST_PASSWORD,
  type TestHarness,
} from "./testing/harness.js";

/**
 * Authentication.
 *
 * The properties here are the ones that decide whether CodeVault is an
 * invitation-only system or merely describes itself as one.
 */

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;

describeIntegration("authentication", () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("accepts valid credentials and returns an opaque token", async () => {
    const user = await harness.createUser();

    await clearLoginAttempts(harness);

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: user.email, password: TEST_PASSWORD },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json<{ token: string; user: { email: string } }>();

    expect(body.user.email).toBe(user.email);
    expect(body.token.length).toBeGreaterThanOrEqual(32);
    expect(body.token).not.toContain(".");
  });

  it("stores only a hash of the session token", async () => {
    const user = await harness.createUser();

    await clearLoginAttempts(harness);

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: user.email, password: TEST_PASSWORD },
    });

    const { token } = response.json<{ token: string }>();

    const stored = await harness.dbHandle.db
      .select({ tokenHash: schema.sessions.tokenHash })
      .from(schema.sessions)
      .where(eq(schema.sessions.tokenHash, hashToken(token)))
      .limit(1);

    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).not.toBe(token);
  });

  it("rejects a wrong password", async () => {
    const user = await harness.createUser();

    await clearLoginAttempts(harness);

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: user.email, password: "not-the-right-password" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("rejects an unknown address with the same message as a wrong password", async () => {
    await clearLoginAttempts(harness);

    const unknown = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "nobody@codevault.test",
        password: "not-the-right-password",
      },
    });

    const user = await harness.createUser();

    await clearLoginAttempts(harness);

    const wrongPassword = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: user.email, password: "not-the-right-password" },
    });

    expect(unknown.statusCode).toBe(401);
    expect(unknown.json<{ error: { message: string } }>().error.message).toBe(
      wrongPassword.json<{ error: { message: string } }>().error.message,
    );
  });

  it("rejects a disabled account holding correct credentials", async () => {
    const user = await harness.createUser({ disabled: true });

    await clearLoginAttempts(harness);

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: user.email, password: TEST_PASSWORD },
    });

    expect(response.statusCode).toBe(401);
  });

  it("rejects a revoked session immediately", async () => {
    const user = await harness.createUser();

    const before = await harness.app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: user.headers,
    });

    expect(before.statusCode).toBe(200);

    await harness.dbHandle.db
      .update(schema.sessions)
      .set({ revokedAt: sql`now()` })
      .where(eq(schema.sessions.tokenHash, hashToken(user.token)));

    const after = await harness.app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: user.headers,
    });

    expect(after.statusCode).toBe(401);
  });

  it("rejects an expired session", async () => {
    const user = await harness.createUser();
    const expired = await harness.issueSession(
      user.id,
      new Date(Date.now() - 1_000),
    );

    const response = await harness.app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${expired}` },
    });

    expect(response.statusCode).toBe(401);
  });

  it("rejects a session whose user was disabled after signing in", async () => {
    const user = await harness.createUser();

    await harness.dbHandle.db
      .update(schema.users)
      .set({ disabled: true })
      .where(eq(schema.users.id, user.id));

    const response = await harness.app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: user.headers,
    });

    expect(response.statusCode).toBe(401);
  });

  it("rejects a request with no credentials", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/v1/cases",
    });

    expect(response.statusCode).toBe(401);
  });

  it("rejects a malformed authorization header", async () => {
    for (const header of ["Bearer", "Basic abcdef", "Bearer short", "nonsense"]) {
      const response = await harness.app.inject({
        method: "GET",
        url: "/v1/cases",
        headers: { authorization: header },
      });

      expect(response.statusCode).toBe(401);
    }
  });
});

describeIntegration("registration", () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("exposes no registration route", async () => {
    const paths = [
      "/v1/auth/register",
      "/v1/register",
      "/v1/users/register",
      "/v1/signup",
      "/v1/auth/signup",
    ];

    for (const path of paths) {
      const response = await harness.app.inject({
        method: "POST",
        url: path,
        payload: { email: "intruder@example.com", password: "hunter2hunter2" },
      });

      // 401 or 404 — either way, no account is created.
      expect([401, 404]).toContain(response.statusCode);
    }
  });

  it("does not let POST /v1/users create an account", async () => {
    const admin = await harness.createUser({ role: "ADMIN" });

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/users",
      headers: admin.headers,
      payload: { email: "intruder@example.com", role: "ADMIN" },
    });

    expect(response.statusCode).toBe(404);
  });
});

describeIntegration("invitations", () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  async function createInvite(
    adminHeaders: Record<string, string>,
    email: string,
  ): Promise<string> {
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/invites",
      headers: adminHeaders,
      payload: { email, role: "MEMBER" },
    });

    expect(response.statusCode).toBe(200);

    return response.json<{ token: string }>().token;
  }

  it("creates an account from a valid invitation", async () => {
    const admin = await harness.createUser({ role: "ADMIN" });
    const email = `invited-${Date.now()}@codevault.test`;
    const token = await createInvite(admin.headers, email);

    const accepted = await harness.app.inject({
      method: "POST",
      url: "/v1/invites/accept",
      payload: {
        token,
        displayName: "Invited Researcher",
        password: TEST_PASSWORD,
      },
    });

    expect(accepted.statusCode).toBe(200);

    await clearLoginAttempts(harness);

    const login = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email, password: TEST_PASSWORD },
    });

    expect(login.statusCode).toBe(200);
  });

  it("refuses to reuse an invitation", async () => {
    const admin = await harness.createUser({ role: "ADMIN" });
    const email = `reuse-${Date.now()}@codevault.test`;
    const token = await createInvite(admin.headers, email);

    const first = await harness.app.inject({
      method: "POST",
      url: "/v1/invites/accept",
      payload: { token, displayName: "First", password: TEST_PASSWORD },
    });

    expect(first.statusCode).toBe(200);

    const second = await harness.app.inject({
      method: "POST",
      url: "/v1/invites/accept",
      payload: { token, displayName: "Second", password: TEST_PASSWORD },
    });

    expect(second.statusCode).toBe(400);
  });

  it("refuses an expired invitation", async () => {
    const admin = await harness.createUser({ role: "ADMIN" });
    const email = `expired-${Date.now()}@codevault.test`;
    const token = await createInvite(admin.headers, email);

    await harness.dbHandle.db
      .update(schema.invites)
      .set({ expiresAt: new Date(Date.now() - 1_000).toISOString() })
      .where(eq(schema.invites.tokenHash, hashToken(token)));

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/invites/accept",
      payload: { token, displayName: "Too late", password: TEST_PASSWORD },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { message: string } }>().error.message).toContain(
      "expired",
    );
  });

  it("refuses a revoked invitation", async () => {
    const admin = await harness.createUser({ role: "ADMIN" });
    const email = `revoked-${Date.now()}@codevault.test`;

    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/invites",
      headers: admin.headers,
      payload: { email, role: "MEMBER" },
    });

    const { token, invite } = created.json<{
      token: string;
      invite: { id: string };
    }>();

    await harness.app.inject({
      method: "DELETE",
      url: `/v1/invites/${invite.id}`,
      headers: admin.headers,
    });

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/invites/accept",
      payload: { token, displayName: "Revoked", password: TEST_PASSWORD },
    });

    expect(response.statusCode).toBe(400);
  });

  it("refuses an invented token", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/invites/accept",
      payload: {
        token: generateOpaqueToken(),
        displayName: "Nobody",
        password: TEST_PASSWORD,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("refuses a password below the minimum length", async () => {
    const admin = await harness.createUser({ role: "ADMIN" });
    const email = `weak-${Date.now()}@codevault.test`;
    const token = await createInvite(admin.headers, email);

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/invites/accept",
      payload: { token, displayName: "Weak", password: "short" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("stores only a hash of the invitation token", async () => {
    const admin = await harness.createUser({ role: "ADMIN" });
    const email = `hashed-${Date.now()}@codevault.test`;
    const token = await createInvite(admin.headers, email);

    const rows = await harness.dbHandle.db
      .select({ tokenHash: schema.invites.tokenHash })
      .from(schema.invites)
      .where(eq(schema.invites.tokenHash, hashToken(token)))
      .limit(1);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toBe(token);
  });

  it("lets only an administrator create an invitation", async () => {
    const member = await harness.createUser({ role: "MEMBER" });

    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/invites",
      headers: member.headers,
      payload: { email: "someone@codevault.test", role: "MEMBER" },
    });

    expect(response.statusCode).toBe(403);
  });
});
