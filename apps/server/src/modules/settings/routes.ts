import type { AppInstance } from "../../http/app-instance.js";
import { and, eq, isNull, ne, sql } from "drizzle-orm";

import {
  CreateMcpAccessTokenRequest,
  CreateMcpAccessTokenResponse,
  ErrorResponse,
  MailRenderingPreferences,
  McpAccessTokenList,
  OkResponse,
  UpdateMailRenderingPreferences,
} from "@codevault/contracts";
import {
  DomainError,
  hasRecentMfa,
  permissionDenied,
  validationError,
} from "@codevault/core";
import { schema } from "@codevault/db";
import { Type } from "@sinclair/typebox";

import {
  hashPassword,
  verifyPassword,
  WeakPasswordError,
} from "../../auth/password.js";
import {
  reserveLoginAttempt,
  clearFailedAttempts,
} from "../../auth/login-throttle.js";
import {
  principalOf,
  requireInteractiveSession,
  requireRecentMfa,
} from "../../http/guards.js";
import {
  createMcpAccess,
  revokeAllMcpAccessForUser,
  revokeMcpAccess,
} from "../../auth/mcp-access.js";
import { lockPhishingResistantPolicy } from "../../auth/webauthn-policy.js";

const Profile = Type.Object({
  displayName: Type.String({ minLength: 2, maxLength: 120 }),
});
const SecuritySummary = Type.Object({
  totp: Type.Object({
    status: Type.Union([
      Type.Literal("ACTIVE"),
      Type.Literal("NOT_CONFIGURED"),
    ]),
    enrolledAt: Type.Union([Type.String(), Type.Null()]),
  }),
  recoveryCodes: Type.Object({
    remaining: Type.Integer({ minimum: 0 }),
  }),
});
const Password = Type.Object({
  currentPassword: Type.String({ minLength: 1, maxLength: 512 }),
  newPassword: Type.String({ minLength: 12, maxLength: 512 }),
});
const Sessions = Type.Object({
  items: Type.Array(
    Type.Object({
      id: Type.String({ format: "uuid" }),
      userAgent: Type.Union([Type.String(), Type.Null()]),
      createdAt: Type.String(),
      lastSeenAt: Type.Union([Type.String(), Type.Null()]),
      expiresAt: Type.String(),
      current: Type.Boolean(),
    }),
  ),
});
const Id = Type.Object({ id: Type.String({ format: "uuid" }) });

export async function registerSettingsRoutes(app: AppInstance): Promise<void> {
  app.get(
    "/v1/settings/mail",
    { schema: { response: { 200: MailRenderingPreferences } } },
    async (request) => {
      const principal = principalOf(request);
      const [user] = await app.db
        .select({ automaticHtml: schema.users.automaticHtmlMail })
        .from(schema.users)
        .where(eq(schema.users.id, principal.user.id))
        .limit(1);

      return {
        automaticHtml: user?.automaticHtml ?? true,
        organizationAllowsHtml:
          principal.organization.policy.mailHtmlRenderingEnabled,
      };
    },
  );

  app.patch(
    "/v1/settings/mail",
    {
      schema: {
        body: UpdateMailRenderingPreferences,
        response: { 200: MailRenderingPreferences, 403: ErrorResponse },
      },
    },
    async (request) => {
      const principal = requireInteractiveSession(request);
      if (!principal.organization.policy.mailHtmlRenderingEnabled) {
        throw permissionDenied(
          "HTML email rendering is disabled by your organization.",
        );
      }
      const [user] = await app.db
        .update(schema.users)
        .set({
          automaticHtmlMail: request.body.automaticHtml,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.users.id, principal.user.id))
        .returning({ automaticHtml: schema.users.automaticHtmlMail });

      return {
        automaticHtml: user?.automaticHtml ?? request.body.automaticHtml,
        organizationAllowsHtml: true,
      };
    },
  );

  app.get(
    "/v1/settings/mcp-access",
    { schema: { response: { 200: McpAccessTokenList } } },
    async (request) => {
      const principal = requireInteractiveSession(request);
      const rows = await app.db
        .select({
          id: schema.mcpAccessTokens.id,
          name: schema.mcpAccessTokens.name,
          createdAt: schema.mcpAccessTokens.createdAt,
          lastUsedAt: schema.mcpAccessTokens.lastUsedAt,
        })
        .from(schema.mcpAccessTokens)
        .where(
          and(
            eq(schema.mcpAccessTokens.userId, principal.user.id),
            isNull(schema.mcpAccessTokens.revokedAt),
          ),
        )
        .orderBy(sql`${schema.mcpAccessTokens.createdAt} DESC`);
      return { items: rows };
    },
  );

  app.post(
    "/v1/settings/mcp-access",
    {
      schema: {
        body: CreateMcpAccessTokenRequest,
        response: {
          200: CreateMcpAccessTokenResponse,
          403: ErrorResponse,
        },
      },
      config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    },
    async (request) => {
      const principal = requireInteractiveSession(request);
      requireRecentMfa(request);
      if (!principal.organization.policy.mcpEnabled) {
        throw permissionDenied("MCP access is disabled by your organization.");
      }
      return app.db.transaction(async (tx) => {
        await lockPhishingResistantPolicy(tx, principal.organization.id);
        const live = await tx.execute<{
          role: "ADMIN" | "MEMBER" | "VIEWER";
          disabled: boolean;
          mcp_enabled: boolean;
          mfa_required: boolean;
          phishing_resistant_mfa_required: boolean;
          recent_mfa_minutes: number;
          mfa_method: "PASSWORD" | "TOTP" | "WEBAUTHN";
          mfa_verified_at: string;
        }>(sql`
          SELECT membership.role, account.disabled, policy.mcp_enabled,
            policy.mfa_required,
            policy.phishing_resistant_mfa_required,
            policy.recent_mfa_minutes, session.mfa_method,
            session.mfa_verified_at
          FROM sessions AS session
          JOIN users AS account ON account.id = session.user_id
          JOIN organization_memberships AS membership ON membership.user_id = account.id
          JOIN organization_security_policies AS policy
            ON policy.organization_id = membership.organization_id
          WHERE session.id = ${principal.session.id}
            AND session.user_id = ${principal.user.id}
            AND membership.organization_id = ${principal.organization.id}
            AND session.revoked_at IS NULL
            AND session.expires_at > now()
          FOR UPDATE OF session, membership
        `);
        const current = live.rows[0];
        if (!current || current.disabled || !current.mcp_enabled) {
          throw permissionDenied(
            "MCP access is disabled or this session is no longer active.",
          );
        }
        const phishingResistantAdmin =
          current.role === "ADMIN" && current.phishing_resistant_mfa_required;
        const recent = hasRecentMfa(
          current.mfa_verified_at,
          current.recent_mfa_minutes,
        );
        if (
          (current.mfa_required && !recent) ||
          (phishingResistantAdmin && current.mfa_method !== "WEBAUTHN")
        ) {
          throw new DomainError(
            "MFA_REAUTH_REQUIRED",
            phishingResistantAdmin
              ? "Verify a security key before creating administrator MCP access."
              : "Complete recent multi-factor authentication before creating MCP access.",
            phishingResistantAdmin
              ? { details: { requiredMethod: "WEBAUTHN" } }
              : undefined,
          );
        }
        const created = await createMcpAccess(
          tx,
          principal.user.id,
          request.body.name,
        );
        await app.audit.write(
          tx,
          {
            organizationId: principal.organization.id,
            actorId: principal.user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "auth.mcp_access_created",
            entityType: "mcp_access",
            entityId: created.access.id,
            after: { name: created.access.name },
          },
        );
        return created;
      });
    },
  );

  app.delete(
    "/v1/settings/mcp-access/:id",
    { schema: { params: Id, response: { 200: OkResponse } } },
    async (request) => {
      const principal = requireInteractiveSession(request);
      await app.db.transaction(async (tx) => {
        const [access] = await tx
          .select({
            id: schema.mcpAccessTokens.id,
            name: schema.mcpAccessTokens.name,
          })
          .from(schema.mcpAccessTokens)
          .where(
            and(
              eq(schema.mcpAccessTokens.id, request.params.id),
              eq(schema.mcpAccessTokens.userId, principal.user.id),
              isNull(schema.mcpAccessTokens.revokedAt),
            ),
          )
          .limit(1);
        await revokeMcpAccess(tx, principal.user.id, request.params.id);
        if (access !== undefined) {
          await app.audit.write(
            tx,
            {
              organizationId: principal.organization.id,
              actorId: principal.user.id,
              sessionId: principal.session.id,
              requestId: request.requestId,
            },
            {
              action: "auth.mcp_access_revoked",
              entityType: "mcp_access",
              entityId: access.id,
              before: { name: access.name },
            },
          );
        }
      });
      return { ok: true as const };
    },
  );

  app.patch(
    "/v1/settings/profile",
    { schema: { body: Profile, response: { 200: Profile } } },
    async (request) => {
      const principal = principalOf(request);
      const [row] = await app.db
        .update(schema.users)
        .set({ displayName: request.body.displayName, updatedAt: sql`now()` })
        .where(eq(schema.users.id, principal.user.id))
        .returning({ displayName: schema.users.displayName });
      return row!;
    },
  );
  app.get(
    "/v1/settings/security",
    { schema: { response: { 200: SecuritySummary } } },
    async (request) => {
      const principal = principalOf(request);
      const [[credential], [recoveryCodes]] = await Promise.all([
        app.db
          .select({ enrolledAt: schema.totpCredentials.enrolledAt })
          .from(schema.totpCredentials)
          .where(
            and(
              eq(schema.totpCredentials.userId, principal.user.id),
              isNull(schema.totpCredentials.replacedAt),
            ),
          )
          .limit(1),
        app.db
          .select({ remaining: sql<number>`count(*)::int` })
          .from(schema.mfaRecoveryCodes)
          .where(
            and(
              eq(schema.mfaRecoveryCodes.userId, principal.user.id),
              isNull(schema.mfaRecoveryCodes.usedAt),
            ),
          ),
      ]);

      return {
        totp: {
          status:
            credential === undefined
              ? ("NOT_CONFIGURED" as const)
              : ("ACTIVE" as const),
          enrolledAt: credential?.enrolledAt ?? null,
        },
        recoveryCodes: { remaining: recoveryCodes?.remaining ?? 0 },
      };
    },
  );
  app.post(
    "/v1/settings/password",
    {
      schema: {
        body: Password,
        response: {
          200: OkResponse,
          400: ErrorResponse,
          403: ErrorResponse,
          429: ErrorResponse,
        },
      },
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
    },
    async (request) => {
      const principal = principalOf(request);
      requireRecentMfa(request);
      const throttle = await reserveLoginAttempt(
        app.db,
        principal.user.email,
        request.ip,
        "PASSWORD",
        {
          maxAttempts: app.config.auth.loginMaxAttempts,
          windowMinutes: app.config.auth.loginAttemptWindowMinutes,
        },
      );
      if (!throttle.allowed) {
        throw new DomainError(
          "RATE_LIMITED",
          "Too many password attempts. Try again shortly.",
        );
      }
      const [user] = await app.db
        .select({ hash: schema.users.passwordHash })
        .from(schema.users)
        .where(eq(schema.users.id, principal.user.id));
      const currentPasswordAccepted =
        user !== undefined &&
        (await verifyPassword(user.hash, request.body.currentPassword));
      if (!currentPasswordAccepted)
        throw validationError("The current password was not accepted.");
      await clearFailedAttempts(app.db, principal.user.email, "PASSWORD");
      let passwordHash: string;
      try {
        passwordHash = await hashPassword(request.body.newPassword);
      } catch (error) {
        if (error instanceof WeakPasswordError)
          throw validationError(error.message);
        throw error;
      }
      await app.db.transaction(async (tx) => {
        await tx
          .update(schema.users)
          .set({ passwordHash, updatedAt: sql`now()` })
          .where(eq(schema.users.id, principal.user.id));
        await tx
          .update(schema.sessions)
          .set({ revokedAt: sql`now()` })
          .where(
            and(
              eq(schema.sessions.userId, principal.user.id),
              ne(schema.sessions.id, principal.session.id),
              isNull(schema.sessions.revokedAt),
            ),
          );
        await revokeAllMcpAccessForUser(tx, principal.user.id);
      });
      return { ok: true as const };
    },
  );
  app.get(
    "/v1/settings/sessions",
    { schema: { response: { 200: Sessions } } },
    async (request) => {
      const principal = principalOf(request);
      const rows = await app.db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.userId, principal.user.id))
        .orderBy(sql`${schema.sessions.createdAt} DESC`);
      return {
        items: rows.map((row) => ({
          id: row.id,
          userAgent: row.userAgent,
          createdAt: row.createdAt,
          lastSeenAt: row.lastSeenAt,
          expiresAt: row.expiresAt,
          current: row.id === principal.session.id,
        })),
      };
    },
  );
  app.delete(
    "/v1/settings/sessions/:id",
    { schema: { params: Id, response: { 200: OkResponse } } },
    async (request) => {
      const principal = principalOf(request);
      await app.db
        .update(schema.sessions)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(schema.sessions.id, request.params.id),
            eq(schema.sessions.userId, principal.user.id),
          ),
        );
      return { ok: true as const };
    },
  );
}
