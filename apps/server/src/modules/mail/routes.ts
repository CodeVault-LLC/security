import { and, eq, gt, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { Type } from "@sinclair/typebox";
import { createHmac } from "node:crypto";

import {
  ErrorResponse,
  GmailAuthorization,
  MailboxConnection,
  StartGmailConnectionRequest,
  Uuid,
} from "@codevault/contracts";
import { DomainError } from "@codevault/core";
import { uuidv7 } from "@codevault/core/crypto";
import { schema } from "@codevault/db";

import type { AppInstance } from "../../http/app-instance.js";
import { actingUser, principalOf } from "../../http/guards.js";
import {
  buildGmailAuthorizationUrl,
  createPkce,
  gmailScopes,
} from "./gmail-oauth.js";
import { decryptSecret, encryptSecret } from "./token-crypto.js";
import {
  decodePubSubNotification,
  verifyGooglePushToken,
} from "./gmail-notifications.js";

const ConnectionList = Type.Object({ items: Type.Array(MailboxConnection) });
const CallbackQuery = Type.Object({
  code: Type.String({ minLength: 1, maxLength: 4_096 }),
  state: Uuid,
});
const ConnectionParam = Type.Object({ id: Uuid });
const PubSubEnvelope = Type.Object(
  {
    message: Type.Object(
      {
        messageId: Type.String({ minLength: 1, maxLength: 500 }),
        data: Type.String({ minLength: 1, maxLength: 8_192 }),
      },
      { additionalProperties: true },
    ),
    subscription: Type.Optional(Type.String({ maxLength: 1_000 })),
  },
  { additionalProperties: true },
);

function connectionView(row: typeof schema.mailboxConnections.$inferSelect) {
  return {
    id: row.id,
    provider: row.provider,
    emailAddress: row.emailAddress,
    status: row.status,
    capabilities: row.capabilities,
    lastSuccessfulSyncAt: row.lastSuccessfulSyncAt,
    watchExpiresAt: row.watchExpiresAt,
    errorCategory: row.lastErrorCategory,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revision: row.revision,
  };
}

function gmailConfig(app: AppInstance) {
  if (!app.config.gmail.enabled) {
    throw new DomainError(
      "PROVIDER_UNAVAILABLE",
      "Gmail integration is disabled.",
    );
  }
  return app.config.gmail;
}

export async function registerMailRoutes(app: AppInstance): Promise<void> {
  app.post(
    "/v1/mail/gmail/pubsub",
    {
      schema: { body: PubSubEnvelope },
      config: { rateLimit: { max: 1_000, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const config = gmailConfig(app);
      if (config.pubsub === null) {
        throw new DomainError(
          "PROVIDER_UNAVAILABLE",
          "Gmail push notifications are disabled.",
        );
      }
      const authorization = request.headers.authorization;
      if (authorization === undefined || !authorization.startsWith("Bearer ")) {
        throw new DomainError(
          "PERMISSION_DENIED",
          "A verified Pub/Sub identity is required.",
        );
      }
      try {
        await verifyGooglePushToken(authorization.slice(7), {
          audience: config.pubsub.audience,
          serviceAccountEmail: config.pubsub.serviceAccountEmail,
        });
      } catch {
        throw new DomainError(
          "PERMISSION_DENIED",
          "The Pub/Sub identity could not be verified.",
        );
      }
      const notification = decodePubSubNotification(request.body);
      const [connection] = await app.db
        .select()
        .from(schema.mailboxConnections)
        .where(
          and(
            eq(schema.mailboxConnections.provider, "gmail"),
            eq(schema.mailboxConnections.status, "ACTIVE"),
            sql`lower(${schema.mailboxConnections.emailAddress}) = ${notification.emailAddress}`,
            sql`${schema.mailboxConnections.capabilities} @> '["TRACK_REPLIES"]'::jsonb`,
          ),
        )
        .limit(1);
      // Acknowledge unknown mailboxes without revealing whether an address is connected.
      if (connection === undefined) return reply.status(204).send(null);
      const emailHash = createHmac(
        "sha256",
        config.tokenKeyring.keys.get(config.tokenKeyring.activeVersion)!,
      )
        .update(notification.emailAddress)
        .digest("hex");
      await app.db
        .insert(schema.mailboxSyncEvents)
        .values({
          mailboxConnectionId: connection.id,
          notificationId: notification.notificationId,
          emailAddressHash: emailHash,
          historyId: notification.historyId,
          outcome: "ENQUEUED",
        })
        .onConflictDoNothing();
      const queued = await app.jobs.send(
        "gmail-sync",
        { connectionId: connection.id },
        { singletonKey: `${connection.id}:${notification.notificationId}` },
      );
      if (queued === null) {
        throw new DomainError(
          "JOB_FAILED",
          "Could not queue Gmail synchronization.",
        );
      }
      return reply.status(204).send(null);
    },
  );

  app.get(
    "/v1/mail/connections",
    { schema: { response: { 200: ConnectionList } } },
    async (request) => {
      const user = actingUser(request);
      const rows = await app.db.query.mailboxConnections.findMany({
        where: (connections, { eq }) => eq(connections.userId, user.id),
        orderBy: (connections, { desc }) => [desc(connections.createdAt)],
      });
      return { items: rows.map(connectionView) };
    },
  );

  app.post(
    "/v1/mail/gmail/connect",
    {
      schema: {
        body: StartGmailConnectionRequest,
        response: { 200: GmailAuthorization, 503: ErrorResponse },
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request) => {
      const principal = principalOf(request);
      const user = actingUser(request);
      const config = gmailConfig(app);
      const stateId = uuidv7();
      const { verifier, challenge } = createPkce();
      const capabilities = [
        "SEND" as const,
        ...(request.body.enableReplyTracking
          ? (["TRACK_REPLIES"] as const)
          : []),
      ];
      const encrypted = encryptSecret(verifier, config.tokenKeyring, {
        provider: "gmail",
        connectionId: stateId,
        userId: user.id,
      });
      const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

      await app.db.insert(schema.mailOauthStates).values({
        id: stateId,
        userId: user.id,
        provider: "gmail",
        capabilities,
        verifierCiphertext: encrypted.ciphertext,
        verifierNonce: encrypted.nonce,
        verifierAuthTag: encrypted.authTag,
        keyVersion: encrypted.keyVersion,
        redirectUri: config.redirectUri,
        expiresAt,
      });

      return {
        authorizationUrl: buildGmailAuthorizationUrl({
          clientId: config.clientId,
          redirectUri: config.redirectUri,
          state: stateId,
          challenge,
          scopes: gmailScopes(request.body.enableReplyTracking),
          loginHint: principal.user.email,
        }),
        expiresAt,
      };
    },
  );

  app.get(
    "/v1/mail/gmail/callback",
    {
      schema: { querystring: CallbackQuery },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const config = gmailConfig(app);
      const now = new Date().toISOString();
      const [state] = await app.db
        .update(schema.mailOauthStates)
        .set({ consumedAt: now })
        .where(
          and(
            eq(schema.mailOauthStates.id, request.query.state),
            isNull(schema.mailOauthStates.consumedAt),
            gt(schema.mailOauthStates.expiresAt, now),
            eq(schema.mailOauthStates.redirectUri, config.redirectUri),
          ),
        )
        .returning();

      if (state === undefined) {
        throw new DomainError(
          "VALIDATION",
          "This Gmail authorization request is expired or was already used.",
        );
      }

      const verifier = decryptSecret(
        {
          ciphertext: state.verifierCiphertext,
          nonce: state.verifierNonce,
          authTag: state.verifierAuthTag,
          keyVersion: state.keyVersion,
        },
        config.tokenKeyring,
        { provider: "gmail", connectionId: state.id, userId: state.userId },
      );
      const provider = app.mailProviders.require("gmail");
      const tokens = await provider.exchangeAuthorizationCode(
        request.query.code,
        verifier,
        state.redirectUri,
      );
      const identity = await provider.getIdentity(tokens.accessToken);
      const existing = await app.db.query.mailboxConnections.findFirst({
        where: (connections, { and, eq }) =>
          and(
            eq(connections.provider, "gmail"),
            eq(connections.externalAccountId, identity.externalAccountId),
          ),
      });

      if (existing !== undefined && existing.userId !== state.userId) {
        throw new DomainError(
          "CONFLICT",
          "That Gmail mailbox is already connected to another account.",
        );
      }
      if (tokens.refreshToken === null && existing === undefined) {
        throw new DomainError(
          "PROVIDER_UNAVAILABLE",
          "Google did not issue offline access. Reconnect and grant consent.",
        );
      }

      const connectionId = existing?.id ?? uuidv7();
      const tokenEnvelope =
        tokens.refreshToken === null
          ? null
          : encryptSecret(tokens.refreshToken, config.tokenKeyring, {
              provider: "gmail",
              connectionId,
              userId: state.userId,
            });

      await app.db.transaction(async (tx) => {
        if (existing === undefined && tokenEnvelope !== null) {
          await tx.insert(schema.mailboxConnections).values({
            id: connectionId,
            userId: state.userId,
            provider: "gmail",
            externalAccountId: identity.externalAccountId,
            emailAddress: identity.emailAddress,
            capabilities: state.capabilities,
            grantedScopes: tokens.grantedScopes,
            refreshTokenCiphertext: tokenEnvelope.ciphertext,
            refreshTokenNonce: tokenEnvelope.nonce,
            refreshTokenAuthTag: tokenEnvelope.authTag,
            tokenKeyVersion: tokenEnvelope.keyVersion,
          });
        } else if (existing !== undefined) {
          await tx
            .update(schema.mailboxConnections)
            .set({
              emailAddress: identity.emailAddress,
              capabilities: state.capabilities,
              grantedScopes:
                tokens.grantedScopes.length === 0
                  ? existing.grantedScopes
                  : tokens.grantedScopes,
              status: "ACTIVE",
              lastErrorCategory: null,
              lastErrorAt: null,
              revision: existing.revision + 1,
              updatedAt: now,
              ...(tokenEnvelope === null
                ? {}
                : {
                    refreshTokenCiphertext: tokenEnvelope.ciphertext,
                    refreshTokenNonce: tokenEnvelope.nonce,
                    refreshTokenAuthTag: tokenEnvelope.authTag,
                    tokenKeyVersion: tokenEnvelope.keyVersion,
                  }),
            })
            .where(eq(schema.mailboxConnections.id, existing.id));
        }

        await app.audit.write(
          tx,
          {
            actorId: state.userId,
            sessionId: null,
            requestId: request.requestId,
          },
          {
            action:
              existing === undefined
                ? "mailbox.connected"
                : "mailbox.reauthorized",
            entityType: "mailbox_connection",
            entityId: connectionId,
            after: { provider: "gmail", capabilities: state.capabilities },
          },
        );
      });

      reply.type("text/html; charset=utf-8");
      return "<!doctype html><meta charset=utf-8><title>Gmail connected</title><p>Gmail is connected. You can close this window and return to CodeVault.</p>";
    },
  );

  app.delete(
    "/v1/mail/connections/:id",
    { schema: { params: ConnectionParam, response: { 204: Type.Null() } } },
    async (request, reply) => {
      const user = actingUser(request);
      const principal = principalOf(request);
      const config = gmailConfig(app);
      const row = await app.db.query.mailboxConnections.findFirst({
        where: (connections, { and, eq }) =>
          and(
            eq(connections.id, request.params.id),
            eq(connections.userId, user.id),
          ),
      });
      if (row === undefined)
        throw new DomainError("NOT_FOUND", "Mailbox connection not found.");

      const provider = app.mailProviders.require(row.provider);
      const refreshToken = decryptSecret(
        {
          ciphertext: row.refreshTokenCiphertext,
          nonce: row.refreshTokenNonce,
          authTag: row.refreshTokenAuthTag,
          keyVersion: row.tokenKeyVersion,
        },
        config.tokenKeyring,
        { provider: row.provider, connectionId: row.id, userId: row.userId },
      );

      if (row.watchExpiresAt !== null) {
        const access = await provider.refreshAccessToken(refreshToken);
        await provider.stopWatch(access.accessToken);
      }
      await provider.revoke(refreshToken);

      await app.db.transaction(async (tx) => {
        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "mailbox.disconnected",
            entityType: "mailbox_connection",
            entityId: row.id,
            before: { provider: row.provider, capabilities: row.capabilities },
          },
        );
        await tx
          .delete(schema.mailboxConnections)
          .where(eq(schema.mailboxConnections.id, row.id));
      });
      return reply.status(204).send(null);
    },
  );
}
