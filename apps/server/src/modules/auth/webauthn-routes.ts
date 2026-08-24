import { and, eq, isNull, sql } from "drizzle-orm";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { Type } from "@sinclair/typebox";

import {
  CompleteWebAuthnLoginRequest,
  CompleteWebAuthnRegistrationRequest,
  ErrorResponse,
  LoginResponse,
  OkResponse,
  StartWebAuthnLoginRequest,
  StartWebAuthnRegistrationRequest,
  WebAuthnCeremonyOptions,
  WebAuthnCredentialList,
  WebAuthnCredentialSummary,
} from "@codevault/contracts";
import { generateOpaqueToken } from "@codevault/core/crypto";
import { schema } from "@codevault/db";

import type { AppInstance } from "../../http/app-instance.js";
import { createSession } from "../../auth/session.js";
import { hashToken } from "../../auth/tokens.js";
import {
  clearFailedAttempts,
  reserveLoginAttempt,
} from "../../auth/login-throttle.js";
import {
  requireInteractiveSession,
  requireRecentMfa,
} from "../../http/guards.js";

const INVALID_SECURITY_KEY = "The security key was not accepted.";
const CEREMONY_TTL_MS = 5 * 60_000;

const ceremonyHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>CodeVault security key</title><style>
:root{color-scheme:dark}body{margin:0;display:grid;min-height:100vh;place-items:center;background:#111417;color:#e9eef2;font:14px system-ui,sans-serif}.card{max-width:360px;padding:24px;border:1px solid #30383e;border-radius:12px;background:#181d21}h1{font-size:17px;margin:0 0 8px}p{margin:0;color:#a9b4bc;line-height:1.5}
</style></head><body><main class="card"><h1>Use your security key</h1><p>Insert or tap your YubiKey, then follow the system prompt. You can close this window to cancel.</p></main>
<script>
const fromBase64URL = value => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
};
const toBase64URL = value => {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/g, '');
};
const common = credential => ({
  id: credential.id,
  rawId: toBase64URL(credential.rawId),
  type: credential.type,
  authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
  clientExtensionResults: credential.getClientExtensionResults(),
});
window.codevaultWebAuthn = {
  async register(options) {
    if (!window.PublicKeyCredential) throw new Error('WebAuthn is unavailable on this workstation.');
    const publicKey = {
      ...options,
      challenge: fromBase64URL(options.challenge),
      user: {...options.user, id: fromBase64URL(options.user.id)},
      excludeCredentials: (options.excludeCredentials ?? []).map(item => ({...item, id: fromBase64URL(item.id)})),
    };
    const credential = await navigator.credentials.create({publicKey});
    if (!(credential instanceof PublicKeyCredential)) throw new Error('No security-key credential was created.');
    return {...common(credential), response: {
      clientDataJSON: toBase64URL(credential.response.clientDataJSON),
      attestationObject: toBase64URL(credential.response.attestationObject),
      transports: credential.response.getTransports?.() ?? [],
      publicKeyAlgorithm: credential.response.getPublicKeyAlgorithm?.(),
      publicKey: credential.response.getPublicKey?.() ? toBase64URL(credential.response.getPublicKey()) : undefined,
      authenticatorData: credential.response.getAuthenticatorData?.() ? toBase64URL(credential.response.getAuthenticatorData()) : undefined,
    }};
  },
  async authenticate(options) {
    if (!window.PublicKeyCredential) throw new Error('WebAuthn is unavailable on this workstation.');
    const publicKey = {
      ...options,
      challenge: fromBase64URL(options.challenge),
      allowCredentials: (options.allowCredentials ?? []).map(item => ({...item, id: fromBase64URL(item.id)})),
    };
    const credential = await navigator.credentials.get({publicKey});
    if (!(credential instanceof PublicKeyCredential)) throw new Error('No security-key assertion was created.');
    return {...common(credential), response: {
      clientDataJSON: toBase64URL(credential.response.clientDataJSON),
      authenticatorData: toBase64URL(credential.response.authenticatorData),
      signature: toBase64URL(credential.response.signature),
      userHandle: credential.response.userHandle ? toBase64URL(credential.response.userHandle) : undefined,
    }};
  },
};
</script></body></html>`;

function expiresAt(): string {
  return new Date(Date.now() + CEREMONY_TTL_MS).toISOString();
}

function publicKeyToText(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function publicKeyFromText(value: string): Uint8Array<ArrayBuffer> {
  const encoded = Buffer.from(value, "base64url");
  const copy = new Uint8Array(new ArrayBuffer(encoded.length));
  copy.set(encoded);
  return copy;
}

export async function registerWebAuthnRoutes(app: AppInstance): Promise<void> {
  app.get("/v1/auth/webauthn/ceremony", async (_request, reply) =>
    reply
      .header("content-type", "text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff")
      .header(
        "content-security-policy",
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      )
      .send(ceremonyHtml),
  );

  app.post(
    "/v1/auth/webauthn/login/options",
    {
      schema: {
        body: StartWebAuthnLoginRequest,
        response: { 200: WebAuthnCeremonyOptions, 400: ErrorResponse },
      },
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      const result = await app.db.execute<{
        challenge_id: string;
        user_id: string;
      }>(sql`
        SELECT challenge.id AS challenge_id, challenge.user_id
        FROM mfa_challenges AS challenge
        JOIN users AS account ON account.id = challenge.user_id
        WHERE challenge.token_hash = ${hashToken(request.body.challengeToken)}
          AND challenge.source_key = ${request.ip}
          AND challenge.purpose = 'LOGIN' AND challenge.consumed_at IS NULL
          AND challenge.expires_at > now() AND account.disabled = false
        LIMIT 1
      `);
      const login = result.rows[0];
      if (!login) {
        return reply.status(400).send({
          error: {
            category: "VALIDATION",
            message: INVALID_SECURITY_KEY,
            requestId: request.requestId,
          },
        });
      }
      const credentials = await app.db
        .select({
          id: schema.webauthnCredentials.credentialId,
          transports: schema.webauthnCredentials.transports,
        })
        .from(schema.webauthnCredentials)
        .where(
          and(
            eq(schema.webauthnCredentials.userId, login.user_id),
            isNull(schema.webauthnCredentials.revokedAt),
          ),
        );
      if (credentials.length === 0) {
        return reply.status(400).send({
          error: {
            category: "VALIDATION",
            message: INVALID_SECURITY_KEY,
            requestId: request.requestId,
          },
        });
      }
      const options = await generateAuthenticationOptions({
        rpID: app.config.auth.webauthn.rpId,
        timeout: app.config.auth.webauthn.timeoutMs,
        userVerification: "preferred",
        allowCredentials: credentials.map((credential) => ({
          id: credential.id,
          transports: credential.transports as AuthenticatorTransportFuture[],
        })),
      });
      const ceremonyToken = generateOpaqueToken();
      await app.db.insert(schema.webauthnCeremonies).values({
        userId: login.user_id,
        purpose: "LOGIN",
        tokenHash: hashToken(ceremonyToken),
        challenge: options.challenge,
        sourceKey: request.ip,
        mfaChallengeId: login.challenge_id,
        expiresAt: expiresAt(),
      });
      return { ceremonyToken, options };
    },
  );

  app.post(
    "/v1/auth/webauthn/login/complete",
    {
      schema: {
        body: CompleteWebAuthnLoginRequest,
        response: {
          200: LoginResponse,
          400: ErrorResponse,
          429: ErrorResponse,
        },
      },
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      const identity = await app.db.execute<{ email: string }>(sql`
        SELECT account.email FROM webauthn_ceremonies AS ceremony
        JOIN users AS account ON account.id = ceremony.user_id
        WHERE ceremony.token_hash = ${hashToken(request.body.ceremonyToken)}
          AND ceremony.source_key = ${request.ip}
          AND ceremony.consumed_at IS NULL AND ceremony.expires_at > now()
        LIMIT 1
      `);
      const email = identity.rows[0]?.email;
      if (email) {
        const throttle = await reserveLoginAttempt(
          app.db,
          email,
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
      }

      const outcome = await app.db.transaction(async (tx) => {
        const result = await tx.execute<{
          ceremony_id: string;
          ceremony_challenge: string;
          ceremony_attempt_count: number;
          mfa_challenge_id: string;
          user_id: string;
          email: string;
          display_name: string;
          role: "ADMIN" | "MEMBER" | "VIEWER";
          user_created_at: string;
          last_login_at: string | null;
          absolute_hours: number;
          credential_row_id: string;
          credential_id: string;
          public_key: string;
          counter: number;
          transports: AuthenticatorTransportFuture[];
        }>(sql`
          SELECT ceremony.id AS ceremony_id,
            ceremony.challenge AS ceremony_challenge,
            ceremony.attempt_count AS ceremony_attempt_count,
            challenge.id AS mfa_challenge_id, account.id AS user_id,
            account.email, account.display_name, membership.role,
            account.created_at AS user_created_at, account.last_login_at,
            policy.session_absolute_hours AS absolute_hours,
            credential.id AS credential_row_id,
            credential.credential_id, credential.public_key,
            credential.counter, credential.transports
          FROM webauthn_ceremonies AS ceremony
          JOIN mfa_challenges AS challenge ON challenge.id = ceremony.mfa_challenge_id
          JOIN users AS account ON account.id = ceremony.user_id
          JOIN organization_memberships AS membership ON membership.user_id = account.id
          JOIN organization_security_policies AS policy ON policy.organization_id = membership.organization_id
          JOIN webauthn_credentials AS credential
            ON credential.user_id = account.id
            AND credential.credential_id = ${request.body.response.id}
            AND credential.revoked_at IS NULL
          WHERE ceremony.token_hash = ${hashToken(request.body.ceremonyToken)}
            AND ceremony.source_key = ${request.ip}
            AND ceremony.purpose = 'LOGIN' AND ceremony.consumed_at IS NULL
            AND ceremony.expires_at > now() AND ceremony.attempt_count < 5
            AND challenge.purpose = 'LOGIN' AND challenge.consumed_at IS NULL
            AND challenge.expires_at > now() AND account.disabled = false
          FOR UPDATE OF ceremony, challenge, account, credential
        `);
        const row = result.rows[0];
        if (!row) return null;
        try {
          const verification = await verifyAuthenticationResponse({
            response: request.body.response as AuthenticationResponseJSON,
            expectedChallenge: row.ceremony_challenge,
            expectedOrigin: app.config.auth.webauthn.origin,
            expectedRPID: app.config.auth.webauthn.rpId,
            requireUserVerification: false,
            credential: {
              id: row.credential_id,
              publicKey: publicKeyFromText(row.public_key),
              counter: Number(row.counter),
              transports: row.transports,
            },
          });
          if (!verification.verified) throw new Error("not verified");
          await tx
            .update(schema.webauthnCredentials)
            .set({
              counter: verification.authenticationInfo.newCounter,
              backedUp: verification.authenticationInfo.credentialBackedUp,
              deviceType: verification.authenticationInfo.credentialDeviceType,
              lastUsedAt: sql`now()`,
            })
            .where(eq(schema.webauthnCredentials.id, row.credential_row_id));
          await tx
            .update(schema.webauthnCeremonies)
            .set({ consumedAt: sql`now()` })
            .where(eq(schema.webauthnCeremonies.id, row.ceremony_id));
          await tx
            .update(schema.mfaChallenges)
            .set({ consumedAt: sql`now()` })
            .where(eq(schema.mfaChallenges.id, row.mfa_challenge_id));
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
            "WEBAUTHN",
          );
          await tx
            .update(schema.users)
            .set({ lastLoginAt: sql`now()` })
            .where(eq(schema.users.id, row.user_id));
          return { row, session };
        } catch {
          await tx
            .update(schema.webauthnCeremonies)
            .set({ attemptCount: row.ceremony_attempt_count + 1 })
            .where(eq(schema.webauthnCeremonies.id, row.ceremony_id));
          return null;
        }
      });
      if (!outcome) {
        return reply.status(400).send({
          error: {
            category: "VALIDATION",
            message: INVALID_SECURITY_KEY,
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

  app.get(
    "/v1/settings/security-keys",
    { schema: { response: { 200: WebAuthnCredentialList } } },
    async (request) => {
      const principal = requireInteractiveSession(request);
      const items = await app.db
        .select({
          id: schema.webauthnCredentials.id,
          name: schema.webauthnCredentials.name,
          transports: schema.webauthnCredentials.transports,
          deviceType: schema.webauthnCredentials.deviceType,
          backedUp: schema.webauthnCredentials.backedUp,
          createdAt: schema.webauthnCredentials.createdAt,
          lastUsedAt: schema.webauthnCredentials.lastUsedAt,
        })
        .from(schema.webauthnCredentials)
        .where(
          and(
            eq(schema.webauthnCredentials.userId, principal.user.id),
            isNull(schema.webauthnCredentials.revokedAt),
          ),
        )
        .orderBy(schema.webauthnCredentials.createdAt);
      return { items };
    },
  );

  app.post(
    "/v1/settings/security-keys/options",
    {
      schema: {
        body: StartWebAuthnRegistrationRequest,
        response: { 200: WebAuthnCeremonyOptions },
      },
      config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    },
    async (request) => {
      const principal = requireInteractiveSession(request);
      requireRecentMfa(request);
      const credentials = await app.db
        .select({
          id: schema.webauthnCredentials.credentialId,
          transports: schema.webauthnCredentials.transports,
        })
        .from(schema.webauthnCredentials)
        .where(
          and(
            eq(schema.webauthnCredentials.userId, principal.user.id),
            isNull(schema.webauthnCredentials.revokedAt),
          ),
        );
      const options = await generateRegistrationOptions({
        rpName: app.config.auth.webauthn.rpName,
        rpID: app.config.auth.webauthn.rpId,
        userID: Buffer.from(principal.user.id, "utf8"),
        userName: principal.user.email,
        userDisplayName: principal.user.displayName,
        timeout: app.config.auth.webauthn.timeoutMs,
        attestationType: "none",
        preferredAuthenticatorType: "securityKey",
        authenticatorSelection: {
          authenticatorAttachment: "cross-platform",
          residentKey: "discouraged",
          userVerification: "preferred",
        },
        excludeCredentials: credentials.map((credential) => ({
          id: credential.id,
          transports: credential.transports as AuthenticatorTransportFuture[],
        })),
      });
      const ceremonyToken = generateOpaqueToken();
      await app.db.insert(schema.webauthnCeremonies).values({
        userId: principal.user.id,
        purpose: "REGISTRATION",
        tokenHash: hashToken(ceremonyToken),
        challenge: options.challenge,
        sourceKey: request.ip,
        sessionId: principal.session.id,
        expiresAt: expiresAt(),
      });
      return { ceremonyToken, options };
    },
  );

  app.post(
    "/v1/settings/security-keys/complete",
    {
      schema: {
        body: CompleteWebAuthnRegistrationRequest,
        response: { 200: WebAuthnCredentialSummary, 400: ErrorResponse },
      },
      config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const principal = requireInteractiveSession(request);
      requireRecentMfa(request);
      const created = await app.db.transaction(async (tx) => {
        const result = await tx.execute<{
          id: string;
          challenge: string;
          attempt_count: number;
        }>(sql`
          SELECT id, challenge, attempt_count FROM webauthn_ceremonies
          WHERE token_hash = ${hashToken(request.body.ceremonyToken)}
            AND user_id = ${principal.user.id}
            AND session_id = ${principal.session.id}
            AND source_key = ${request.ip}
            AND purpose = 'REGISTRATION' AND consumed_at IS NULL
            AND expires_at > now() AND attempt_count < 5
          FOR UPDATE
        `);
        const ceremony = result.rows[0];
        if (!ceremony) return null;
        try {
          const verification = await verifyRegistrationResponse({
            response: request.body.response as RegistrationResponseJSON,
            expectedChallenge: ceremony.challenge,
            expectedOrigin: app.config.auth.webauthn.origin,
            expectedRPID: app.config.auth.webauthn.rpId,
            requireUserVerification: false,
          });
          if (!verification.verified) throw new Error("not verified");
          const info = verification.registrationInfo;
          const [credential] = await tx
            .insert(schema.webauthnCredentials)
            .values({
              userId: principal.user.id,
              credentialId: info.credential.id,
              publicKey: publicKeyToText(info.credential.publicKey),
              counter: info.credential.counter,
              transports: info.credential.transports ?? [],
              deviceType: info.credentialDeviceType,
              backedUp: info.credentialBackedUp,
              name: request.body.name.trim(),
            })
            .onConflictDoNothing({
              target: schema.webauthnCredentials.credentialId,
            })
            .returning({
              id: schema.webauthnCredentials.id,
              name: schema.webauthnCredentials.name,
              transports: schema.webauthnCredentials.transports,
              deviceType: schema.webauthnCredentials.deviceType,
              backedUp: schema.webauthnCredentials.backedUp,
              createdAt: schema.webauthnCredentials.createdAt,
              lastUsedAt: schema.webauthnCredentials.lastUsedAt,
            });
          if (!credential) throw new Error("credential already registered");
          await tx
            .update(schema.webauthnCeremonies)
            .set({ consumedAt: sql`now()` })
            .where(eq(schema.webauthnCeremonies.id, ceremony.id));
          return credential;
        } catch {
          await tx
            .update(schema.webauthnCeremonies)
            .set({ attemptCount: ceremony.attempt_count + 1 })
            .where(eq(schema.webauthnCeremonies.id, ceremony.id));
          return null;
        }
      });
      if (!created) {
        return reply.status(400).send({
          error: {
            category: "VALIDATION",
            message: INVALID_SECURITY_KEY,
            requestId: request.requestId,
          },
        });
      }
      await app.audit.write(
        app.db,
        {
          organizationId: principal.organization.id,
          actorId: principal.user.id,
          sessionId: principal.session.id,
          requestId: request.requestId,
        },
        {
          action: "auth.webauthn_credential_created",
          entityType: "webauthn_credential",
          entityId: created.id,
          after: { name: created.name, transports: created.transports },
        },
      );
      return created;
    },
  );

  app.delete(
    "/v1/settings/security-keys/:id",
    {
      schema: {
        params: Type.Object({ id: Type.String({ format: "uuid" }) }),
        response: { 200: OkResponse },
      },
    },
    async (request) => {
      const principal = requireInteractiveSession(request);
      requireRecentMfa(request);
      const [revoked] = await app.db
        .update(schema.webauthnCredentials)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(schema.webauthnCredentials.id, request.params.id),
            eq(schema.webauthnCredentials.userId, principal.user.id),
            isNull(schema.webauthnCredentials.revokedAt),
          ),
        )
        .returning({
          id: schema.webauthnCredentials.id,
          name: schema.webauthnCredentials.name,
        });
      if (revoked) {
        await app.audit.write(
          app.db,
          {
            organizationId: principal.organization.id,
            actorId: principal.user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "auth.webauthn_credential_revoked",
            entityType: "webauthn_credential",
            entityId: revoked.id,
            before: { name: revoked.name },
          },
        );
      }
      return { ok: true as const };
    },
  );
}
