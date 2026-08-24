import type { AppInstance } from "../../http/app-instance.js";
import { and, eq, isNull, sql } from "drizzle-orm";

import {
  ErrorResponse,
  LoginCompleteRequest,
  LoginRequest,
  LoginResponse,
  LoginStartResponse,
  OkResponse,
  StepUpRequest,
} from "@codevault/contracts";
import { generateOpaqueToken } from "@codevault/core/crypto";
import { schema } from "@codevault/db";

import {
  reserveLoginAttempt,
  clearFailedAttempts,
} from "../../auth/login-throttle.js";
import { verifyPassword } from "../../auth/password.js";
import { createSession } from "../../auth/session.js";
import { hashToken } from "../../auth/tokens.js";
import { consumeTotpCounter, validateTotpAt } from "../../auth/totp.js";
import { principalOf } from "../../http/guards.js";

const INVALID_MFA = "The authenticator code was not accepted.";

export async function registerLoginRoutes(app: AppInstance): Promise<void> {
  app.post(
    "/v1/auth/login/start",
    {
      schema: {
        body: LoginRequest,
        response: {
          200: LoginStartResponse,
          401: ErrorResponse,
          429: ErrorResponse,
        },
      },
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const email = request.body.email.trim().toLowerCase();
      const sourceKey = request.ip;
      const throttle = await reserveLoginAttempt(
        app.db,
        email,
        sourceKey,
        "PASSWORD",
        {
          maxAttempts: app.config.auth.loginMaxAttempts,
          windowMinutes: app.config.auth.loginAttemptWindowMinutes,
        },
      );
      if (!throttle.allowed) {
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

      const [user] = await app.db
        .select({
          id: schema.users.id,
          passwordHash: schema.users.passwordHash,
          disabled: schema.users.disabled,
          credentialId: schema.totpCredentials.id,
          webauthnCredentialId: schema.webauthnCredentials.id,
        })
        .from(schema.users)
        .innerJoin(
          schema.organizationMemberships,
          eq(schema.organizationMemberships.userId, schema.users.id),
        )
        .leftJoin(
          schema.totpCredentials,
          eq(schema.totpCredentials.userId, schema.users.id),
        )
        .leftJoin(
          schema.webauthnCredentials,
          and(
            eq(schema.webauthnCredentials.userId, schema.users.id),
            isNull(schema.webauthnCredentials.revokedAt),
          ),
        )
        .where(sql`lower(${schema.users.email}) = ${email}`)
        .limit(1);
      const fallback =
        "$argon2id$v=19$m=19456,t=2,p=1$YWJjZGVmZ2hpamtsbW5vcA$0000000000000000000000000000000000000000000";
      const matches = await verifyPassword(
        user?.passwordHash ?? fallback,
        request.body.password,
      );
      const accepted = user !== undefined && !user.disabled && matches;
      if (accepted) await clearFailedAttempts(app.db, email, "PASSWORD");
      if (!accepted) {
        return reply.status(401).send({
          error: {
            category: "PERMISSION_DENIED",
            message: "Those credentials were not accepted.",
            requestId: request.requestId,
          },
        });
      }

      const challengeToken = generateOpaqueToken();
      const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
      await app.db.insert(schema.mfaChallenges).values({
        userId: user.id,
        purpose: user.credentialId === null ? "MIGRATED_ENROLLMENT" : "LOGIN",
        tokenHash: hashToken(challengeToken),
        sourceKey,
        expiresAt,
      });
      return {
        challengeToken,
        challenge:
          user.credentialId === null
            ? ("ENROLLMENT_REQUIRED" as const)
            : ("MFA_REQUIRED" as const),
        methods: (user.webauthnCredentialId === null
          ? (["TOTP"] as const)
          : (["TOTP", "WEBAUTHN"] as const)) as ("TOTP" | "WEBAUTHN")[],
        expiresAt,
      };
    },
  );

  app.post(
    "/v1/auth/login/complete",
    {
      schema: {
        body: LoginCompleteRequest,
        response: {
          200: LoginResponse,
          400: ErrorResponse,
          429: ErrorResponse,
        },
      },
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const challengeIdentity = await app.db.execute<{ email: string }>(sql`
        SELECT account.email FROM mfa_challenges AS challenge
        JOIN users AS account ON account.id = challenge.user_id
        WHERE challenge.token_hash = ${hashToken(request.body.challengeToken)}
          AND challenge.source_key = ${request.ip}
          AND challenge.consumed_at IS NULL AND challenge.expires_at > now()
        LIMIT 1
      `);
      const challengeEmail = challengeIdentity.rows[0]?.email;
      if (challengeEmail) {
        const throttle = await reserveLoginAttempt(
          app.db,
          challengeEmail,
          request.ip,
          "MFA",
          {
            maxAttempts: app.config.auth.loginMaxAttempts,
            windowMinutes: app.config.auth.loginAttemptWindowMinutes,
          },
        );
        if (!throttle.allowed) {
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
      }
      const outcome = await app.db.transaction(async (tx) => {
        const result = await tx.execute<{
          challenge_id: string;
          attempt_count: number;
          user_id: string;
          email: string;
          display_name: string;
          role: "ADMIN" | "MEMBER" | "VIEWER";
          user_created_at: string;
          last_login_at: string | null;
          disabled: boolean;
          credential_id: string;
          key_id: string;
          nonce: string;
          ciphertext: string;
          auth_tag: string;
          absolute_hours: number;
        }>(sql`
          SELECT challenge.id AS challenge_id, challenge.attempt_count,
            account.id AS user_id, account.email, account.display_name,
            membership.role, account.created_at AS user_created_at,
            account.last_login_at, account.disabled,
            credential.id AS credential_id, credential.key_id, credential.nonce,
            credential.ciphertext, credential.auth_tag,
            policy.session_absolute_hours AS absolute_hours
          FROM mfa_challenges AS challenge
          JOIN users AS account ON account.id = challenge.user_id
          JOIN organization_memberships AS membership ON membership.user_id = account.id
          JOIN organization_security_policies AS policy ON policy.organization_id = membership.organization_id
          JOIN totp_credentials AS credential ON credential.user_id = account.id AND credential.replaced_at IS NULL
          WHERE challenge.token_hash = ${hashToken(request.body.challengeToken)}
            AND challenge.source_key = ${request.ip}
            AND challenge.purpose = 'LOGIN' AND challenge.consumed_at IS NULL
            AND challenge.expires_at > now()
          FOR UPDATE OF challenge, account, credential
        `);
        const row = result.rows[0];
        if (row === undefined || row.disabled || row.attempt_count >= 5)
          return { ok: false as const, email: row?.email ?? null };
        const secret = app.config.auth.mfaKeyring
          .decrypt(
            {
              keyId: row.key_id,
              nonce: row.nonce,
              ciphertext: row.ciphertext,
              authTag: row.auth_tag,
            },
            `totp:${row.credential_id}:${row.user_id}`,
          )
          .toString("utf8");
        const counter = validateTotpAt(secret, request.body.totp, Date.now());
        if (
          counter === null ||
          !(await consumeTotpCounter(tx, row.credential_id, counter))
        ) {
          await tx
            .update(schema.mfaChallenges)
            .set({ attemptCount: row.attempt_count + 1 })
            .where(eq(schema.mfaChallenges.id, row.challenge_id));
          return { ok: false as const, email: row.email };
        }
        await tx
          .update(schema.mfaChallenges)
          .set({ consumedAt: sql`now()` })
          .where(eq(schema.mfaChallenges.id, row.challenge_id));
        const session = await createSession(
          tx,
          row.user_id,
          request.body.rememberMe === true
            ? app.config.auth.sessionTtlHours
            : row.absolute_hours,
          typeof request.headers["user-agent"] === "string"
            ? request.headers["user-agent"].slice(0, 200)
            : null,
          new Date(),
          request.body.rememberMe === true,
        );
        await tx
          .update(schema.users)
          .set({ lastLoginAt: sql`now()` })
          .where(eq(schema.users.id, row.user_id));
        return { ok: true as const, session, row };
      });
      if (!outcome.ok) {
        return reply.status(400).send({
          error: {
            category: "VALIDATION",
            message: INVALID_MFA,
            requestId: request.requestId,
          },
        });
      }
      await clearFailedAttempts(app.db, outcome.row.email, "MFA");
      return {
        token: outcome.session.token,
        expiresAt: outcome.session.expiresAt,
        user: {
          id: outcome.row.user_id,
          email: outcome.row.email,
          displayName: outcome.row.display_name,
          role: outcome.row.role,
          createdAt: outcome.row.user_created_at,
          lastLoginAt: outcome.row.last_login_at,
        },
      };
    },
  );

  app.post(
    "/v1/auth/step-up",
    {
      schema: {
        body: StepUpRequest,
        response: { 200: OkResponse, 400: ErrorResponse, 429: ErrorResponse },
      },
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      const principal = principalOf(request);
      const throttle = await reserveLoginAttempt(
        app.db,
        principal.user.email,
        request.ip,
        "MFA",
        {
          maxAttempts: app.config.auth.loginMaxAttempts,
          windowMinutes: app.config.auth.loginAttemptWindowMinutes,
        },
      );
      if (!throttle.allowed) {
        return reply
          .status(429)
          .header("retry-after", String(throttle.retryAfterSeconds))
          .send({
            error: {
              category: "RATE_LIMITED",
              message: "Too many MFA attempts. Try again shortly.",
              requestId: request.requestId,
            },
          });
      }
      const accepted = await app.db.transaction(async (tx) => {
        const result = await tx.execute<{
          id: string;
          key_id: string;
          nonce: string;
          ciphertext: string;
          auth_tag: string;
        }>(sql`
          SELECT id, key_id, nonce, ciphertext, auth_tag FROM totp_credentials
          WHERE user_id = ${principal.user.id} AND replaced_at IS NULL FOR UPDATE
        `);
        const credential = result.rows[0];
        if (!credential) return false;
        const secret = app.config.auth.mfaKeyring
          .decrypt(
            {
              keyId: credential.key_id,
              nonce: credential.nonce,
              ciphertext: credential.ciphertext,
              authTag: credential.auth_tag,
            },
            `totp:${credential.id}:${principal.user.id}`,
          )
          .toString("utf8");
        const counter = validateTotpAt(secret, request.body.totp, Date.now());
        if (
          counter === null ||
          !(await consumeTotpCounter(tx, credential.id, counter))
        )
          return false;
        await tx
          .update(schema.sessions)
          .set({ mfaVerifiedAt: sql`now()` })
          .where(eq(schema.sessions.id, principal.session.id));
        return true;
      });
      if (accepted)
        await clearFailedAttempts(app.db, principal.user.email, "MFA");
      return accepted
        ? { ok: true as const }
        : reply.status(400).send({
            error: {
              category: "VALIDATION",
              message: INVALID_MFA,
              requestId: request.requestId,
            },
          });
    },
  );
}
