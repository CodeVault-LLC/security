import { eq, sql } from "drizzle-orm";

import { schema } from "@codevault/db";
import { MailProviderError } from "@codevault/server/mail/provider";
import { decryptSecret } from "@codevault/server/mail/token-crypto";
import type { GmailWatchRenewalJobData } from "@codevault/server/services/jobs";

import type { WorkerContext } from "../context.js";

export async function renewGmailWatches(
  context: WorkerContext,
  data: GmailWatchRenewalJobData,
): Promise<void> {
  if (!context.config.gmail.enabled || context.config.gmail.pubsub === null)
    return;
  const config = context.config.gmail;
  const pubsub = config.pubsub;
  if (pubsub === null) return;
  const provider = context.mailProviders.require("gmail");
  const connections = await context.db
    .select()
    .from(schema.mailboxConnections)
    .where(
      data.connectionId === undefined
        ? sql`${schema.mailboxConnections.capabilities} @> '["TRACK_REPLIES"]'::jsonb`
        : eq(schema.mailboxConnections.id, data.connectionId),
    );

  for (const connection of connections) {
    try {
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
      const access = await provider.refreshAccessToken(refreshToken);
      const watch = await provider.startWatch(
        access.accessToken,
        pubsub.topicName,
      );
      await context.db
        .update(schema.mailboxConnections)
        .set({
          historyId: watch.historyId,
          watchExpiresAt: watch.expiresAt,
          status: "ACTIVE",
          lastErrorCategory: null,
          lastErrorAt: null,
          revision: connection.revision + 1,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.mailboxConnections.id, connection.id));
    } catch (error: unknown) {
      const reauth =
        error instanceof MailProviderError &&
        [401, 403].includes(error.status ?? 0);
      await context.db
        .update(schema.mailboxConnections)
        .set({
          status: reauth ? "REAUTH_REQUIRED" : "WATCH_EXPIRED",
          lastErrorCategory: reauth
            ? "GMAIL_REAUTH_REQUIRED"
            : "GMAIL_WATCH_RENEWAL_FAILED",
          lastErrorAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.mailboxConnections.id, connection.id));
    }
  }
}
