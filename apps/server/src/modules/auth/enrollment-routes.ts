import { randomBytes } from "node:crypto";

import type { AppInstance } from "../../http/app-instance.js";
import { eq, sql } from "drizzle-orm";

import {
  ConfirmInviteEnrollmentRequest,
  ErrorResponse,
  InviteInspection,
  InviteTokenRequest,
  RecoveryCodeBundle,
  StartInviteEnrollmentRequest,
  TotpEnrollmentResponse,
} from "@codevault/contracts";
import { generateOpaqueToken, uuidv7 } from "@codevault/core/crypto";
import { schema } from "@codevault/db";

import { hashPassword, WeakPasswordError } from "../../auth/password.js";
import { hashToken } from "../../auth/tokens.js";
import { createTotpEnrollment, validateTotpAt } from "../../auth/totp.js";
import {
  assertWebpDerivative,
  digestMatches,
  sha256Hex,
} from "../avatars/service.js";

const INVALID_INVITATION = "The invitation is invalid or has expired.";
const INVALID_ENROLLMENT = "The enrollment is invalid or has expired.";

function recoveryCodes(): string[] {
  return Array.from({ length: 10 }, () =>
    randomBytes(16).toString("base64url"),
  );
}

export async function registerEnrollmentRoutes(
  app: AppInstance,
): Promise<void> {
  app.post(
    "/v1/invitations/inspect",
    {
      schema: {
        body: InviteTokenRequest,
        response: { 200: InviteInspection, 400: ErrorResponse },
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const result = await app.db.execute<{
        organization_id: string;
        organization_name: string;
        avatar_id: string | null;
        avatar_object_key: string | null;
        avatar_sha256: string | null;
        email: string;
        role: "ADMIN" | "MEMBER" | "VIEWER";
        expires_at: string;
      }>(sql`
        SELECT organization.id AS organization_id,
          organization.name AS organization_name, invitation.email,
          invitation.role, invitation.expires_at, avatar.id AS avatar_id,
          avatar.sanitized_object_key AS avatar_object_key,
          avatar.sanitized_sha256 AS avatar_sha256
        FROM invites AS invitation
        JOIN organizations AS organization ON organization.id = invitation.organization_id
        LEFT JOIN avatar_images AS avatar
          ON avatar.target_organization_id = organization.id
          AND avatar.status = 'READY'
        WHERE invitation.token_hash = ${hashToken(request.body.token)}
          AND invitation.revoked_at IS NULL AND invitation.accepted_at IS NULL
          AND invitation.expires_at > now()
      `);
      const row = result.rows[0];
      if (!row) {
        return reply.status(400).send({
          error: {
            category: "VALIDATION",
            message: INVALID_INVITATION,
            requestId: request.requestId,
          },
        });
      }
      let organizationAvatarDataUrl: string | null = null;
      if (row.avatar_object_key !== null && row.avatar_sha256 !== null) {
        try {
          const bytes = await app.storage.getObject(row.avatar_object_key);
          assertWebpDerivative(bytes);
          if (digestMatches(sha256Hex(bytes), row.avatar_sha256)) {
            organizationAvatarDataUrl = `data:image/webp;base64,${Buffer.from(bytes).toString("base64")}`;
          }
        } catch {
          // Organization branding is optional during enrollment. A missing or
          // corrupt derivative must not invalidate an otherwise valid invite.
        }
      }
      return {
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        organizationAvatarId: row.avatar_id,
        organizationAvatarDataUrl,
        email: row.email,
        role: row.role,
        expiresAt: row.expires_at,
      };
    },
  );

  app.post(
    "/v1/invitations/enrollment/start",
    {
      schema: {
        body: StartInviteEnrollmentRequest,
        response: { 200: TotpEnrollmentResponse, 400: ErrorResponse },
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      let passwordHash: string;
      try {
        passwordHash = await hashPassword(request.body.password);
      } catch (error) {
        if (error instanceof WeakPasswordError) {
          return reply.status(400).send({
            error: {
              category: "VALIDATION",
              message: error.message,
              requestId: request.requestId,
            },
          });
        }
        throw error;
      }
      const started = await app.db.transaction(async (tx) => {
        const result = await tx.execute<{
          id: string;
          organization_id: string;
          organization_name: string;
          email: string;
          expires_at: string;
        }>(sql`
          SELECT invitation.id, invitation.organization_id,
            organization.name AS organization_name, invitation.email,
            invitation.expires_at
          FROM invites AS invitation
          JOIN organizations AS organization ON organization.id = invitation.organization_id
          WHERE invitation.token_hash = ${hashToken(request.body.token)}
            AND invitation.revoked_at IS NULL AND invitation.accepted_at IS NULL
            AND invitation.expires_at > now()
          FOR UPDATE OF invitation
        `);
        const invitation = result.rows[0];
        if (!invitation) return null;
        const existing = await tx.execute(sql`
          SELECT 1 FROM users WHERE lower(email) = lower(${invitation.email}) LIMIT 1
        `);
        if (existing.rows.length > 0) return null;
        await tx
          .delete(schema.inviteEnrollments)
          .where(eq(schema.inviteEnrollments.inviteId, invitation.id));
        const id = uuidv7();
        const token = generateOpaqueToken();
        const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
        const enrollment = createTotpEnrollment(
          invitation.organization_name,
          invitation.email,
        );
        const envelope = app.config.auth.mfaKeyring.encrypt(
          enrollment.manualSecret,
          `enrollment:${id}:${invitation.id}`,
        );
        await tx.insert(schema.inviteEnrollments).values({
          id,
          inviteId: invitation.id,
          tokenHash: hashToken(token),
          displayName: request.body.displayName,
          passwordHash,
          ...envelope,
          expiresAt,
        });
        return { token, expiresAt, enrollment };
      });
      if (!started) {
        return reply.status(400).send({
          error: {
            category: "VALIDATION",
            message: INVALID_INVITATION,
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
    "/v1/invitations/enrollment/confirm",
    {
      schema: {
        body: ConfirmInviteEnrollmentRequest,
        response: { 200: RecoveryCodeBundle, 400: ErrorResponse },
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const outcome = await app.db.transaction(async (tx) => {
        const result = await tx.execute<{
          id: string;
          invite_id: string;
          organization_id: string;
          email: string;
          role: "ADMIN" | "MEMBER" | "VIEWER";
          display_name: string;
          password_hash: string;
          key_id: string;
          nonce: string;
          ciphertext: string;
          auth_tag: string;
          attempt_count: number;
          consumed_at: string | null;
        }>(sql`
          SELECT enrollment.id, enrollment.invite_id, invitation.organization_id,
            invitation.email, invitation.role, enrollment.display_name,
            enrollment.password_hash, enrollment.key_id, enrollment.nonce,
            enrollment.ciphertext, enrollment.auth_tag, enrollment.attempt_count,
            enrollment.consumed_at
          FROM invite_enrollments AS enrollment
          JOIN invites AS invitation ON invitation.id = enrollment.invite_id
          WHERE enrollment.token_hash = ${hashToken(request.body.enrollmentToken)}
            AND enrollment.expires_at > now() AND invitation.expires_at > now()
            AND invitation.revoked_at IS NULL AND invitation.accepted_at IS NULL
          FOR UPDATE OF enrollment, invitation
        `);
        const row = result.rows[0];
        if (!row || row.consumed_at || row.attempt_count >= 5) return null;
        const secret = app.config.auth.mfaKeyring
          .decrypt(
            {
              keyId: row.key_id,
              nonce: row.nonce,
              ciphertext: row.ciphertext,
              authTag: row.auth_tag,
            },
            `enrollment:${row.id}:${row.invite_id}`,
          )
          .toString("utf8");
        const counter = validateTotpAt(secret, request.body.totp, Date.now());
        if (counter === null) {
          await tx
            .update(schema.inviteEnrollments)
            .set({
              attemptCount: row.attempt_count + 1,
              ...(row.attempt_count + 1 >= 5 ? { consumedAt: sql`now()` } : {}),
            })
            .where(eq(schema.inviteEnrollments.id, row.id));
          return null;
        }
        const userId = uuidv7();
        const credentialId = uuidv7();
        const codes = recoveryCodes();
        const credentialEnvelope = app.config.auth.mfaKeyring.encrypt(
          secret,
          `totp:${credentialId}:${userId}`,
        );
        await tx.insert(schema.users).values({
          id: userId,
          email: row.email,
          displayName: row.display_name,
          passwordHash: row.password_hash,
        });
        await tx.insert(schema.organizationMemberships).values({
          organizationId: row.organization_id,
          userId,
          role: row.role,
        });
        await tx.insert(schema.totpCredentials).values({
          id: credentialId,
          userId,
          ...credentialEnvelope,
          lastAcceptedCounter: counter,
        });
        await tx.insert(schema.mfaRecoveryCodes).values(
          codes.map((code) => ({
            userId,
            keyId: app.config.auth.mfaKeyring.activeKeyId,
            digest: app.config.auth.mfaKeyring.digestRecoveryCode(code),
          })),
        );
        await tx
          .update(schema.invites)
          .set({ acceptedAt: sql`now()`, acceptedByUserId: userId })
          .where(eq(schema.invites.id, row.invite_id));
        await tx
          .update(schema.inviteEnrollments)
          .set({ consumedAt: sql`now()` })
          .where(eq(schema.inviteEnrollments.id, row.id));
        await tx.insert(schema.auditEvents).values({
          organizationId: row.organization_id,
          actorId: userId,
          action: "user.enrolled",
          entityType: "user",
          entityId: userId,
          after: { role: row.role, via: "invitation" },
        });
        return codes;
      });
      if (!outcome) {
        return reply.status(400).send({
          error: {
            category: "VALIDATION",
            message: INVALID_ENROLLMENT,
            requestId: request.requestId,
          },
        });
      }
      return { recoveryCodes: outcome };
    },
  );
}
