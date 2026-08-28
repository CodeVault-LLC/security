import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Type } from "@sinclair/typebox";

import {
  CorrespondenceDecryptIntent,
  CorrespondenceMessage,
  CorrespondenceThread,
  CreateSubmissionReplyDraftRequest,
  ErrorResponse,
  GmailThreadPreview,
  GmailThreadReferenceRequest,
  GmailThreadSearchRequest,
  GmailThreadSearchResults,
  LinkExistingGmailThreadRequest,
  SaveReviewedPlaintextRequest,
  SubmissionDetail,
  UpdateCorrespondenceClassificationRequest,
  Uuid,
} from "@codevault/contracts";
import {
  conflict,
  DomainError,
  notFound,
  validationError,
} from "@codevault/core";
import { uuidv7 } from "@codevault/core/crypto";
import { schema } from "@codevault/db";

import type { AppInstance } from "../../http/app-instance.js";
import { actingUser, principalOf, requireAuthor } from "../../http/guards.js";
import { assertRevision } from "../../http/concurrency.js";
import { decryptSecret } from "../mail/token-crypto.js";
import { MailProviderError } from "../mail/provider.js";
import {
  gmailThreadWarnings,
  parseGmailThreadReference,
  previewGmailMessage,
} from "../mail/gmail-thread-reference.js";
import {
  loadSubmissionDetail,
  requireSubmissionDisclosure,
  requireSubmissionRead,
  requireSubmissionWrite,
  writeSubmissionRevision,
} from "./service.js";

const SubmissionParam = Type.Object({ id: Uuid });
const MessageParam = Type.Object({ id: Uuid, messageId: Uuid });
const DirectMessageParam = Type.Object({ messageId: Uuid });

type MessageRow = typeof schema.correspondenceMessages.$inferSelect;
type ArtifactRow = typeof schema.artifacts.$inferSelect;

async function trackedGmailAccess(
  app: AppInstance,
  userId: string,
  mailboxConnectionId: string,
) {
  if (!app.config.gmail.enabled) {
    throw new DomainError("PROVIDER_UNAVAILABLE", "Gmail is disabled.");
  }
  const [connection] = await app.db
    .select()
    .from(schema.mailboxConnections)
    .where(
      and(
        eq(schema.mailboxConnections.id, mailboxConnectionId),
        eq(schema.mailboxConnections.userId, userId),
        eq(schema.mailboxConnections.provider, "gmail"),
        eq(schema.mailboxConnections.status, "ACTIVE"),
      ),
    )
    .limit(1);
  if (
    connection === undefined ||
    !connection.capabilities.includes("TRACK_REPLIES")
  ) {
    throw validationError(
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
    app.config.gmail.tokenKeyring,
    {
      provider: "gmail",
      connectionId: connection.id,
      userId: connection.userId,
    },
  );
  const provider = app.mailProviders.require("gmail");
  try {
    const access = await provider.refreshAccessToken(refreshToken);
    return { accessToken: access.accessToken, connection, provider };
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

function gmailReadFailure(error: unknown, action: "search" | "preview"): never {
  if (error instanceof MailProviderError) {
    if (error.status === 400 || error.status === 404) {
      throw validationError(
        action === "search"
          ? "Gmail could not run that search. Try a recipient address or fewer words from the subject."
          : "Gmail could not find that thread in the selected mailbox. Search sent Gmail and choose a result.",
      );
    }
    throw new DomainError(
      "PROVIDER_UNAVAILABLE",
      "Gmail is temporarily unavailable. Try again.",
    );
  }
  throw error;
}

async function searchExistingGmailThreads(
  app: AppInstance,
  userId: string,
  submission: typeof schema.submissions.$inferSelect,
  input: { mailboxConnectionId: string; query: string },
): Promise<GmailThreadSearchResults> {
  const route = submission.routeSnapshot as SubmissionDetail["routeSnapshot"];
  if (route.route.type !== "EMAIL") {
    throw validationError("Only email submissions can link a Gmail thread.");
  }
  if (submission.status !== "DRAFT") {
    throw conflict(
      "Only a draft submission can link an existing Gmail thread.",
    );
  }
  const query = input.query.trim();
  if (query === "") {
    throw validationError("Enter a recipient or words from the subject.");
  }
  if (/^https?:\/\/mail\.google\.com\//i.test(query)) {
    throw validationError(
      "Gmail browser links cannot identify an API thread. Search by recipient or words from the subject instead.",
    );
  }

  const { accessToken, provider } = await trackedGmailAccess(
    app,
    userId,
    input.mailboxConnectionId,
  );
  try {
    const references = await provider.searchSentMessages(
      accessToken,
      query,
      20,
    );
    const unique = references.filter(
      (reference, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.providerThreadId === reference.providerThreadId,
        ) === index,
    );
    const metadata = await Promise.all(
      unique
        .slice(0, 20)
        .map((reference) =>
          provider.getMessageMetadata(accessToken, reference.providerMessageId),
        ),
    );
    const items = metadata.map((message) => {
      const preview = previewGmailMessage(message, "");
      return {
        providerThreadId: message.threadId,
        subject: preview.subject,
        to: preview.to,
        occurredAt: preview.occurredAt,
      };
    });
    items.sort((left, right) =>
      (right.occurredAt ?? "").localeCompare(left.occurredAt ?? ""),
    );
    return { items };
  } catch (error: unknown) {
    gmailReadFailure(error, "search");
  }
}

export async function previewExistingGmailThread(
  app: AppInstance,
  userId: string,
  submission: typeof schema.submissions.$inferSelect,
  input: { mailboxConnectionId: string; threadReference: string },
) {
  const route = submission.routeSnapshot as SubmissionDetail["routeSnapshot"];
  if (route.route.type !== "EMAIL") {
    throw validationError("Only email submissions can link a Gmail thread.");
  }
  if (submission.status !== "DRAFT") {
    throw conflict(
      "Only a draft submission can link an existing Gmail thread.",
    );
  }
  const { accessToken, connection, provider } = await trackedGmailAccess(
    app,
    userId,
    input.mailboxConnectionId,
  );

  let providerThreadId: string;
  try {
    providerThreadId = parseGmailThreadReference(input.threadReference);
  } catch (error: unknown) {
    throw validationError(
      error instanceof Error
        ? error.message
        : "Enter a Gmail thread URL or thread ID.",
    );
  }
  const duplicate = await app.db.query.submissionMailThreads.findFirst({
    where: (threads, { and, eq }) =>
      and(
        eq(threads.mailboxConnectionId, connection.id),
        eq(threads.providerThreadId, providerThreadId),
      ),
  });
  if (duplicate !== undefined && duplicate.submissionId !== submission.id) {
    throw conflict(
      "That Gmail thread is already linked to another submission.",
    );
  }

  let messageIds: string[];
  try {
    messageIds = await provider.getThreadMessageIds(
      accessToken,
      providerThreadId,
    );
  } catch (error: unknown) {
    gmailReadFailure(error, "preview");
  }
  if (messageIds.length === 0) {
    throw validationError("Gmail did not return any messages for that thread.");
  }
  if (messageIds.length > 200) {
    throw validationError(
      "This Gmail thread has more than 200 messages and cannot be linked safely.",
    );
  }
  const messages: ReturnType<typeof previewGmailMessage>[] = [];
  for (const messageId of messageIds) {
    const metadata = await provider.getMessageMetadata(accessToken, messageId);
    if (metadata.threadId !== providerThreadId) {
      throw new DomainError(
        "PROVIDER_UNAVAILABLE",
        "Gmail returned inconsistent thread metadata.",
      );
    }
    messages.push(previewGmailMessage(metadata, connection.emailAddress));
  }
  if (!messages.some((message) => message.direction === "OUTBOUND")) {
    throw validationError(
      "The selected thread has no sent message from this Gmail mailbox.",
    );
  }
  messages.sort((left, right) =>
    (left.occurredAt ?? "").localeCompare(right.occurredAt ?? ""),
  );
  const subject =
    messages.find((message) => message.subject !== "(no subject)")?.subject ??
    "(no subject)";
  return {
    mailboxConnectionId: connection.id,
    mailboxAddress: connection.emailAddress,
    providerThreadId,
    subject,
    messages,
    warnings: gmailThreadWarnings({
      messages,
      mailboxAddress: connection.emailAddress,
      routeRecipients: [...route.route.to, ...route.route.cc],
    }),
  };
}

function messageView(row: MessageRow, attachments: ArtifactRow[]) {
  return {
    id: row.id,
    submissionId: row.submissionId,
    direction: row.direction,
    providerMessageId: row.providerMessageId,
    providerThreadId: row.providerThreadId,
    rfcMessageId: row.rfcMessageId,
    inReplyTo: row.inReplyTo,
    references: row.references,
    from: row.fromAddress,
    to: row.toAddresses,
    cc: row.ccAddresses,
    subject: row.subject,
    bodyText: row.bodyText,
    encrypted: row.bodyEncrypted === "OPENPGP",
    rawArtifactId: row.rawArtifactId,
    attachments: attachments.map((artifact) => ({
      artifactId: artifact.id,
      filename: artifact.filename,
      mimeType: artifact.mimeType,
      visibility: artifact.visibility,
      status:
        artifact.status === "STORED" ||
        artifact.status === "QUARANTINED" ||
        artifact.status === "DELETED"
          ? artifact.status
          : ("QUARANTINED" as const),
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
      sourceRevision: null,
    })),
    classification: row.classification,
    receivedAt: row.receivedAt,
    sentAt: row.sentAt,
    reviewedPlaintextSavedAt: row.reviewedPlaintextSavedAt,
    createdAt: row.createdAt,
    revision: row.revision,
  };
}

async function loadMessage(
  app: AppInstance,
  submissionId: string,
  messageId: string,
) {
  const row = await app.db.query.correspondenceMessages.findFirst({
    where: (messages, { and, eq }) =>
      and(eq(messages.id, messageId), eq(messages.submissionId, submissionId)),
  });
  if (row === undefined) {
    throw notFound("Correspondence message");
  }
  return row;
}

export async function registerCorrespondenceRoutes(
  app: AppInstance,
): Promise<void> {
  app.post(
    "/v1/submissions/:id/gmail-thread/search",
    {
      schema: {
        params: SubmissionParam,
        body: GmailThreadSearchRequest,
        response: {
          200: GmailThreadSearchResults,
          400: ErrorResponse,
          409: ErrorResponse,
          503: ErrorResponse,
        },
      },
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request) => {
      const user = requireAuthor(request);
      const submission = await requireSubmissionWrite(
        app,
        user,
        request.params.id,
      );
      return searchExistingGmailThreads(app, user.id, submission, request.body);
    },
  );

  app.post(
    "/v1/submissions/:id/gmail-thread/preview",
    {
      schema: {
        params: SubmissionParam,
        body: GmailThreadReferenceRequest,
        response: {
          200: GmailThreadPreview,
          400: ErrorResponse,
          409: ErrorResponse,
          503: ErrorResponse,
        },
      },
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request) => {
      const user = requireAuthor(request);
      const submission = await requireSubmissionWrite(
        app,
        user,
        request.params.id,
      );
      return previewExistingGmailThread(app, user.id, submission, request.body);
    },
  );

  app.post(
    "/v1/submissions/:id/gmail-thread/link",
    {
      schema: {
        params: SubmissionParam,
        body: LinkExistingGmailThreadRequest,
        response: {
          200: SubmissionDetail,
          400: ErrorResponse,
          409: ErrorResponse,
          503: ErrorResponse,
        },
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const submission = await requireSubmissionWrite(
        app,
        user,
        request.params.id,
      );
      await requireSubmissionDisclosure(app, user, request.params.id);
      assertRevision(submission, request.body.expectedRevision, "submission");
      const preview = await previewExistingGmailThread(
        app,
        user.id,
        submission,
        request.body,
      );
      const client = await app.dbHandle.pool.connect();
      const txDb = drizzle(client, { schema });
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT id FROM submissions WHERE id = $1 FOR UPDATE",
          [submission.id],
        );
        const [current] = await txDb
          .select()
          .from(schema.submissions)
          .where(eq(schema.submissions.id, submission.id))
          .limit(1);
        if (current === undefined) throw conflict("Submission not found.");
        assertRevision(current, request.body.expectedRevision, "submission");
        if (current.status !== "DRAFT") {
          throw conflict(
            "Only a draft submission can link an existing Gmail thread.",
          );
        }
        const [link] = await txDb
          .insert(schema.submissionMailThreads)
          .values({
            id: uuidv7(),
            submissionId: current.id,
            mailboxConnectionId: preview.mailboxConnectionId,
            providerThreadId: preview.providerThreadId,
            linkedBy: user.id,
          })
          .onConflictDoNothing()
          .returning();
        if (link === undefined) {
          throw conflict("That Gmail thread or submission is already linked.");
        }
        const [updated] = await txDb
          .update(schema.submissions)
          .set({
            mailboxConnectionId: preview.mailboxConnectionId,
            status: "SENT",
            coordinationState: "AWAITING_ACKNOWLEDGEMENT",
            subject: preview.subject,
            revision: current.revision + 1,
            lastEditedBy: user.id,
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(schema.submissions.id, current.id),
              eq(schema.submissions.revision, current.revision),
            ),
          )
          .returning();
        if (updated === undefined) {
          throw conflict(
            "The submission changed before the thread was linked.",
          );
        }
        await writeSubmissionRevision(txDb, updated, user.id);
        const transactionalDb = {
          executeSql: async (text: string, values?: unknown[]) => {
            const result = await client.query(
              text,
              values as never[] | undefined,
            );
            return { rows: result.rows };
          },
        };
        const jobId = await app.jobs.send(
          "gmail-sync",
          {
            connectionId: preview.mailboxConnectionId,
            threadId: preview.providerThreadId,
          },
          {
            db: transactionalDb,
            singletonKey: `thread:${preview.mailboxConnectionId}:${preview.providerThreadId}`,
          },
        );
        if (jobId === null) {
          throw new DomainError(
            "JOB_FAILED",
            "Could not queue the Gmail thread import.",
          );
        }
        await app.audit.write(
          txDb,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "submission.gmail_thread_linked",
            entityType: "submission",
            entityId: current.id,
            caseId: current.caseId,
            after: {
              mailboxConnectionId: preview.mailboxConnectionId,
              providerThreadId: preview.providerThreadId,
              messageCount: preview.messages.length,
            },
          },
        );
        await client.query("COMMIT");
      } catch (error: unknown) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
      app.events.publish({
        type: "entity.changed",
        entityType: "submission",
        entityId: submission.id,
        caseId: submission.caseId,
      });
      return loadSubmissionDetail(app, submission.id);
    },
  );

  app.post(
    "/v1/submissions/:id/reply-draft",
    {
      schema: {
        params: SubmissionParam,
        body: CreateSubmissionReplyDraftRequest,
        response: { 200: SubmissionDetail, 409: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const submission = await requireSubmissionWrite(
        app,
        user,
        request.params.id,
      );
      if (submission.status !== "SENT") {
        throw conflict(
          "A reply draft can be created only after a confirmed send.",
        );
      }
      if (submission.revision !== request.body.expectedRevision) {
        throw conflict("The submission changed since it was loaded.");
      }
      const candidates = await app.db
        .select()
        .from(schema.correspondenceMessages)
        .where(
          request.body.messageId === undefined
            ? and(
                eq(schema.correspondenceMessages.submissionId, submission.id),
                inArray(schema.correspondenceMessages.direction, [
                  "INBOUND",
                  "OUTBOUND",
                ]),
              )
            : and(
                eq(schema.correspondenceMessages.id, request.body.messageId),
                eq(schema.correspondenceMessages.submissionId, submission.id),
              ),
        )
        .orderBy(desc(schema.correspondenceMessages.createdAt))
        .limit(1);
      const replyTo = candidates[0];
      if (replyTo === undefined || replyTo.providerThreadId === null) {
        throw conflict("No tracked Gmail message is available to reply to.");
      }
      await app.db.transaction(async (tx) => {
        await tx
          .delete(schema.submissionAttachments)
          .where(eq(schema.submissionAttachments.submissionId, submission.id));
        const [updated] = await tx
          .update(schema.submissions)
          .set({
            status: "DRAFT",
            subject: replyTo.subject,
            bodyMarkdown: "",
            replyToMessageId: replyTo.id,
            revision: submission.revision + 1,
            lastEditedBy: user.id,
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(schema.submissions.id, submission.id),
              eq(schema.submissions.revision, submission.revision),
            ),
          )
          .returning();
        if (updated === undefined)
          throw conflict("The submission changed since it was loaded.");
        await writeSubmissionRevision(tx, updated, user.id);
        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "correspondence.reply_draft_created",
            entityType: "submission",
            entityId: submission.id,
            caseId: submission.caseId,
            after: { replyToMessageId: replyTo.id, revision: updated.revision },
          },
        );
      });
      app.events.publish({
        type: "entity.changed",
        entityType: "submission",
        entityId: submission.id,
        caseId: submission.caseId,
      });
      return loadSubmissionDetail(app, submission.id);
    },
  );

  app.get(
    "/v1/submissions/:id/correspondence",
    {
      schema: {
        params: SubmissionParam,
        response: { 200: CorrespondenceThread, 404: ErrorResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      const submission = await requireSubmissionRead(
        app,
        user,
        request.params.id,
      );
      const messages = await app.db
        .select()
        .from(schema.correspondenceMessages)
        .where(eq(schema.correspondenceMessages.submissionId, submission.id))
        .orderBy(asc(schema.correspondenceMessages.createdAt));
      const links =
        messages.length === 0
          ? []
          : await app.db
              .select({
                messageId: schema.correspondenceMessageAttachments.messageId,
                artifact: schema.artifacts,
              })
              .from(schema.correspondenceMessageAttachments)
              .innerJoin(
                schema.artifacts,
                eq(
                  schema.artifacts.id,
                  schema.correspondenceMessageAttachments.artifactId,
                ),
              )
              .where(
                inArray(
                  schema.correspondenceMessageAttachments.messageId,
                  messages.map((message) => message.id),
                ),
              )
              .orderBy(asc(schema.correspondenceMessageAttachments.position));
      const mailbox =
        submission.mailboxConnectionId === null
          ? null
          : await app.db.query.mailboxConnections.findFirst({
              where: (connections, { eq }) =>
                eq(connections.id, submission.mailboxConnectionId!),
            });
      const linkedThread = await app.db.query.submissionMailThreads.findFirst({
        where: (threads, { eq }) => eq(threads.submissionId, submission.id),
      });
      return {
        items: messages.map((message) =>
          messageView(
            message,
            links
              .filter((link) => link.messageId === message.id)
              .map((link) => link.artifact),
          ),
        ),
        linkedThread:
          linkedThread === undefined
            ? null
            : {
                providerThreadId: linkedThread.providerThreadId,
                linkedAt: linkedThread.createdAt,
              },
        sync:
          mailbox === null || mailbox === undefined
            ? null
            : {
                status: mailbox.status,
                lastSuccessfulSyncAt: mailbox.lastSuccessfulSyncAt,
                watchExpiresAt: mailbox.watchExpiresAt,
                errorCategory: mailbox.lastErrorCategory,
              },
      };
    },
  );

  app.patch(
    "/v1/submissions/:id/correspondence/:messageId",
    {
      schema: {
        params: MessageParam,
        body: UpdateCorrespondenceClassificationRequest,
        response: { 200: CorrespondenceMessage, 409: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const submission = await requireSubmissionWrite(
        app,
        user,
        request.params.id,
      );
      const message = await loadMessage(
        app,
        submission.id,
        request.params.messageId,
      );
      if (message.revision !== request.body.expectedRevision) {
        throw conflict("The message changed since it was loaded.");
      }
      const [updated] = await app.db.transaction(async (tx) => {
        const rows = await tx
          .update(schema.correspondenceMessages)
          .set({
            classification: request.body.classification,
            revision: message.revision + 1,
          })
          .where(
            and(
              eq(schema.correspondenceMessages.id, message.id),
              eq(schema.correspondenceMessages.revision, message.revision),
            ),
          )
          .returning();
        if (rows[0] === undefined)
          throw conflict("The message changed since it was loaded.");
        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "correspondence.classified",
            entityType: "correspondence_message",
            entityId: message.id,
            caseId: submission.caseId,
            before: { classification: message.classification },
            after: { classification: request.body.classification },
          },
        );
        return rows;
      });
      return messageView(updated!, []);
    },
  );

  app.post(
    "/v1/submissions/:id/correspondence/:messageId/reviewed-plaintext",
    {
      schema: {
        params: MessageParam,
        body: SaveReviewedPlaintextRequest,
        response: { 200: CorrespondenceMessage, 409: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const submission = await requireSubmissionWrite(
        app,
        user,
        request.params.id,
      );
      const message = await loadMessage(
        app,
        submission.id,
        request.params.messageId,
      );
      if (message.bodyEncrypted !== "OPENPGP") {
        throw conflict(
          "Only locally decrypted messages accept reviewed plaintext.",
        );
      }
      if (message.revision !== request.body.expectedRevision) {
        throw conflict("The message changed since it was loaded.");
      }
      const now = new Date().toISOString();
      const [updated] = await app.db.transaction(async (tx) => {
        await tx.insert(schema.correspondenceMessageRevisions).values({
          messageId: message.id,
          revision: message.revision + 1,
          bodyText: request.body.bodyText,
          reviewedBy: user.id,
        });
        const rows = await tx
          .update(schema.correspondenceMessages)
          .set({
            bodyText: request.body.bodyText,
            reviewedPlaintextSavedAt: now,
            revision: message.revision + 1,
          })
          .where(
            and(
              eq(schema.correspondenceMessages.id, message.id),
              eq(schema.correspondenceMessages.revision, message.revision),
            ),
          )
          .returning();
        if (rows[0] === undefined)
          throw conflict("The message changed since it was loaded.");
        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "correspondence.reviewed_plaintext_saved",
            entityType: "correspondence_message",
            entityId: message.id,
            caseId: submission.caseId,
            after: { revision: message.revision + 1 },
          },
        );
        return rows;
      });
      return messageView(updated!, []);
    },
  );

  app.get(
    "/v1/correspondence/:messageId/decrypt-intent",
    {
      schema: {
        params: DirectMessageParam,
        response: { 200: CorrespondenceDecryptIntent, 404: ErrorResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      const principal = principalOf(request);
      const [row] = await app.db
        .select({
          message: schema.correspondenceMessages,
          artifact: schema.artifacts,
          submission: schema.submissions,
        })
        .from(schema.correspondenceMessages)
        .innerJoin(
          schema.artifacts,
          eq(schema.artifacts.id, schema.correspondenceMessages.rawArtifactId),
        )
        .innerJoin(
          schema.submissions,
          eq(schema.submissions.id, schema.correspondenceMessages.submissionId),
        )
        .where(eq(schema.correspondenceMessages.id, request.params.messageId))
        .limit(1);
      if (row === undefined) throw notFound("Correspondence message");
      await requireSubmissionRead(app, user, row.submission.id);
      if (row.message.bodyEncrypted !== "OPENPGP") {
        throw conflict("This message is not an encrypted OpenPGP message.");
      }
      const download = await app.storage.createDownloadUrl(
        row.artifact.objectKey,
        row.artifact.filename,
      );
      await app.audit.write(
        app.db,
        {
          actorId: user.id,
          sessionId: principal.session.id,
          requestId: request.requestId,
        },
        {
          action: "correspondence.local_decrypt_requested",
          entityType: "correspondence_message",
          entityId: row.message.id,
          caseId: row.submission.caseId,
        },
      );
      return {
        messageId: row.message.id,
        subject: row.message.subject,
        from: row.message.fromAddress,
        downloadUrl: download.url,
        sha256: row.artifact.sha256,
        sizeBytes: row.artifact.sizeBytes,
      };
    },
  );
}
