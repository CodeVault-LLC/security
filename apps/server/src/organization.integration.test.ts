import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { CreateMcpAccessTokenResponse } from "@codevault/contracts";
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

    const disabled = await harness.app.inject({
      method: "PATCH",
      url: "/v1/organization/security",
      headers: admin.headers,
      payload: { mfaRequired: false },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json<{ mfaRequired: boolean }>().mfaRequired).toBe(false);

    await harness.dbHandle.db
      .update(schema.sessions)
      .set({ mfaVerifiedAt: new Date(0).toISOString() })
      .where(eq(schema.sessions.tokenHash, hashToken(admin.token)));
    const withoutMfaGate = await harness.app.inject({
      method: "PATCH",
      url: "/v1/organization/security",
      headers: admin.headers,
      payload: { mfaRequired: true },
    });
    expect(withoutMfaGate.statusCode).toBe(200);
    expect(withoutMfaGate.json<{ mfaRequired: boolean }>().mfaRequired).toBe(
      true,
    );
    await harness.dbHandle.db
      .update(schema.sessions)
      .set({ mfaVerifiedAt: new Date().toISOString() })
      .where(eq(schema.sessions.tokenHash, hashToken(admin.token)));
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

  it("locks personal HTML mail preferences when organization policy blocks them", async () => {
    await harness.app.inject({
      method: "PATCH",
      url: "/v1/organization/security",
      headers: admin.headers,
      payload: { mailHtmlRenderingEnabled: true },
    });
    const publish = vi.spyOn(harness.app.events, "publish");
    const initial = await harness.app.inject({
      method: "PATCH",
      url: "/v1/settings/mail",
      headers: member.headers,
      payload: { automaticHtml: false },
    });
    expect(initial.statusCode, initial.body).toBe(200);
    expect(initial.json()).toMatchObject({
      automaticHtml: false,
      organizationAllowsHtml: true,
    });

    const blocked = await harness.app.inject({
      method: "PATCH",
      url: "/v1/organization/security",
      headers: admin.headers,
      payload: { mailHtmlRenderingEnabled: false },
    });
    expect(blocked.statusCode, blocked.body).toBe(200);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "entity.changed",
        entityType: "organization_security_policy",
        detail: { mailHtmlRenderingEnabled: false },
      }),
    );

    const denied = await harness.app.inject({
      method: "PATCH",
      url: "/v1/settings/mail",
      headers: member.headers,
      payload: { automaticHtml: true },
    });
    expect(denied.statusCode).toBe(403);

    const preference = await harness.app.inject({
      method: "GET",
      url: "/v1/settings/mail",
      headers: member.headers,
    });
    expect(preference.statusCode, preference.body).toBe(200);
    expect(preference.json()).toMatchObject({
      automaticHtml: false,
      organizationAllowsHtml: false,
    });

    await harness.app.inject({
      method: "PATCH",
      url: "/v1/organization/security",
      headers: admin.headers,
      payload: { mailHtmlRenderingEnabled: true },
    });
    publish.mockRestore();
  });

  it("reports the current user's actual account protection", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/v1/settings/security",
      headers: member.headers,
    });

    expect(response.statusCode).toBe(200);
    expect(
      response.json<{
        totp: { status: string; enrolledAt: string | null };
        recoveryCodes: { remaining: number };
      }>(),
    ).toMatchObject({
      totp: { status: "ACTIVE" },
      recoveryCodes: { remaining: member.recoveryCodes.length },
    });
  });

  it("issues one user-specific MCP grant and applies organization policy on every request", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/settings/mcp-access",
      headers: member.headers,
      payload: { name: "Research workstation" },
    });
    expect(created.statusCode).toBe(200);
    const access = created.json<CreateMcpAccessTokenResponse>();
    expect(access.token).toMatch(/^cv_mcp_/u);

    const mcpHeaders = { authorization: `Bearer ${access.token}` };
    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: "/v1/auth/me",
          headers: mcpHeaders,
        })
      ).statusCode,
    ).toBe(200);

    const cannotMintAnother = await harness.app.inject({
      method: "POST",
      url: "/v1/settings/mcp-access",
      headers: mcpHeaders,
      payload: { name: "Nested connection" },
    });
    expect(cannotMintAnother.statusCode).toBe(403);
    expect(
      cannotMintAnother.json<{ error: { category: string } }>().error.category,
    ).toBe("PERMISSION_DENIED");

    await harness.dbHandle.db
      .update(schema.organizationSecurityPolicies)
      .set({ mcpEnabled: false })
      .where(
        eq(
          schema.organizationSecurityPolicies.organizationId,
          member.organizationId,
        ),
      );
    const blocked = await harness.app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: mcpHeaders,
    });
    expect(blocked.statusCode).toBe(401);
    expect(
      blocked.json<{ error: { message: string } }>().error.message,
    ).toContain("MCP access is disabled");

    await harness.dbHandle.db
      .update(schema.organizationSecurityPolicies)
      .set({ mcpEnabled: true })
      .where(
        eq(
          schema.organizationSecurityPolicies.organizationId,
          member.organizationId,
        ),
      );
    const revoked = await harness.app.inject({
      method: "DELETE",
      url: `/v1/settings/mcp-access/${access.access.id}`,
      headers: member.headers,
    });
    expect(revoked.statusCode).toBe(200);
    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: "/v1/auth/me",
          headers: mcpHeaders,
        })
      ).statusCode,
    ).toBe(401);
  });

  it("revokes a user's MCP grants when their password changes", async () => {
    const user = await harness.createUser({ role: "MEMBER" });
    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/settings/mcp-access",
      headers: user.headers,
      payload: { name: "Password rotation test" },
    });
    expect(created.statusCode).toBe(200);
    const access = created.json<CreateMcpAccessTokenResponse>();

    const changed = await harness.app.inject({
      method: "POST",
      url: "/v1/settings/password",
      remoteAddress: "192.0.2.50",
      headers: user.headers,
      payload: {
        currentPassword: user.password,
        newPassword: "new-correct-horse-battery-staple",
      },
    });
    expect(changed.statusCode).toBe(200);
    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: "/v1/auth/me",
          headers: { authorization: `Bearer ${access.token}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("rate limits repeated password reauthentication guesses", async () => {
    const user = await harness.createUser();
    const statuses: number[] = [];
    const maxAttempts = Math.min(5, harness.config.auth.loginMaxAttempts);
    for (let attempt = 0; attempt < maxAttempts + 1; attempt += 1) {
      const response = await harness.app.inject({
        method: "POST",
        url: "/v1/settings/password",
        headers: user.headers,
        payload: {
          currentPassword: "deliberately-wrong-password",
          newPassword: "a-different-correct-horse-battery-staple",
        },
      });
      statuses.push(response.statusCode);
    }
    expect(statuses.slice(0, maxAttempts)).toEqual(
      Array(maxAttempts).fill(400),
    );
    expect(statuses[maxAttempts]).toBe(429);
  });

  it("uses the organization policy as the sole invitation lifetime", async () => {
    await harness.dbHandle.db
      .update(schema.organizationSecurityPolicies)
      .set({ inviteTtlHours: 1 })
      .where(
        eq(
          schema.organizationSecurityPolicies.organizationId,
          admin.organizationId,
        ),
      );
    const startedAt = Date.now();
    const response = await harness.app.inject({
      method: "POST",
      url: "/v1/organization/invitations",
      headers: admin.headers,
      payload: {
        email: `ttl-${crypto.randomUUID()}@example.test`,
        role: "MEMBER",
      },
    });
    expect(response.statusCode).toBe(200);
    const expiresAt = Date.parse(
      response.json<{ invite: { expiresAt: string } }>().invite.expiresAt,
    );
    expect(expiresAt - startedAt).toBeGreaterThan(59 * 60_000);
    expect(expiresAt - startedAt).toBeLessThanOrEqual(60 * 60_000 + 2_000);
  });
});
