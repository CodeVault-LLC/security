import type { AppInstance } from "../../http/app-instance.js";
import { and, eq, isNull, ne, sql } from "drizzle-orm";

import { ErrorResponse, OkResponse } from "@codevault/contracts";
import { DomainError, validationError } from "@codevault/core";
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
import { principalOf, requireRecentMfa } from "../../http/guards.js";

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
