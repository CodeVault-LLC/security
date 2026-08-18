import { randomBytes } from "node:crypto";

import type { AppInstance } from "../../http/app-instance.js";
import { eq, sql } from "drizzle-orm";

import {
  ConfirmMigratedEnrollmentRequest,
  ErrorResponse,
  RecoveryCodeBundle,
  StartMigratedEnrollmentRequest,
  TotpEnrollmentResponse,
} from "@codevault/contracts";
import { generateOpaqueToken, uuidv7 } from "@codevault/core/crypto";
import { schema } from "@codevault/db";

import { hashToken } from "../../auth/tokens.js";
import { createTotpEnrollment, validateTotpAt } from "../../auth/totp.js";

const INVALID_ENROLLMENT = "The enrollment request was not accepted.";

function recoveryCodes(): string[] {
  return Array.from({ length: 10 }, () =>
    randomBytes(16).toString("base64url"),
  );
}

/** One-time MFA enrollment for accounts that predate mandatory MFA. */
export async function registerMigratedEnrollmentRoutes(
  app: AppInstance,
): Promise<void> {
  app.post(
    "/v1/auth/enrollment/start",
    {
      schema: {
        body: StartMigratedEnrollmentRequest,
        response: { 200: TotpEnrollmentResponse, 400: ErrorResponse },
      },
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      const started = await app.db.transaction(async (tx) => {
        const result = await tx.execute<{
          challenge_id: string;
          user_id: string;
          email: string;
          organization_name: string;
          disabled: boolean;
        }>(sql`
          SELECT challenge.id AS challenge_id, account.id AS user_id,
            account.email, account.disabled, organization.name AS organization_name
          FROM mfa_challenges AS challenge
          JOIN users AS account ON account.id = challenge.user_id
          JOIN organization_memberships AS membership ON membership.user_id = account.id
          JOIN organizations AS organization ON organization.id = membership.organization_id
          LEFT JOIN totp_credentials AS credential ON credential.user_id = account.id
          WHERE challenge.token_hash = ${hashToken(request.body.challengeToken)}
            AND challenge.source_key = ${request.ip}
            AND challenge.purpose = 'MIGRATED_ENROLLMENT'
            AND challenge.consumed_at IS NULL AND challenge.expires_at > now()
            AND credential.id IS NULL
          FOR UPDATE OF challenge, account
        `);
        const row = result.rows[0];
        if (!row || row.disabled) return null;

        await tx
          .update(schema.mfaChallenges)
          .set({ consumedAt: sql`now()` })
          .where(eq(schema.mfaChallenges.id, row.challenge_id));
        await tx
          .delete(schema.mfaRecoveryEnrollments)
          .where(eq(schema.mfaRecoveryEnrollments.userId, row.user_id));

        const id = uuidv7();
        const token = generateOpaqueToken();
        const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
        const enrollment = createTotpEnrollment(
          row.organization_name,
          row.email,
        );
        const envelope = app.config.auth.mfaKeyring.encrypt(
          enrollment.manualSecret,
          `migration:${id}:${row.user_id}`,
        );
        await tx.insert(schema.mfaRecoveryEnrollments).values({
          id,
          userId: row.user_id,
          tokenHash: hashToken(token),
          purpose: "MIGRATED_ENROLLMENT",
          ...envelope,
          expiresAt,
        });
        return { token, expiresAt, enrollment };
      });

      if (!started) {
        return reply.status(400).send({
          error: {
            category: "VALIDATION",
            message: INVALID_ENROLLMENT,
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
    "/v1/auth/enrollment/confirm",
    {
      schema: {
        body: ConfirmMigratedEnrollmentRequest,
        response: { 200: RecoveryCodeBundle, 400: ErrorResponse },
      },
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      const codes = await app.db.transaction(async (tx) => {
        const result = await tx.execute<{
          enrollment_id: string;
          user_id: string;
          attempt_count: number;
          key_id: string;
          nonce: string;
          ciphertext: string;
          auth_tag: string;
          disabled: boolean;
          organization_id: string;
        }>(sql`
          SELECT enrollment.id AS enrollment_id, enrollment.user_id,
            enrollment.attempt_count, enrollment.key_id, enrollment.nonce,
            enrollment.ciphertext, enrollment.auth_tag, account.disabled,
            membership.organization_id
          FROM mfa_recovery_enrollments AS enrollment
          JOIN users AS account ON account.id = enrollment.user_id
          JOIN organization_memberships AS membership ON membership.user_id = account.id
          LEFT JOIN totp_credentials AS credential ON credential.user_id = account.id
          WHERE enrollment.token_hash = ${hashToken(request.body.enrollmentToken)}
            AND enrollment.purpose = 'MIGRATED_ENROLLMENT'
            AND enrollment.consumed_at IS NULL AND enrollment.expires_at > now()
            AND credential.id IS NULL
          FOR UPDATE OF enrollment, account
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
            `migration:${row.enrollment_id}:${row.user_id}`,
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

        const credentialId = uuidv7();
        const envelope = app.config.auth.mfaKeyring.encrypt(
          secret,
          `totp:${credentialId}:${row.user_id}`,
        );
        await tx.insert(schema.totpCredentials).values({
          id: credentialId,
          userId: row.user_id,
          ...envelope,
          lastAcceptedCounter: counter,
        });
        const generated = recoveryCodes();
        await tx.insert(schema.mfaRecoveryCodes).values(
          generated.map((code) => ({
            userId: row.user_id,
            keyId: app.config.auth.mfaKeyring.activeKeyId,
            digest: app.config.auth.mfaKeyring.digestRecoveryCode(code),
          })),
        );
        await tx
          .update(schema.mfaRecoveryEnrollments)
          .set({ consumedAt: sql`now()` })
          .where(eq(schema.mfaRecoveryEnrollments.id, row.enrollment_id));
        await tx.insert(schema.auditEvents).values({
          organizationId: row.organization_id,
          action: "mfa.migrated_enrollment_completed",
          entityType: "user",
          entityId: row.user_id,
          actorId: row.user_id,
          after: { method: "TOTP" },
        });
        return generated;
      });

      if (!codes) {
        return reply.status(400).send({
          error: {
            category: "VALIDATION",
            message: INVALID_ENROLLMENT,
            requestId: request.requestId,
          },
        });
      }
      return { recoveryCodes: codes };
    },
  );
}
