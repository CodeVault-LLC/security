import type {
  MailHistoryPage,
  ProviderMessageMetadata,
} from "@codevault/server/mail/provider";
import { MailProviderError } from "@codevault/server/mail/provider";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

import { generateObjectKey, uuidv7 } from "@codevault/core/crypto";
import { schema } from "@codevault/db";
import { decryptSecret } from "@codevault/server/mail/token-crypto";
import type { GmailSyncJobData } from "@codevault/server/services/jobs";

import type { WorkerContext } from "../context.js";
import { generateArtifactPreview } from "./artifact-preview.js";
import { parseInboundMessage } from "./inbound-correspondence.js";

export interface GmailSyncDependencies {
  accessToken: string;
  startHistoryId: string;
  getHistory(
    accessToken: string,
    startHistoryId: string,
    pageToken?: string,
  ): Promise<MailHistoryPage>;
  getMessageMetadata(
    accessToken: string,
    messageId: string,
  ): Promise<ProviderMessageMetadata>;
  isTrackedThread(threadId: string): Promise<boolean>;
  getMessageRaw(accessToken: string, messageId: string): Promise<Uint8Array>;
  persistTracked(input: {
    metadata: ProviderMessageMetadata;
    raw: Uint8Array;
  }): Promise<void>;
  advanceCursor(historyId: string): Promise<void>;
}

/** Metadata is the privacy gate: raw bytes are fetched only after a thread match. */
export async function syncMailboxHistory(
  dependencies: GmailSyncDependencies,
): Promise<void> {
  let pageToken: string | undefined;
  let finalHistoryId = dependencies.startHistoryId;
  const seen = new Set<string>();

  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const page = await dependencies.getHistory(
      dependencies.accessToken,
      dependencies.startHistoryId,
      pageToken,
    );
    finalHistoryId = page.historyId;
    for (const messageId of page.messageIds) {
      if (seen.has(messageId)) continue;
      seen.add(messageId);
      const metadata = await dependencies.getMessageMetadata(
        dependencies.accessToken,
        messageId,
      );
      if (!(await dependencies.isTrackedThread(metadata.threadId))) continue;
      const raw = await dependencies.getMessageRaw(
        dependencies.accessToken,
        messageId,
      );
      await dependencies.persistTracked({ metadata, raw });
    }
    if (page.nextPageToken === null) {
      await dependencies.advanceCursor(finalHistoryId);
      return;
    }
    pageToken = page.nextPageToken;
  }
  throw new Error("Gmail history pagination exceeded the safety limit.");
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function artifactKind(
  mimeType: string,
): "IMAGE" | "ARCHIVE" | "BINARY" | "DOCUMENT" | "OTHER" {
  const type = mimeType.toLowerCase();
  if (type.startsWith("image/") && type !== "image/svg+xml") return "IMAGE";
  if (/zip|tar|gzip|rar|7z/.test(type)) return "ARCHIVE";
  if (/executable|x-msdownload|x-sharedlib/.test(type)) return "BINARY";
  if (type.startsWith("text/") || /pdf|document|json|xml/.test(type))
    return "DOCUMENT";
  return "OTHER";
}

async function runOneMailbox(
  context: WorkerContext,
  connectionId: string,
): Promise<void> {
  if (!context.config.gmail.enabled) throw new Error("Gmail is disabled.");
  const gmailConfig = context.config.gmail;
  const connection = await context.db.query.mailboxConnections.findFirst({
    where: (connections, { and, eq }) =>
      and(eq(connections.id, connectionId), eq(connections.provider, "gmail")),
  });
  if (
    connection === undefined ||
    !connection.capabilities.includes("TRACK_REPLIES")
  ) {
    return;
  }
  const provider = context.mailProviders.require("gmail");
  const refreshToken = decryptSecret(
    {
      ciphertext: connection.refreshTokenCiphertext,
      nonce: connection.refreshTokenNonce,
      authTag: connection.refreshTokenAuthTag,
      keyVersion: connection.tokenKeyVersion,
    },
    gmailConfig.tokenKeyring,
    {
      provider: "gmail",
      connectionId: connection.id,
      userId: connection.userId,
    },
  );
  const access = await provider.refreshAccessToken(refreshToken);

  const trackedSubmission = async (threadId: string) => {
    const [tracked] = await context.db
      .select({
        submissionId: schema.correspondenceMessages.submissionId,
        caseId: schema.submissions.caseId,
        organizationId: schema.cases.organizationId,
      })
      .from(schema.correspondenceMessages)
      .innerJoin(
        schema.submissions,
        eq(schema.submissions.id, schema.correspondenceMessages.submissionId),
      )
      .innerJoin(schema.cases, eq(schema.cases.id, schema.submissions.caseId))
      .where(
        and(
          eq(schema.correspondenceMessages.mailboxConnectionId, connection.id),
          eq(schema.correspondenceMessages.providerThreadId, threadId),
        ),
      )
      .limit(1);
    return tracked ?? null;
  };

  const persistTracked: GmailSyncDependencies["persistTracked"] = async ({
    metadata,
    raw,
  }) => {
    const tracked = await trackedSubmission(metadata.threadId);
    if (tracked === null) return;
    const existing = await context.db.query.correspondenceMessages.findFirst({
      where: (messages, { and, eq }) =>
        and(
          eq(messages.mailboxConnectionId, connection.id),
          eq(messages.providerMessageId, metadata.id),
        ),
    });
    if (existing !== undefined) return;

    const parsed = await parseInboundMessage(raw, {
      providerMessageId: metadata.id,
    });
    const rawArtifactId = uuidv7();
    const rawObjectKey = generateObjectKey(tracked.caseId, rawArtifactId);
    const attachmentArtifacts = parsed.attachments.map((attachment) => {
      const id = uuidv7();
      return {
        id,
        objectKey: generateObjectKey(tracked.caseId, id),
        attachment,
      };
    });
    await context.storage.putObject(rawObjectKey, raw, "message/rfc822");
    try {
      for (const item of attachmentArtifacts) {
        await context.storage.putObject(
          item.objectKey,
          item.attachment.content,
          item.attachment.contentType,
        );
      }
      const artifactIds = await context.db.transaction(async (tx) => {
        const duplicate = await tx.query.correspondenceMessages.findFirst({
          where: (messages, { and, eq }) =>
            and(
              eq(messages.mailboxConnectionId, connection.id),
              eq(messages.providerMessageId, metadata.id),
            ),
        });
        if (duplicate !== undefined) return [];
        await tx.insert(schema.artifacts).values({
          id: rawArtifactId,
          caseId: tracked.caseId,
          filename: `gmail-${metadata.id.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120)}.eml`,
          objectKey: rawObjectKey,
          mimeType: "message/rfc822",
          sizeBytes: raw.byteLength,
          sha256: digest(raw),
          artifactKind: "DOCUMENT",
          visibility: "VENDOR",
          status: "STORED",
          uploadedBy: connection.userId,
          capturedAt: parsed.receivedAt,
        });
        if (attachmentArtifacts.length > 0) {
          await tx.insert(schema.artifacts).values(
            attachmentArtifacts.map(({ id, objectKey, attachment }) => ({
              id,
              caseId: tracked.caseId,
              filename: attachment.filename,
              objectKey,
              mimeType: attachment.contentType,
              sizeBytes: attachment.content.byteLength,
              sha256: digest(attachment.content),
              artifactKind: artifactKind(attachment.contentType),
              visibility: "VENDOR" as const,
              status: "STORED" as const,
              uploadedBy: connection.userId,
              capturedAt: parsed.receivedAt,
            })),
          );
        }
        const messageId = uuidv7();
        await tx.insert(schema.correspondenceMessages).values({
          id: messageId,
          submissionId: tracked.submissionId,
          mailboxConnectionId: connection.id,
          direction: "INBOUND",
          providerMessageId: metadata.id,
          providerThreadId: metadata.threadId,
          rfcMessageId: parsed.rfcMessageId,
          inReplyTo: parsed.inReplyTo,
          references: parsed.references,
          fromAddress: parsed.from,
          toAddresses: parsed.to,
          ccAddresses: parsed.cc,
          subject: parsed.subject,
          bodyText: parsed.bodyText,
          bodyEncrypted: parsed.encrypted ? "OPENPGP" : "PLAIN",
          rawArtifactId,
          classification: "UNREVIEWED",
          visibility: "VENDOR",
          receivedAt: parsed.receivedAt,
        });
        if (attachmentArtifacts.length > 0) {
          await tx.insert(schema.correspondenceMessageAttachments).values(
            attachmentArtifacts.map((item, position) => ({
              messageId,
              artifactId: item.id,
              position,
            })),
          );
        }
        await tx.insert(schema.auditEvents).values({
          organizationId: tracked.organizationId,
          action: "correspondence.inbound_received",
          entityType: "correspondence_message",
          entityId: messageId,
          caseId: tracked.caseId,
          actorId: null,
          after: {
            providerMessageId: metadata.id,
            providerThreadId: metadata.threadId,
            encrypted: parsed.encrypted,
            attachmentCount: attachmentArtifacts.length,
          },
        });
        return attachmentArtifacts.map((item) => item.id);
      });
      for (const artifactId of artifactIds) {
        await generateArtifactPreview(context, {
          artifactId,
          caseId: tracked.caseId,
        });
      }
    } catch (error: unknown) {
      await context.storage.deleteObject(rawObjectKey).catch(() => undefined);
      for (const item of attachmentArtifacts) {
        await context.storage
          .deleteObject(item.objectKey)
          .catch(() => undefined);
      }
      throw error;
    }
  };

  const advanceCursor = async (historyId: string) => {
    const now = new Date().toISOString();
    await context.db.transaction(async (tx) => {
      await tx
        .update(schema.mailboxConnections)
        .set({
          historyId,
          status: "ACTIVE",
          lastSuccessfulSyncAt: now,
          lastErrorCategory: null,
          lastErrorAt: null,
          revision: connection.revision + 1,
          updatedAt: now,
        })
        .where(eq(schema.mailboxConnections.id, connection.id));
      await tx
        .update(schema.mailboxSyncEvents)
        .set({ outcome: "PROCESSED", errorCategory: null })
        .where(
          and(
            eq(schema.mailboxSyncEvents.mailboxConnectionId, connection.id),
            eq(schema.mailboxSyncEvents.outcome, "ENQUEUED"),
          ),
        );
    });
  };

  if (connection.historyId === null) {
    await advanceCursor(await provider.getProfileHistoryId(access.accessToken));
    return;
  }

  const dependencies: GmailSyncDependencies = {
    accessToken: access.accessToken,
    startHistoryId: connection.historyId,
    getHistory: (token, cursor, page) =>
      provider.getHistory(token, cursor, page),
    getMessageMetadata: (token, id) => provider.getMessageMetadata(token, id),
    isTrackedThread: async (threadId) =>
      (await trackedSubmission(threadId)) !== null,
    getMessageRaw: (token, id) => provider.getMessageRaw(token, id),
    persistTracked,
    advanceCursor,
  };

  try {
    await syncMailboxHistory(dependencies);
  } catch (error: unknown) {
    if (!(error instanceof MailProviderError) || error.status !== 404) {
      throw error;
    }
    // The History cursor expired. Rescan only threads CodeVault already owns.
    const trackedThreads = await context.db
      .selectDistinct({
        threadId: schema.correspondenceMessages.providerThreadId,
      })
      .from(schema.correspondenceMessages)
      .where(
        and(
          eq(schema.correspondenceMessages.mailboxConnectionId, connection.id),
          sql`${schema.correspondenceMessages.providerThreadId} IS NOT NULL`,
        ),
      );
    for (const tracked of trackedThreads) {
      if (tracked.threadId === null) continue;
      for (const messageId of await provider.getThreadMessageIds(
        access.accessToken,
        tracked.threadId,
      )) {
        const metadata = await provider.getMessageMetadata(
          access.accessToken,
          messageId,
        );
        const duplicate =
          await context.db.query.correspondenceMessages.findFirst({
            where: (messages, { and, eq }) =>
              and(
                eq(messages.mailboxConnectionId, connection.id),
                eq(messages.providerMessageId, messageId),
              ),
          });
        if (duplicate !== undefined) continue;
        const raw = await provider.getMessageRaw(access.accessToken, messageId);
        await persistTracked({ metadata, raw });
      }
    }
    await advanceCursor(await provider.getProfileHistoryId(access.accessToken));
  }
}

export async function runGmailSync(
  context: WorkerContext,
  data: GmailSyncJobData,
): Promise<void> {
  const ids =
    data.connectionId === undefined
      ? await context.db
          .select({ id: schema.mailboxConnections.id })
          .from(schema.mailboxConnections)
          .where(
            sql`${schema.mailboxConnections.capabilities} @> '["TRACK_REPLIES"]'::jsonb`,
          )
      : [{ id: data.connectionId }];
  for (const { id } of ids) {
    try {
      await runOneMailbox(context, id);
    } catch (error: unknown) {
      const reauth =
        error instanceof MailProviderError &&
        [401, 403].includes(error.status ?? 0);
      await context.db
        .update(schema.mailboxConnections)
        .set({
          status: reauth ? "REAUTH_REQUIRED" : "ERROR",
          lastErrorCategory: reauth
            ? "GMAIL_REAUTH_REQUIRED"
            : "GMAIL_SYNC_FAILED",
          lastErrorAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.mailboxConnections.id, id));
      context.log(`Gmail sync failed for connection ${id}`);
    }
  }
}
