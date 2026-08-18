import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Type } from "@sinclair/typebox";

import {
  CorrespondenceDecryptIntent,
  CorrespondenceMessage,
  CorrespondenceThread,
  CreateSubmissionReplyDraftRequest,
  ErrorResponse,
  SaveReviewedPlaintextRequest,
  SubmissionDetail,
  UpdateCorrespondenceClassificationRequest,
  Uuid,
} from "@codevault/contracts";
import { conflict, DomainError } from "@codevault/core";
import { schema } from "@codevault/db";

import type { AppInstance } from "../../http/app-instance.js";
import { actingUser, principalOf, requireAuthor } from "../../http/guards.js";
import {
  loadSubmissionDetail,
  requireSubmissionRead,
  requireSubmissionWrite,
  writeSubmissionRevision,
} from "./service.js";

const SubmissionParam = Type.Object({ id: Uuid });
const MessageParam = Type.Object({ id: Uuid, messageId: Uuid });
const DirectMessageParam = Type.Object({ messageId: Uuid });

type MessageRow = typeof schema.correspondenceMessages.$inferSelect;
type ArtifactRow = typeof schema.artifacts.$inferSelect;

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
        artifact.status === "PENDING"
          ? ("QUARANTINED" as const)
          : artifact.status,
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
    throw new DomainError("NOT_FOUND", "Correspondence message not found.");
  }
  return row;
}

export async function registerCorrespondenceRoutes(
  app: AppInstance,
): Promise<void> {
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
      return {
        items: messages.map((message) =>
          messageView(
            message,
            links
              .filter((link) => link.messageId === message.id)
              .map((link) => link.artifact),
          ),
        ),
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
      if (row === undefined)
        throw new DomainError("NOT_FOUND", "Correspondence message not found.");
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
