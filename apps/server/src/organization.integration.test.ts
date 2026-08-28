import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { CreateMcpAccessTokenResponse } from "@codevault/contracts";
import { schema } from "@codevault/db";

import { hashToken } from "./auth/tokens.js";
import { generateTotpAt } from "./auth/totp.js";
import {
  clearLoginAttempts,
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

  it("enforces phishing-resistant MFA without stranding administrators", async () => {
    const disabledAdmin = await harness.createUser({
      role: "ADMIN",
      disabled: true,
    });
    const blockedWithoutKeys = await harness.app.inject({
      method: "PATCH",
      url: "/v1/organization/security",
      headers: admin.headers,
      payload: { phishingResistantMfaRequired: true },
    });
    expect(blockedWithoutKeys.statusCode).toBe(400);

    const legacyMcp = await harness.app.inject({
      method: "POST",
      url: "/v1/settings/mcp-access",
      headers: admin.headers,
      payload: { name: "Pre-policy admin automation" },
    });
    expect(legacyMcp.statusCode, legacyMcp.body).toBe(200);
    const legacyMcpToken = legacyMcp.json<CreateMcpAccessTokenResponse>().token;

    const activeAdmins = await harness.dbHandle.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .innerJoin(
        schema.organizationMemberships,
        eq(schema.organizationMemberships.userId, schema.users.id),
      )
      .where(
        and(
          eq(schema.organizationMemberships.role, "ADMIN"),
          eq(schema.users.disabled, false),
        ),
      );
    for (const activeAdmin of activeAdmins) {
      const existingKeys = await harness.dbHandle.db
        .select({ id: schema.webauthnCredentials.id })
        .from(schema.webauthnCredentials)
        .where(
          and(
            eq(schema.webauthnCredentials.userId, activeAdmin.id),
            isNull(schema.webauthnCredentials.revokedAt),
          ),
        );
      const missing = Math.max(0, 2 - existingKeys.length);
      if (missing > 0) {
        await harness.dbHandle.db.insert(schema.webauthnCredentials).values(
          Array.from({ length: missing }, (_, index) => ({
            userId: activeAdmin.id,
            credentialId: `policy-${activeAdmin.id}-${existingKeys.length + index}`,
            publicKey: "unused-in-policy-test",
            transports: ["usb" as const],
            deviceType: "singleDevice" as const,
            backedUp: false,
            name: `Policy key ${existingKeys.length + index + 1}`,
          })),
        );
      }
    }

    const expiredInvite = await harness.app.inject({
      method: "POST",
      url: "/v1/organization/invitations",
      headers: admin.headers,
      payload: { email: "expired-admin@example.test", role: "ADMIN" },
    });
    expect(expiredInvite.statusCode, expiredInvite.body).toBe(200);
    const expiredInviteId = expiredInvite.json<{ invite: { id: string } }>()
      .invite.id;
    await harness.dbHandle.db
      .update(schema.invites)
      .set({ expiresAt: new Date(Date.now() - 60_000).toISOString() })
      .where(eq(schema.invites.id, expiredInviteId));
    const ignoredExpiredInvite = await harness.app.inject({
      method: "PATCH",
      url: "/v1/organization/security",
      headers: admin.headers,
      payload: { phishingResistantMfaRequired: true },
    });
    expect(ignoredExpiredInvite.statusCode, ignoredExpiredInvite.body).toBe(
      403,
    );

    const pendingInvite = await harness.app.inject({
      method: "POST",
      url: "/v1/organization/invitations",
      headers: admin.headers,
      payload: { email: "pending-admin@example.test", role: "ADMIN" },
    });
    expect(pendingInvite.statusCode, pendingInvite.body).toBe(200);
    const blockedByPendingInvite = await harness.app.inject({
      method: "PATCH",
      url: "/v1/organization/security",
      headers: admin.headers,
      payload: { phishingResistantMfaRequired: true },
    });
    expect(blockedByPendingInvite.statusCode).toBe(400);
    const inviteId = pendingInvite.json<{ invite: { id: string } }>().invite.id;
    const revokedInvite = await harness.app.inject({
      method: "DELETE",
      url: `/v1/organization/invitations/${inviteId}`,
      headers: admin.headers,
    });
    expect(revokedInvite.statusCode, revokedInvite.body).toBe(200);

    const blockedWithoutWebAuthn = await harness.app.inject({
      method: "PATCH",
      url: "/v1/organization/security",
      headers: admin.headers,
      payload: { phishingResistantMfaRequired: true },
    });
    expect(blockedWithoutWebAuthn.statusCode, blockedWithoutWebAuthn.body).toBe(
      403,
    );
    expect(
      blockedWithoutWebAuthn.json<{ error: { category: string } }>().error
        .category,
    ).toBe("MFA_REAUTH_REQUIRED");

    await harness.dbHandle.db
      .update(schema.sessions)
      .set({ mfaMethod: "WEBAUTHN", mfaVerifiedAt: new Date().toISOString() })
      .where(eq(schema.sessions.tokenHash, hashToken(admin.token)));
    const enabled = await harness.app.inject({
      method: "PATCH",
      url: "/v1/organization/security",
      headers: admin.headers,
      payload: { phishingResistantMfaRequired: true },
    });
    expect(enabled.statusCode, enabled.body).toBe(200);
    expect(
      enabled.json<{ phishingResistantMfaRequired: boolean }>()
        .phishingResistantMfaRequired,
    ).toBe(true);

    const revokedMcp = await harness.app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${legacyMcpToken}` },
    });
    expect(revokedMcp.statusCode).toBe(401);

    const postPolicyMcp = await harness.app.inject({
      method: "POST",
      url: "/v1/settings/mcp-access",
      headers: admin.headers,
      payload: { name: "Post-policy admin automation" },
    });
    expect(postPolicyMcp.statusCode, postPolicyMcp.body).toBe(200);
    const postPolicyAccess = postPolicyMcp.json<CreateMcpAccessTokenResponse>();
    const unrelatedPolicyChange = await harness.app.inject({
      method: "PATCH",
      url: "/v1/organization/security",
      headers: admin.headers,
      payload: { inviteTtlHours: 23 },
    });
    expect(unrelatedPolicyChange.statusCode, unrelatedPolicyChange.body).toBe(
      200,
    );
    const preservedMcp = await harness.app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${postPolicyAccess.token}` },
    });
    expect(preservedMcp.statusCode, preservedMcp.body).toBe(200);
    await harness.app.inject({
      method: "DELETE",
      url: `/v1/settings/mcp-access/${postPolicyAccess.access.id}`,
      headers: admin.headers,
    });

    await clearLoginAttempts(harness);
    const login = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/login/start",
      payload: { email: admin.email, password: admin.password },
    });
    expect(login.statusCode, login.body).toBe(200);
    const loginChallenge = login.json<{
      challengeToken: string;
      methods: string[];
    }>();
    expect(loginChallenge.methods).toEqual(["WEBAUTHN"]);
    const totpBypass = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/login/complete",
      payload: {
        challengeToken: loginChallenge.challengeToken,
        totp: generateTotpAt(admin.totpSecret, Date.now() + 30_000),
      },
    });
    expect(totpBypass.statusCode).toBe(400);

    const [beforeTotpStepUp] = await harness.dbHandle.db
      .select({ verifiedAt: schema.sessions.mfaVerifiedAt })
      .from(schema.sessions)
      .where(eq(schema.sessions.tokenHash, hashToken(admin.token)));
    await harness.dbHandle.db
      .update(schema.sessions)
      .set({
        mfaVerifiedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      })
      .where(eq(schema.sessions.tokenHash, hashToken(admin.token)));
    const totpStepUp = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/step-up",
      headers: admin.headers,
      payload: { totp: generateTotpAt(admin.totpSecret, Date.now() + 30_000) },
    });
    expect(totpStepUp.statusCode, totpStepUp.body).toBe(403);
    expect(
      totpStepUp.json<{ error: { category: string } }>().error.category,
    ).toBe("MFA_REAUTH_REQUIRED");
    const [afterTotpStepUp] = await harness.dbHandle.db
      .select({
        verifiedAt: schema.sessions.mfaVerifiedAt,
        method: schema.sessions.mfaMethod,
      })
      .from(schema.sessions)
      .where(eq(schema.sessions.tokenHash, hashToken(admin.token)));
    expect(afterTotpStepUp?.method).toBe("WEBAUTHN");
    expect(afterTotpStepUp?.verifiedAt).not.toBe(beforeTotpStepUp?.verifiedAt);
    expect(Date.parse(afterTotpStepUp!.verifiedAt)).toBeLessThan(
      Date.now() - 50 * 60_000,
    );
    await harness.dbHandle.db
      .update(schema.sessions)
      .set({ mfaVerifiedAt: new Date().toISOString() })
      .where(eq(schema.sessions.tokenHash, hashToken(admin.token)));

    const unusedRecoveryBefore = await harness.dbHandle.db
      .select({ id: schema.mfaRecoveryCodes.id })
      .from(schema.mfaRecoveryCodes)
      .where(
        and(
          eq(schema.mfaRecoveryCodes.userId, admin.id),
          isNull(schema.mfaRecoveryCodes.usedAt),
        ),
      );
    const blockedRecovery = await harness.app.inject({
      method: "POST",
      url: "/v1/auth/recovery/start",
      payload: {
        email: admin.email,
        password: admin.password,
        recoveryCode: admin.recoveryCodes[0],
      },
    });
    expect(blockedRecovery.statusCode).toBe(400);
    const unusedRecoveryAfter = await harness.dbHandle.db
      .select({ id: schema.mfaRecoveryCodes.id })
      .from(schema.mfaRecoveryCodes)
      .where(
        and(
          eq(schema.mfaRecoveryCodes.userId, admin.id),
          isNull(schema.mfaRecoveryCodes.usedAt),
        ),
      );
    expect(unusedRecoveryAfter).toHaveLength(unusedRecoveryBefore.length);

    const blockedReenable = await harness.app.inject({
      method: "PATCH",
      url: `/v1/organization/users/${disabledAdmin.id}`,
      headers: admin.headers,
      payload: { disabled: false },
    });
    expect(blockedReenable.statusCode).toBe(400);

    const promoted = await harness.createUser({ role: "MEMBER" });
    const blockedPromotion = await harness.app.inject({
      method: "PATCH",
      url: `/v1/organization/users/${promoted.id}`,
      headers: admin.headers,
      payload: { role: "ADMIN" },
    });
    expect(blockedPromotion.statusCode).toBe(400);

    const blockedInvite = await harness.app.inject({
      method: "POST",
      url: "/v1/organization/invitations",
      headers: admin.headers,
      payload: { email: "future-admin@example.test", role: "ADMIN" },
    });
    expect(blockedInvite.statusCode).toBe(400);

    const [key] = await harness.dbHandle.db
      .select({ id: schema.webauthnCredentials.id })
      .from(schema.webauthnCredentials)
      .where(eq(schema.webauthnCredentials.userId, admin.id))
      .limit(1);
    const blockedRevocation = await harness.app.inject({
      method: "DELETE",
      url: `/v1/settings/security-keys/${key!.id}`,
      headers: admin.headers,
    });
    expect(blockedRevocation.statusCode).toBe(400);

    const disabled = await harness.app.inject({
      method: "PATCH",
      url: "/v1/organization/security",
      headers: admin.headers,
      payload: { phishingResistantMfaRequired: false },
    });
    expect(disabled.statusCode, disabled.body).toBe(200);
  });

  it("revokes legacy MCP access when the legacy user route changes a role", async () => {
    const legacyMember = await harness.createUser({ role: "MEMBER" });
    const created = await harness.app.inject({
      method: "POST",
      url: "/v1/settings/mcp-access",
      headers: legacyMember.headers,
      payload: { name: "Before promotion" },
    });
    expect(created.statusCode, created.body).toBe(200);
    const token = created.json<CreateMcpAccessTokenResponse>().token;

    await harness.dbHandle.db.insert(schema.webauthnCredentials).values([
      {
        userId: legacyMember.id,
        credentialId: `legacy-promotion-a-${legacyMember.id}`,
        publicKey: "unused-in-policy-test",
        transports: ["usb"],
        deviceType: "singleDevice",
        backedUp: false,
        name: "Primary",
      },
      {
        userId: legacyMember.id,
        credentialId: `legacy-promotion-b-${legacyMember.id}`,
        publicKey: "unused-in-policy-test",
        transports: ["usb"],
        deviceType: "singleDevice",
        backedUp: false,
        name: "Spare",
      },
    ]);
    const promoted = await harness.app.inject({
      method: "PATCH",
      url: `/v1/users/${legacyMember.id}`,
      headers: admin.headers,
      payload: { role: "ADMIN" },
    });
    expect(promoted.statusCode, promoted.body).toBe(200);
    const rejected = await harness.app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(rejected.statusCode).toBe(401);
  });

  it("rechecks live WebAuthn policy after waiting to create MCP access", async () => {
    await harness.dbHandle.db
      .update(schema.sessions)
      .set({ mfaMethod: "TOTP", mfaVerifiedAt: new Date().toISOString() })
      .where(eq(schema.sessions.tokenHash, hashToken(admin.token)));
    const lockClient = await harness.dbHandle.pool.connect();
    try {
      await lockClient.query("BEGIN");
      await lockClient.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`webauthn-policy:${admin.organizationId}`],
      );
      const creation = harness.app.inject({
        method: "POST",
        url: "/v1/settings/mcp-access",
        headers: admin.headers,
        payload: { name: "Must use live policy" },
      });

      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
        const result = await lockClient.query<{ waiting: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted) AS waiting",
        );
        waiting = result.rows[0]?.waiting ?? false;
        if (!waiting) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      expect(waiting).toBe(true);
      await lockClient.query(
        "UPDATE organization_security_policies SET phishing_resistant_mfa_required = true WHERE organization_id = $1",
        [admin.organizationId],
      );
      await lockClient.query("COMMIT");

      const response = await creation;
      expect(response.statusCode, response.body).toBe(403);
      expect(
        response.json<{ error: { category: string } }>().error.category,
      ).toBe("MFA_REAUTH_REQUIRED");
    } finally {
      await lockClient.query("ROLLBACK").catch(() => undefined);
      lockClient.release();
      await harness.dbHandle.db
        .update(schema.organizationSecurityPolicies)
        .set({ phishingResistantMfaRequired: false })
        .where(
          eq(
            schema.organizationSecurityPolicies.organizationId,
            admin.organizationId,
          ),
        );
      await harness.dbHandle.db
        .update(schema.sessions)
        .set({ mfaMethod: "WEBAUTHN", mfaVerifiedAt: new Date().toISOString() })
        .where(eq(schema.sessions.tokenHash, hashToken(admin.token)));
    }
  });

  it("rechecks the live recent-MFA window after waiting to create MCP access", async () => {
    await harness.dbHandle.db
      .update(schema.sessions)
      .set({
        mfaMethod: "TOTP",
        mfaVerifiedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      })
      .where(eq(schema.sessions.tokenHash, hashToken(member.token)));
    const lockClient = await harness.dbHandle.pool.connect();
    try {
      await lockClient.query("BEGIN");
      await lockClient.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`webauthn-policy:${member.organizationId}`],
      );
      const creation = harness.app.inject({
        method: "POST",
        url: "/v1/settings/mcp-access",
        headers: member.headers,
        payload: { name: "Must use live recent-MFA window" },
      });

      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
        const result = await lockClient.query<{ waiting: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted) AS waiting",
        );
        waiting = result.rows[0]?.waiting ?? false;
        if (!waiting) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      expect(waiting).toBe(true);
      await lockClient.query(
        "UPDATE organization_security_policies SET recent_mfa_minutes = 5 WHERE organization_id = $1",
        [member.organizationId],
      );
      await lockClient.query("COMMIT");

      const response = await creation;
      expect(response.statusCode, response.body).toBe(403);
      expect(
        response.json<{ error: { category: string } }>().error.category,
      ).toBe("MFA_REAUTH_REQUIRED");
    } finally {
      await lockClient.query("ROLLBACK").catch(() => undefined);
      lockClient.release();
      await harness.dbHandle.db
        .update(schema.organizationSecurityPolicies)
        .set({ recentMfaMinutes: 12 })
        .where(
          eq(
            schema.organizationSecurityPolicies.organizationId,
            member.organizationId,
          ),
        );
      await harness.dbHandle.db
        .update(schema.sessions)
        .set({ mfaVerifiedAt: new Date().toISOString() })
        .where(eq(schema.sessions.tokenHash, hashToken(member.token)));
    }
  });

  it("does not deliver events to a revoked long-lived session", async () => {
    const user = await harness.createUser({ role: "MEMBER" });
    const [session] = await harness.dbHandle.db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(eq(schema.sessions.tokenHash, hashToken(user.token)));
    const received: unknown[] = [];
    const unsubscribe = harness.app.events.subscribe({
      id: `revoked-stream-${user.id}`,
      userId: user.id,
      sessionId: session!.id,
      send: (event) => received.push(event),
    });
    try {
      await harness.dbHandle.db
        .update(schema.sessions)
        .set({ revokedAt: new Date().toISOString() })
        .where(eq(schema.sessions.id, session!.id));
      harness.app.events.publish({
        type: "entity.changed",
        entityType: "organization_security_policy",
        entityId: user.organizationId,
        caseId: null,
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(received).toHaveLength(0);
    } finally {
      unsubscribe();
    }
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
        detail: expect.objectContaining({ mailHtmlRenderingEnabled: false }),
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
