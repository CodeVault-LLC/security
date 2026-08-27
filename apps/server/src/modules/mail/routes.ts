import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { Type } from "@sinclair/typebox";
import { createHmac } from "node:crypto";

import {
  ErrorResponse,
  GmailAuthorization,
  GmailThreadPreview,
  MailThreadDetail,
  MailThreadPage,
  MailTrackingTargets,
  MailboxConnection,
  StartGmailConnectionRequest,
  Uuid,
} from "@codevault/contracts";
import { canReadCase, canWriteCase, DomainError } from "@codevault/core";
import { uuidv7 } from "@codevault/core/crypto";
import { schema } from "@codevault/db";

import type { AppInstance } from "../../http/app-instance.js";
import { actingUser, principalOf, requireAuthor } from "../../http/guards.js";
import { loadCaseAccess } from "../../services/case-access.js";
import { previewExistingGmailThread } from "../submissions/correspondence.js";
import { requireSubmissionWrite } from "../submissions/service.js";
import {
  buildGmailAuthorizationUrl,
  createPkce,
  gmailScopes,
} from "./gmail-oauth.js";
import { decryptSecret, encryptSecret } from "./token-crypto.js";
import { MailProviderError } from "./provider.js";
import { parseInboundMessage } from "./inbound-message.js";
import { previewGmailMessage } from "./gmail-thread-reference.js";
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
const MailThreadParam = Type.Object({
  id: Uuid,
  threadId: Type.String({
    minLength: 1,
    maxLength: 500,
    pattern: "^[A-Za-z0-9_-]+$",
  }),
});
const MailThreadListQuery = Type.Object({
  folder: Type.Union([
    Type.Literal("INBOX"),
    Type.Literal("SENT"),
    Type.Literal("TRACKED"),
  ]),
  query: Type.Optional(Type.String({ maxLength: 300 })),
  pageToken: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
});
const MailTrackingPreviewQuery = Type.Object({ submissionId: Uuid });
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

async function mailboxAccess(
  app: AppInstance,
  userId: string,
  connectionId: string,
) {
  const config = gmailConfig(app);
  const connection = await app.db.query.mailboxConnections.findFirst({
    where: (connections, { and, eq }) =>
      and(
        eq(connections.id, connectionId),
        eq(connections.userId, userId),
        eq(connections.provider, "gmail"),
        eq(connections.status, "ACTIVE"),
      ),
  });
  if (
    connection === undefined ||
    !connection.capabilities.includes("TRACK_REPLIES")
  ) {
    throw new DomainError(
      "VALIDATION",
      "Choose an active Gmail connection with reply tracking enabled.",
    );
  }
  const refreshToken = decryptSecret(
    {
      ciphertext: connection.refreshTokenCiphertext,
      nonce: connection.refreshTokenNonce,
      authTag: connection.refreshTokenAuthTag,
      keyVersion: connection.tokenKeyVersion,
    },
    config.tokenKeyring,
    {
      provider: "gmail",
      connectionId: connection.id,
      userId: connection.userId,
    },
  );
  const provider = app.mailProviders.require("gmail");
  try {
    const access = await provider.refreshAccessToken(refreshToken);
    return { connection, provider, accessToken: access.accessToken };
  } catch (error: unknown) {
    if (error instanceof MailProviderError) {
      throw new DomainError(
        "PROVIDER_UNAVAILABLE",
        "Gmail authorization failed. Reconnect this mailbox in mail settings, then try again.",
      );
    }
    throw error;
  }
}

function mailboxFailure(error: unknown): never {
  if (error instanceof DomainError) throw error;
  if (error instanceof MailProviderError) {
    throw new DomainError(
      error.status === 401 || error.status === 403
        ? "PROVIDER_UNAVAILABLE"
        : error.status === 404
          ? "NOT_FOUND"
          : "PROVIDER_UNAVAILABLE",
      error.status === 401 || error.status === 403
        ? "Gmail needs to be reconnected in mail settings."
        : error.status === 404
          ? "Gmail thread was not found."
          : "Gmail is temporarily unavailable. Try again.",
    );
  }
  throw error;
}

async function trackingFor(
  app: AppInstance,
  user: ReturnType<typeof actingUser>,
  connectionId: string,
  providerThreadId: string,
) {
  const [row] = await app.db
    .select({
      submissionId: schema.submissions.id,
      submissionRef: schema.submissions.ref,
      caseId: schema.cases.id,
      caseRef: schema.cases.ref,
      caseTitle: schema.cases.title,
      vendorName: schema.vendors.name,
    })
    .from(schema.submissionMailThreads)
    .innerJoin(
      schema.submissions,
      eq(schema.submissions.id, schema.submissionMailThreads.submissionId),
    )
    .innerJoin(schema.cases, eq(schema.cases.id, schema.submissions.caseId))
    .innerJoin(
      schema.vendors,
      eq(schema.vendors.id, schema.submissions.vendorId),
    )
    .where(
      and(
        eq(schema.submissionMailThreads.mailboxConnectionId, connectionId),
        eq(schema.submissionMailThreads.providerThreadId, providerThreadId),
      ),
    )
    .limit(1);
  if (row === undefined) return null;
  const access = await loadCaseAccess(app.db, row.caseId);
  if (access === null || !canReadCase(user, access.context)) return null;
  return {
    submissionId: row.submissionId,
    submissionRef: row.submissionRef,
    caseRef: row.caseRef,
    caseTitle: row.caseTitle,
    vendorName: row.vendorName,
  };
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

  app.get(
    "/v1/mail/connections/:id/threads",
    {
      schema: {
        params: ConnectionParam,
        querystring: MailThreadListQuery,
        response: { 200: MailThreadPage, 503: ErrorResponse },
      },
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (request) => {
      const user = actingUser(request);
      const { connection, provider, accessToken } = await mailboxAccess(
        app,
        user.id,
        request.params.id,
      );
      try {
        if (request.query.folder === "TRACKED") {
          const parsedOffset = Number.parseInt(
            request.query.pageToken ?? "0",
            10,
          );
          const offset =
            Number.isSafeInteger(parsedOffset) && parsedOffset >= 0
              ? parsedOffset
              : 0;
          const rows = await app.db
            .select({ thread: schema.submissionMailThreads })
            .from(schema.submissionMailThreads)
            .where(
              eq(
                schema.submissionMailThreads.mailboxConnectionId,
                connection.id,
              ),
            )
            .orderBy(desc(schema.submissionMailThreads.createdAt))
            .limit(21)
            .offset(offset);
          const items = [];
          for (const { thread } of rows.slice(0, 20)) {
            const tracking = await trackingFor(
              app,
              user,
              connection.id,
              thread.providerThreadId,
            );
            if (tracking === null) continue;
            const messageIds = await provider.getThreadMessageIds(
              accessToken,
              thread.providerThreadId,
            );
            const providerMessageId = messageIds.at(-1);
            if (providerMessageId === undefined) continue;
            const metadata = await provider.getMessageMetadata(
              accessToken,
              providerMessageId,
            );
            const preview = previewGmailMessage(
              metadata,
              connection.emailAddress,
            );
            const participants = [preview.from, ...preview.to]
              .filter((value, index, values) => values.indexOf(value) === index)
              .slice(0, 100);
            const query = request.query.query?.trim().toLowerCase();
            if (
              query !== undefined &&
              query !== "" &&
              ![
                preview.subject,
                ...participants,
                tracking.caseRef,
                tracking.caseTitle,
                tracking.vendorName,
              ].some((value) => value.toLowerCase().includes(query))
            ) {
              continue;
            }
            items.push({
              providerMessageId,
              providerThreadId: thread.providerThreadId,
              subject: preview.subject,
              participants,
              occurredAt: preview.occurredAt,
              unread: metadata.labelIds.includes("UNREAD"),
              tracking,
            });
          }
          return {
            items,
            nextPageToken: rows.length > 20 ? String(offset + 20) : null,
          };
        }

        const page = await provider.listMessages(accessToken, {
          labelId: request.query.folder,
          maxResults: 30,
          ...(request.query.query?.trim()
            ? { query: request.query.query.trim() }
            : {}),
          ...(request.query.pageToken === undefined
            ? {}
            : { pageToken: request.query.pageToken }),
        });
        const references = page.messages.filter(
          (reference, index, all) =>
            all.findIndex(
              (candidate) =>
                candidate.providerThreadId === reference.providerThreadId,
            ) === index,
        );
        const items = await Promise.all(
          references.map(async (reference) => {
            const metadata = await provider.getMessageMetadata(
              accessToken,
              reference.providerMessageId,
            );
            const preview = previewGmailMessage(
              metadata,
              connection.emailAddress,
            );
            return {
              providerMessageId: reference.providerMessageId,
              providerThreadId: reference.providerThreadId,
              subject: preview.subject,
              participants: [preview.from, ...preview.to]
                .filter(
                  (value, index, values) => values.indexOf(value) === index,
                )
                .slice(0, 100),
              occurredAt: preview.occurredAt,
              unread: metadata.labelIds.includes("UNREAD"),
              tracking: await trackingFor(
                app,
                user,
                connection.id,
                reference.providerThreadId,
              ),
            };
          }),
        );
        items.sort((left, right) =>
          (right.occurredAt ?? "").localeCompare(left.occurredAt ?? ""),
        );
        return { items, nextPageToken: page.nextPageToken };
      } catch (error: unknown) {
        mailboxFailure(error);
      }
    },
  );

  app.get(
    "/v1/mail/connections/:id/threads/:threadId/tracking-preview",
    {
      schema: {
        params: MailThreadParam,
        querystring: MailTrackingPreviewQuery,
        response: {
          200: GmailThreadPreview,
          400: ErrorResponse,
          409: ErrorResponse,
          503: ErrorResponse,
        },
      },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const user = requireAuthor(request);
      const submission = await requireSubmissionWrite(
        app,
        user,
        request.query.submissionId,
      );
      return previewExistingGmailThread(app, user.id, submission, {
        mailboxConnectionId: request.params.id,
        threadReference: request.params.threadId,
      });
    },
  );

  app.get(
    "/v1/mail/connections/:id/threads/:threadId",
    {
      schema: {
        params: MailThreadParam,
        response: {
          200: MailThreadDetail,
          404: ErrorResponse,
          503: ErrorResponse,
        },
      },
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (request) => {
      const user = actingUser(request);
      const { connection, provider, accessToken } = await mailboxAccess(
        app,
        user.id,
        request.params.id,
      );
      try {
        const messageIds = await provider.getThreadMessageIds(
          accessToken,
          request.params.threadId,
        );
        if (messageIds.length === 0) {
          throw new DomainError("NOT_FOUND", "Gmail thread was not found.");
        }
        const tracking = await trackingFor(
          app,
          user,
          connection.id,
          request.params.threadId,
        );
        if (messageIds.length > 100) {
          const metadata = await provider.getMessageMetadata(
            accessToken,
            messageIds.at(-1)!,
          );
          return {
            mailboxConnectionId: connection.id,
            mailboxAddress: connection.emailAddress,
            providerThreadId: request.params.threadId,
            subject: previewGmailMessage(metadata, connection.emailAddress)
              .subject,
            messages: [],
            tooLarge: true,
            tracking,
          };
        }
        const messages = [];
        for (const messageId of messageIds) {
          const [metadata, raw] = await Promise.all([
            provider.getMessageMetadata(accessToken, messageId),
            provider.getMessageRaw(accessToken, messageId),
          ]);
          if (metadata.threadId !== request.params.threadId) {
            throw new Error("Gmail returned inconsistent thread metadata.");
          }
          try {
            const parsed = await parseInboundMessage(raw, {
              providerMessageId: messageId,
            });
            messages.push({
              providerMessageId: messageId,
              direction:
                metadata.labelIds.includes("SENT") ||
                parsed.from === connection.emailAddress.toLowerCase()
                  ? ("OUTBOUND" as const)
                  : ("INBOUND" as const),
              from: parsed.from,
              to: parsed.to,
              cc: parsed.cc,
              subject: parsed.subject.slice(0, 300),
              bodyText: parsed.bodyText,
              encrypted: parsed.encrypted,
              previewUnavailable: false,
              occurredAt: parsed.receivedAt,
              attachments: parsed.attachments.map((attachment) => ({
                filename: attachment.filename,
                contentType: attachment.contentType,
                sizeBytes: attachment.content.byteLength,
              })),
            });
          } catch {
            const preview = previewGmailMessage(
              metadata,
              connection.emailAddress,
            );
            messages.push({
              providerMessageId: messageId,
              direction: preview.direction,
              from: preview.from,
              to: preview.to,
              cc: [],
              subject: preview.subject,
              bodyText: null,
              encrypted: false,
              previewUnavailable: true,
              occurredAt: preview.occurredAt ?? new Date(0).toISOString(),
              attachments: [],
            });
          }
        }
        messages.sort((left, right) =>
          left.occurredAt.localeCompare(right.occurredAt),
        );
        return {
          mailboxConnectionId: connection.id,
          mailboxAddress: connection.emailAddress,
          providerThreadId: request.params.threadId,
          subject:
            messages.find((message) => message.subject !== "(no subject)")
              ?.subject ?? "(no subject)",
          messages,
          tooLarge: false,
          tracking,
        };
      } catch (error: unknown) {
        mailboxFailure(error);
      }
    },
  );

  app.get(
    "/v1/mail/tracking-targets",
    { schema: { response: { 200: MailTrackingTargets } } },
    async (request) => {
      const user = actingUser(request);
      const rows = await app.db
        .select({
          submission: schema.submissions,
          caseId: schema.cases.id,
          caseRef: schema.cases.ref,
          caseTitle: schema.cases.title,
          vendorName: schema.vendors.name,
          linkedThreadId: schema.submissionMailThreads.id,
        })
        .from(schema.submissions)
        .innerJoin(schema.cases, eq(schema.cases.id, schema.submissions.caseId))
        .innerJoin(
          schema.vendors,
          eq(schema.vendors.id, schema.submissions.vendorId),
        )
        .leftJoin(
          schema.submissionMailThreads,
          eq(schema.submissionMailThreads.submissionId, schema.submissions.id),
        )
        .where(
          and(
            eq(schema.submissions.status, "DRAFT"),
            isNull(schema.submissionMailThreads.id),
          ),
        )
        .orderBy(desc(schema.submissions.updatedAt))
        .limit(200);
      const items = [];
      for (const row of rows) {
        const route = row.submission.routeSnapshot;
        if (route.route.type !== "EMAIL") continue;
        const access = await loadCaseAccess(app.db, row.caseId);
        if (access === null || !canWriteCase(user, access.context)) continue;
        items.push({
          submissionId: row.submission.id,
          submissionRef: row.submission.ref,
          revision: row.submission.revision,
          subject: row.submission.subject,
          caseRef: row.caseRef,
          caseTitle: row.caseTitle,
          vendorName: row.vendorName,
        });
      }
      return { items };
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
