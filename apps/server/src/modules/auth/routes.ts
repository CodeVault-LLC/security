import type { AppInstance } from "../../http/app-instance.js";
import { and, eq, isNull, sql } from "drizzle-orm";

import {
  AcceptInviteRequest,
  ErrorResponse,
  LoginRequest,
  LoginResponse,
  MeResponse,
  OkResponse,
} from "@codevault/contracts";
import { DomainError, validationError } from "@codevault/core";
import { schema } from "@codevault/db";

import {
  checkLoginThrottle,
  clearFailedAttempts,
  recordLoginAttempt,
} from "../../auth/login-throttle.js";
import {
  hashPassword,
  verifyPassword,
  WeakPasswordError,
} from "../../auth/password.js";
import { createSession, revokeSession } from "../../auth/session.js";
import { hashToken } from "../../auth/tokens.js";
import { principalOf } from "../../http/guards.js";

/**
 * Authentication routes.
 *
 * There is no registration endpoint. `POST /v1/invites/accept` is the only way
 * an account comes into existence, and it requires a token an administrator
 * generated.
 */

export async function registerAuthRoutes(app: AppInstance): Promise<void> {
  app.post(
    "/v1/auth/login",
    {
      schema: {
        body: LoginRequest,
        response: {
          200: LoginResponse,
          401: ErrorResponse,
          429: ErrorResponse,
        },
      },
      config: {
        // Tighter than the global limit: this is the one unauthenticated route
        // where guessing is the attack.
        rateLimit: { max: 20, timeWindow: "1 minute" },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;
      const sourceKey = request.ip;
      const throttle = await checkLoginThrottle(app.db, email, sourceKey, {
        maxAttempts: app.config.auth.loginMaxAttempts,
        windowMinutes: app.config.auth.loginAttemptWindowMinutes,
      });

      if (!throttle.allowed) {
        await app.audit.write(
          app.db,
          { actorId: null, sessionId: null, requestId: request.requestId },
          {
            action: "auth.login_throttled",
            entityType: "user",
            entityId: null,
            after: { email },
          },
        );

        return reply
          .status(429)
          .header("retry-after", String(throttle.retryAfterSeconds))
          .send({
            error: {
              category: "RATE_LIMITED",
              message: "Too many sign-in attempts. Try again shortly.",
              requestId: request.requestId,
            },
          });
      }

      const rows = await app.db
        .select({
          id: schema.users.id,
          email: schema.users.email,
          displayName: schema.users.displayName,
          passwordHash: schema.users.passwordHash,
          disabled: schema.users.disabled,
          createdAt: schema.users.createdAt,
          lastLoginAt: schema.users.lastLoginAt,
          role: schema.organizationMemberships.role,
        })
        .from(schema.users)
        .innerJoin(
          schema.organizationMemberships,
          eq(schema.organizationMemberships.userId, schema.users.id),
        )
        .where(sql`lower(${schema.users.email}) = lower(${email})`)
        .limit(1);

      const user = rows[0];
      // The password is verified even when no user matched, so a wrong address
      // and a wrong password take indistinguishable time.
      const storedHash =
        user?.passwordHash ??
        "$argon2id$v=19$m=19456,t=2,p=1$YWJjZGVmZ2hpamtsbW5vcA$0000000000000000000000000000000000000000000";
      const passwordMatches = await verifyPassword(storedHash, password);
      const accepted = user !== undefined && !user.disabled && passwordMatches;

      await recordLoginAttempt(app.db, email, sourceKey, accepted);

      if (!accepted) {
        await app.audit.write(
          app.db,
          {
            actorId: user?.id ?? null,
            sessionId: null,
            requestId: request.requestId,
          },
          {
            action: "auth.login_failed",
            entityType: "user",
            entityId: user?.id ?? null,
            after: {
              email,
              reason: user?.disabled === true ? "DISABLED" : "CREDENTIALS",
            },
          },
        );

        return reply.status(401).send({
          error: {
            category: "PERMISSION_DENIED",
            message: "Those credentials were not accepted.",
            requestId: request.requestId,
          },
        });
      }

      const session = await createSession(
        app.db,
        user.id,
        app.config.auth.sessionTtlHours,
        typeof request.headers["user-agent"] === "string"
          ? request.headers["user-agent"].slice(0, 200)
          : null,
      );

      await clearFailedAttempts(app.db, email);
      await app.db
        .update(schema.users)
        .set({ lastLoginAt: sql`now()` })
        .where(eq(schema.users.id, user.id));

      await app.audit.write(
        app.db,
        {
          actorId: user.id,
          sessionId: session.sessionId,
          requestId: request.requestId,
        },
        {
          action: "auth.login",
          entityType: "user",
          entityId: user.id,
        },
      );

      return {
        token: session.token,
        expiresAt: session.expiresAt,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
        },
      };
    },
  );

  app.post(
    "/v1/auth/logout",
    { schema: { response: { 200: OkResponse } } },
    async (request) => {
      const principal = principalOf(request);

      await revokeSession(app.db, principal.session.id);
      await app.audit.write(
        app.db,
        {
          actorId: principal.user.id,
          sessionId: principal.session.id,
          requestId: request.requestId,
        },
        {
          action: "auth.logout",
          entityType: "user",
          entityId: principal.user.id,
        },
      );

      return { ok: true as const };
    },
  );

  app.get(
    "/v1/auth/me",
    { schema: { response: { 200: MeResponse } } },
    async (request) => {
      const principal = principalOf(request);

      return {
        user: {
          id: principal.user.id,
          email: principal.user.email,
          displayName: principal.user.displayName,
          role: principal.user.role,
          createdAt: principal.user.createdAt,
          lastLoginAt: principal.user.lastLoginAt,
        },
        session: principal.session,
      };
    },
  );

  /**
   * Invite acceptance.
   *
   * Public by necessity, and the only public write in the API. The token is
   * single-use, expiring, and consumed inside the same transaction that creates
   * the account, so a replayed request cannot create a second user.
   */
  app.post(
    "/v1/invites/accept",
    {
      schema: {
        body: AcceptInviteRequest,
        response: { 200: OkResponse, 400: ErrorResponse },
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { token, displayName, password } = request.body;
      const tokenHash = hashToken(token);

      let passwordHash: string;

      try {
        passwordHash = await hashPassword(password);
      } catch (error: unknown) {
        if (error instanceof WeakPasswordError) {
          throw validationError(error.message);
        }

        throw error;
      }

      await app.db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(schema.invites)
          .where(
            and(
              eq(schema.invites.tokenHash, tokenHash),
              isNull(schema.invites.acceptedAt),
              isNull(schema.invites.revokedAt),
            ),
          )
          .for("update")
          .limit(1);

        const invite = rows[0];

        if (invite === undefined) {
          throw validationError("That invitation is not valid.");
        }

        if (new Date(invite.expiresAt).getTime() <= Date.now()) {
          throw validationError("That invitation has expired.");
        }

        const existing = await tx
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(sql`lower(${schema.users.email}) = lower(${invite.email})`)
          .limit(1);

        if (existing.length > 0) {
          throw validationError("An account already exists for that address.");
        }

        const [created] = await tx
          .insert(schema.users)
          .values({
            email: invite.email,
            displayName,
            passwordHash,
          })
          .returning({ id: schema.users.id });

        if (created === undefined) {
          throw new DomainError(
            "SERVER_ERROR",
            "Could not create the account.",
          );
        }

        await tx.insert(schema.organizationMemberships).values({
          organizationId: invite.organizationId,
          userId: created.id,
          role: invite.role,
        });

        await tx
          .update(schema.invites)
          .set({ acceptedAt: sql`now()`, acceptedByUserId: created.id })
          .where(eq(schema.invites.id, invite.id));

        await app.audit.write(
          tx,
          {
            actorId: created.id,
            sessionId: null,
            requestId: request.requestId,
          },
          {
            action: "invite.accepted",
            entityType: "invite",
            entityId: invite.id,
            after: { userId: created.id, role: invite.role },
          },
        );
      });

      return { ok: true as const };
    },
  );
}
