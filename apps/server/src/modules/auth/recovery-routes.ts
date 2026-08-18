import { randomBytes } from "node:crypto";

import type { AppInstance } from "../../http/app-instance.js";
import { and, eq, isNull, sql } from "drizzle-orm";

import {
  ErrorResponse,
  RecoveryCompleteResponse,
  RecoveryConfirmRequest,
  RecoveryStartRequest,
  TotpEnrollmentResponse,
} from "@codevault/contracts";
import { generateOpaqueToken, uuidv7 } from "@codevault/core/crypto";
import { schema } from "@codevault/db";

import { verifyPassword } from "../../auth/password.js";
import { createSession } from "../../auth/session.js";
import { hashToken } from "../../auth/tokens.js";
import { createTotpEnrollment, validateTotpAt } from "../../auth/totp.js";

const INVALID_RECOVERY = "The recovery request was not accepted.";

function newRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () =>
    randomBytes(16).toString("base64url"),
  );
}

export async function registerRecoveryRoutes(app: AppInstance): Promise<void> {
  app.post(
    "/v1/auth/recovery/start",
    {
      schema: {
        body: RecoveryStartRequest,
        response: { 200: TotpEnrollmentResponse, 400: ErrorResponse },
      },
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      const email = request.body.email.trim().toLowerCase();
      const [user] = await app.db
        .select({
          id: schema.users.id,
          passwordHash: schema.users.passwordHash,
          disabled: schema.users.disabled,
        })
        .from(schema.users)
        .where(sql`lower(${schema.users.email}) = ${email}`)
        .limit(1);
      const fallback =
        "$argon2id$v=19$m=19456,t=2,p=1$YWJjZGVmZ2hpamtsbW5vcA$0000000000000000000000000000000000000000000";
      const matches = await verifyPassword(
        user?.passwordHash ?? fallback,
        request.body.password,
      );
      if (!user || user.disabled || !matches) {
        return reply.status(400).send({
          error: {
            category: "VALIDATION",
            message: INVALID_RECOVERY,
            requestId: request.requestId,
          },
        });
      }
      const started = await app.db.transaction(async (tx) => {
        const result = await tx.execute<{
          id: string;
          key_id: string;
          digest: string;
          organization_id: string;
          organization_name: string;
        }>(sql`
          SELECT code.id, code.key_id, code.digest, membership.organization_id,
            organization.name AS organization_name
          FROM mfa_recovery_codes AS code
          JOIN organization_memberships AS membership ON membership.user_id = code.user_id
          JOIN organizations AS organization ON organization.id = membership.organization_id
          WHERE code.user_id = ${user.id} AND code.used_at IS NULL
          FOR UPDATE OF code
        `);
        const matched = result.rows.find((code) =>
          app.config.auth.mfaKeyring.verifyRecoveryCode(
            request.body.recoveryCode,
            code.key_id,
            code.digest,
          ),
        );
        if (!matched) return null;
        const used = await tx
          .update(schema.mfaRecoveryCodes)
          .set({ usedAt: sql`now()` })
          .where(
            and(
              eq(schema.mfaRecoveryCodes.id, matched.id),
              isNull(schema.mfaRecoveryCodes.usedAt),
            ),
          )
          .returning({ id: schema.mfaRecoveryCodes.id });
        if (used.length !== 1) return null;
        await tx
          .delete(schema.mfaRecoveryEnrollments)
          .where(eq(schema.mfaRecoveryEnrollments.userId, user.id));
        const id = uuidv7();
        const token = generateOpaqueToken();
        const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
        const enrollment = createTotpEnrollment(
          matched.organization_name,
          email,
        );
        const envelope = app.config.auth.mfaKeyring.encrypt(
          enrollment.manualSecret,
          `recovery:${id}:${user.id}`,
        );
        await tx.insert(schema.mfaRecoveryEnrollments).values({
          id,
          userId: user.id,
          tokenHash: hashToken(token),
          purpose: "RECOVERY",
          ...envelope,
          expiresAt,
        });
        // Disable the compromised authenticator as soon as recovery begins.
        // Confirmation reactivates this row only after the replacement code
        // has been proved; abandoning recovery therefore fails closed.
        await tx
          .update(schema.totpCredentials)
          .set({ replacedAt: sql`now()` })
          .where(eq(schema.totpCredentials.userId, user.id));
        await tx
          .update(schema.sessions)
          .set({ revokedAt: sql`now()` })
          .where(
            and(
              eq(schema.sessions.userId, user.id),
              isNull(schema.sessions.revokedAt),
            ),
          );
        await tx.insert(schema.securityNotifications).values({
          organizationId: matched.organization_id,
          userId: user.id,
          eventType: "RECOVERY_CODE_USED",
          details: {},
        });
        return { token, expiresAt, enrollment };
      });
      if (!started) {
        return reply.status(400).send({
          error: {
            category: "VALIDATION",
            message: INVALID_RECOVERY,
            requestId: request.requestId,
          },
        });
      }
      return {
        enrollmentToken: started.token,
        provisioningUri: started.enrollment.provisioningUri,
        manualSecret: started.enrollment.manualSecret,
        expiresAt: started.expiresAt,
      };
    },
  );

  app.post(
    "/v1/auth/recovery/confirm",
    {
      schema: {
        body: RecoveryConfirmRequest,
        response: { 200: RecoveryCompleteResponse, 400: ErrorResponse },
      },
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      const outcome = await app.db.transaction(async (tx) => {
        const result = await tx.execute<{
          enrollment_id: string;
          attempt_count: number;
          user_id: string;
          email: string;
          display_name: string;
          role: "ADMIN" | "MEMBER" | "VIEWER";
          user_created_at: string;
          last_login_at: string | null;
          disabled: boolean;
          organization_id: string;
          absolute_hours: number;
          credential_id: string;
          key_id: string;
          nonce: string;
          ciphertext: string;
          auth_tag: string;
        }>(sql`
          SELECT enrollment.id AS enrollment_id, enrollment.attempt_count,
            account.id AS user_id, account.email, account.display_name,
            account.created_at AS user_created_at, account.last_login_at,
            account.disabled, membership.role, membership.organization_id,
            policy.session_absolute_hours AS absolute_hours,
            credential.id AS credential_id, enrollment.key_id, enrollment.nonce,
            enrollment.ciphertext, enrollment.auth_tag
          FROM mfa_recovery_enrollments AS enrollment
          JOIN users AS account ON account.id = enrollment.user_id
          JOIN organization_memberships AS membership ON membership.user_id = account.id
          JOIN organization_security_policies AS policy ON policy.organization_id = membership.organization_id
          JOIN totp_credentials AS credential ON credential.user_id = account.id
          WHERE enrollment.token_hash = ${hashToken(request.body.enrollmentToken)}
            AND enrollment.purpose = 'RECOVERY'
            AND enrollment.consumed_at IS NULL AND enrollment.expires_at > now()
          FOR UPDATE OF enrollment, account, credential
        `);
        const row = result.rows[0];
        if (!row || row.disabled || row.attempt_count >= 5) return null;
        const secret = app.config.auth.mfaKeyring
          .decrypt(
            {
              keyId: row.key_id,
              nonce: row.nonce,
              ciphertext: row.ciphertext,
              authTag: row.auth_tag,
            },
            `recovery:${row.enrollment_id}:${row.user_id}`,
          )
          .toString("utf8");
        const counter = validateTotpAt(secret, request.body.totp, Date.now());
        if (counter === null) {
          await tx
            .update(schema.mfaRecoveryEnrollments)
            .set({ attemptCount: row.attempt_count + 1 })
            .where(eq(schema.mfaRecoveryEnrollments.id, row.enrollment_id));
          return null;
        }
        const credentialEnvelope = app.config.auth.mfaKeyring.encrypt(
          secret,
          `totp:${row.credential_id}:${row.user_id}`,
        );
        await tx
          .update(schema.totpCredentials)
          .set({
            ...credentialEnvelope,
            lastAcceptedCounter: counter,
            replacedAt: null,
            enrolledAt: sql`now()`,
          })
          .where(eq(schema.totpCredentials.id, row.credential_id));
        await tx
          .delete(schema.mfaRecoveryCodes)
          .where(eq(schema.mfaRecoveryCodes.userId, row.user_id));
        const codes = newRecoveryCodes();
        await tx.insert(schema.mfaRecoveryCodes).values(
          codes.map((code) => ({
            userId: row.user_id,
            keyId: app.config.auth.mfaKeyring.activeKeyId,
            digest: app.config.auth.mfaKeyring.digestRecoveryCode(code),
          })),
        );
        await tx
          .update(schema.mfaRecoveryEnrollments)
          .set({ consumedAt: sql`now()` })
          .where(eq(schema.mfaRecoveryEnrollments.id, row.enrollment_id));
        const session = await createSession(
          tx,
          row.user_id,
          row.absolute_hours,
          typeof request.headers["user-agent"] === "string"
            ? request.headers["user-agent"].slice(0, 200)
            : null,
          new Date(),
        );
        await tx.insert(schema.securityNotifications).values({
          organizationId: row.organization_id,
          userId: row.user_id,
          eventType: "TOTP_REPLACED",
          details: {},
        });
        return { row, codes, session };
      });
      if (!outcome) {
        return reply.status(400).send({
          error: {
            category: "VALIDATION",
            message: INVALID_RECOVERY,
            requestId: request.requestId,
          },
        });
      }
      return {
        token: outcome.session.token,
        expiresAt: outcome.session.expiresAt,
        recoveryCodes: outcome.codes,
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
}
