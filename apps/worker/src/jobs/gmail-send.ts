import {
  MailProviderError,
  type SentMessage,
} from "@codevault/server/mail/provider";
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";

import { addBusinessDays } from "@codevault/core";
import { schema } from "@codevault/db";
import { decryptSecret } from "@codevault/server/mail/token-crypto";
import type { GmailSendJobData } from "@codevault/server/services/jobs";

import type { WorkerContext } from "../context.js";

export interface ClaimedDelivery {
  deliveryId: string;
  attemptNumber: number;
  accessToken: string;
  rawMessage: Uint8Array;
  rfcMessageId: string;
  providerThreadId: string | null;
}

export interface DeliveryResult extends SentMessage {
  deliveryId: string;
  attemptNumber: number;
  reconciled: boolean;
  responseSizeBytes: number;
}

export interface GmailSendDependencies {
  claim(deliveryId: string): Promise<ClaimedDelivery | null>;
  findByRfcMessageId(
    accessToken: string,
    rfcMessageId: string,
  ): Promise<SentMessage | null>;
  send(
    accessToken: string,
    rawMessage: Uint8Array,
    threadId?: string,
  ): Promise<SentMessage>;
  recordSent(result: DeliveryResult): Promise<void>;
  recordFailed(input: {
    deliveryId: string;
    attemptNumber: number;
    category: string;
    message: string;
  }): Promise<void>;
  recordUnknown(input: {
    deliveryId: string;
    attemptNumber: number;
    category: string;
    message: string;
  }): Promise<void>;
}

function failureDetails(error: unknown): {
  category: string;
  message: string;
  ambiguous: boolean;
} {
  if (error instanceof MailProviderError) {
    return {
      category: error.category,
      message: error.message.slice(0, 300),
      ambiguous: error.deliveryAmbiguous,
    };
  }
  if (
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return {
      category: "GMAIL_TIMEOUT",
      message: "Gmail did not confirm whether the message was accepted.",
      ambiguous: true,
    };
  }
  return {
    category: "GMAIL_TRANSPORT_ERROR",
    message: "Gmail delivery failed before a result could be confirmed.",
    ambiguous: true,
  };
}

/** Exactly-once-oriented delivery: reconcile by stable Message-ID around send. */
export async function sendDelivery(
  dependencies: GmailSendDependencies,
  deliveryId: string,
): Promise<void> {
  const claimed = await dependencies.claim(deliveryId);
  if (claimed === null) return;

  let existing: SentMessage | null = null;
  try {
    existing = await dependencies.findByRfcMessageId(
      claimed.accessToken,
      claimed.rfcMessageId,
    );
  } catch {
    if (claimed.attemptNumber > 1) {
      await dependencies.recordUnknown({
        deliveryId,
        attemptNumber: claimed.attemptNumber,
        category: "GMAIL_RECONCILIATION_UNAVAILABLE",
        message:
          "CodeVault could not safely determine whether Gmail already accepted this message.",
      });
      return;
    }
    // gmail.send alone cannot search a mailbox. The first attempt may proceed;
    // any later retry is blocked above unless reconciliation succeeds.
  }
  if (existing !== null) {
    await dependencies.recordSent({
      ...existing,
      deliveryId,
      attemptNumber: claimed.attemptNumber,
      reconciled: true,
      responseSizeBytes: 0,
    });
    return;
  }

  try {
    const sent = await dependencies.send(
      claimed.accessToken,
      claimed.rawMessage,
      claimed.providerThreadId ?? undefined,
    );
    await dependencies.recordSent({
      ...sent,
      deliveryId,
      attemptNumber: claimed.attemptNumber,
      reconciled: false,
      responseSizeBytes: JSON.stringify(sent).length,
    });
  } catch (error: unknown) {
    const failure = failureDetails(error);
    if (!failure.ambiguous) {
      await dependencies.recordFailed({
        deliveryId,
        attemptNumber: claimed.attemptNumber,
        category: failure.category,
        message: failure.message,
      });
      return;
    }

    let reconciled: SentMessage | null = null;
    try {
      reconciled = await dependencies.findByRfcMessageId(
        claimed.accessToken,
        claimed.rfcMessageId,
      );
    } catch {
      // A failed reconciliation is still ambiguous; never turn it into a retry.
    }
    if (reconciled !== null) {
      await dependencies.recordSent({
        ...reconciled,
        deliveryId,
        attemptNumber: claimed.attemptNumber,
        reconciled: true,
        responseSizeBytes: 0,
      });
      return;
    }

    await dependencies.recordUnknown({
      deliveryId,
      attemptNumber: claimed.attemptNumber,
      category: failure.category,
      message: failure.message,
    });
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Rejects multiple/folded/conflicting From headers and enforces server identity. */
export function assertSenderHeader(raw: Uint8Array, expected: string): void {
  const headerEnd = Buffer.from(raw).indexOf("\r\n\r\n");
  if (headerEnd < 0 || headerEnd > 128 * 1024) {
    throw new Error("The sealed email has invalid transport headers.");
  }
  const unfolded = Buffer.from(raw.subarray(0, headerEnd))
    .toString("utf8")
    .replace(/\r\n[ \t]+/g, " ");
  const from = unfolded.split("\r\n").filter((line) => /^from:/i.test(line));
  if (from.length !== 1)
    throw new Error("The sealed email must have exactly one From header.");
  const value = from[0]!.slice(from[0]!.indexOf(":") + 1).trim();
  const bracketed = /<([^<>]+)>/.exec(value)?.[1];
  const address = (bracketed ?? value).trim().toLowerCase();
  if (address !== expected.toLowerCase()) {
    throw new Error(
      "The sealed From address does not match the connected Gmail mailbox.",
    );
  }
}

export async function runGmailSend(
  context: WorkerContext,
  data: GmailSendJobData,
): Promise<void> {
  if (!context.config.gmail.enabled) {
    throw new Error("Gmail delivery is disabled.");
  }
  const gmailConfig = context.config.gmail;
  const provider = context.mailProviders.require("gmail");

  const dependencies: GmailSendDependencies = {
    async claim(deliveryId) {
      const claimed = await context.db.transaction(async (tx) => {
        const [delivery] = await tx
          .select()
          .from(schema.submissionDeliveries)
          .where(
            and(
              eq(schema.submissionDeliveries.id, deliveryId),
              inArray(schema.submissionDeliveries.status, [
                "QUEUED",
                "SENDING",
              ]),
            ),
          )
          .limit(1);
        if (delivery === undefined) return null;
        const [count] = await tx
          .select({ value: sql<number>`count(*)::integer` })
          .from(schema.submissionDeliveryAttempts)
          .where(eq(schema.submissionDeliveryAttempts.deliveryId, delivery.id));
        const attemptNumber = (count?.value ?? 0) + 1;
        await tx
          .update(schema.submissionDeliveries)
          .set({
            status: "SENDING",
            revision: delivery.revision + 1,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.submissionDeliveries.id, delivery.id));
        await tx.insert(schema.submissionDeliveryAttempts).values({
          deliveryId: delivery.id,
          attemptNumber,
          outcome: "SENDING",
          startedAt: new Date().toISOString(),
        });
        return { delivery, attemptNumber };
      });
      if (claimed === null) return null;

      const [material] = await context.db
        .select({
          delivery: schema.submissionDeliveries,
          pkg: schema.submissionPackages,
          artifact: schema.artifacts,
          mailbox: schema.mailboxConnections,
        })
        .from(schema.submissionDeliveries)
        .innerJoin(
          schema.submissionPackages,
          eq(
            schema.submissionPackages.id,
            schema.submissionDeliveries.packageId,
          ),
        )
        .innerJoin(
          schema.artifacts,
          eq(schema.artifacts.id, schema.submissionPackages.artifactId),
        )
        .innerJoin(
          schema.mailboxConnections,
          eq(
            schema.mailboxConnections.id,
            schema.submissionDeliveries.mailboxConnectionId,
          ),
        )
        .where(eq(schema.submissionDeliveries.id, deliveryId))
        .limit(1);
      if (
        material === undefined ||
        material.pkg.rfcMessageId === null ||
        material.delivery.senderAddress === null
      ) {
        throw new Error("The Gmail delivery material is incomplete.");
      }
      const rawMessage = await context.storage.getObject(
        material.artifact.objectKey,
      );
      if (
        rawMessage.byteLength !== material.pkg.sizeBytes ||
        sha256(rawMessage) !== material.pkg.packageSha256
      ) {
        throw new Error(
          "The sealed email failed its stored digest or size check.",
        );
      }
      assertSenderHeader(rawMessage, material.delivery.senderAddress);
      if (
        material.delivery.senderAddress.toLowerCase() !==
        material.mailbox.emailAddress.toLowerCase()
      ) {
        throw new Error("The selected Gmail identity changed after sealing.");
      }
      const refreshToken = decryptSecret(
        {
          ciphertext: material.mailbox.refreshTokenCiphertext,
          nonce: material.mailbox.refreshTokenNonce,
          authTag: material.mailbox.refreshTokenAuthTag,
          keyVersion: material.mailbox.tokenKeyVersion,
        },
        gmailConfig.tokenKeyring,
        {
          provider: "gmail",
          connectionId: material.mailbox.id,
          userId: material.mailbox.userId,
        },
      );
      const access = await provider.refreshAccessToken(refreshToken);
      return {
        deliveryId,
        attemptNumber: claimed.attemptNumber,
        accessToken: access.accessToken,
        rawMessage,
        rfcMessageId: material.pkg.rfcMessageId,
        providerThreadId: material.delivery.providerThreadId,
      };
    },

    findByRfcMessageId: (accessToken, rfcMessageId) =>
      provider.findByRfcMessageId(accessToken, rfcMessageId),
    send: (accessToken, rawMessage, threadId) =>
      provider.send(accessToken, rawMessage, threadId),

    async recordSent(result) {
      await context.db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            delivery: schema.submissionDeliveries,
            pkg: schema.submissionPackages,
            submission: schema.submissions,
            organizationId: schema.cases.organizationId,
          })
          .from(schema.submissionDeliveries)
          .innerJoin(
            schema.submissionPackages,
            eq(
              schema.submissionPackages.id,
              schema.submissionDeliveries.packageId,
            ),
          )
          .innerJoin(
            schema.submissions,
            eq(schema.submissions.id, schema.submissionDeliveries.submissionId),
          )
          .innerJoin(
            schema.cases,
            eq(schema.cases.id, schema.submissions.caseId),
          )
          .where(eq(schema.submissionDeliveries.id, result.deliveryId))
          .limit(1);
        if (row === undefined || row.delivery.status === "SENT") return;
        const now = new Date().toISOString();
        await tx
          .update(schema.submissionDeliveryAttempts)
          .set({
            outcome: "SENT",
            providerRequestId: result.providerMessageId,
            completedAt: now,
          })
          .where(
            and(
              eq(
                schema.submissionDeliveryAttempts.deliveryId,
                result.deliveryId,
              ),
              eq(
                schema.submissionDeliveryAttempts.attemptNumber,
                result.attemptNumber,
              ),
            ),
          );
        await tx
          .update(schema.submissionDeliveries)
          .set({
            status: "SENT",
            providerMessageId: result.providerMessageId,
            providerThreadId: result.providerThreadId,
            sentAt: now,
            responseSizeBytes: result.responseSizeBytes,
            errorCategory: null,
            errorMessage: null,
            revision: row.delivery.revision + 1,
            updatedAt: now,
          })
          .where(eq(schema.submissionDeliveries.id, result.deliveryId));

        const route = row.delivery.routeSnapshot.route as {
          acknowledgementBusinessDays?: number;
        };
        const nextRevision = row.submission.revision + 1;
        await tx
          .update(schema.submissions)
          .set({
            status: "SENT",
            coordinationState: "AWAITING_ACKNOWLEDGEMENT",
            plannedNextContactAt: addBusinessDays(
              now,
              route.acknowledgementBusinessDays ?? 5,
            ),
            revision: nextRevision,
            updatedAt: now,
          })
          .where(eq(schema.submissions.id, row.submission.id));
        await tx.insert(schema.submissionRevisions).values({
          submissionId: row.submission.id,
          revision: nextRevision,
          subject: row.submission.subject,
          bodyMarkdown: row.submission.bodyMarkdown,
          manualFields: row.submission.manualFields,
          cryptoMode: row.submission.cryptoMode,
          authoredBy: row.delivery.createdBy,
        });
        await tx.insert(schema.correspondenceMessages).values({
          submissionId: row.submission.id,
          deliveryId: row.delivery.id,
          mailboxConnectionId: row.delivery.mailboxConnectionId,
          direction: "OUTBOUND",
          providerMessageId: result.providerMessageId,
          providerThreadId: result.providerThreadId,
          rfcMessageId: row.pkg.rfcMessageId!,
          inReplyTo:
            (row.pkg.manifest as { threading?: { inReplyTo: string } | null })
              .threading?.inReplyTo ?? null,
          references:
            (
              row.pkg.manifest as {
                threading?: { references: string[] } | null;
              }
            ).threading?.references ?? [],
          fromAddress: row.delivery.senderAddress!,
          toAddresses: row.delivery.recipients.to,
          ccAddresses: row.delivery.recipients.cc,
          subject: row.submission.subject,
          bodyText: row.submission.bodyMarkdown,
          bodyEncrypted:
            row.submission.cryptoMode === "PLAIN" ? "PLAIN" : "OPENPGP",
          rawArtifactId: row.pkg.artifactId,
          classification: "OTHER",
          visibility: "VENDOR",
          sentAt: now,
        });
        await tx.insert(schema.disclosureEvents).values({
          caseId: row.submission.caseId,
          type: "DETAILS_SENT",
          occurredAt: now,
          detailMarkdown: `Gmail delivery confirmed. Package SHA-256: ${row.pkg.packageSha256}`,
          artifactIds: [row.pkg.artifactId],
          visibility: "VENDOR",
          recordedBy: row.delivery.createdBy,
        });
        await tx.insert(schema.auditEvents).values({
          organizationId: row.organizationId,
          action: "submission.send_succeeded",
          entityType: "submission_delivery",
          entityId: row.delivery.id,
          caseId: row.submission.caseId,
          actorId: row.delivery.createdBy,
          after: {
            providerMessageId: result.providerMessageId,
            providerThreadId: result.providerThreadId,
            packageSha256: row.pkg.packageSha256,
            reconciled: result.reconciled,
          },
        });
      });
    },

    recordFailed: (failure) => recordFailure(context, failure, false),
    recordUnknown: (failure) => recordFailure(context, failure, true),
  };

  try {
    await sendDelivery(dependencies, data.deliveryId);
  } catch (error: unknown) {
    const [attempt] = await context.db
      .select({
        attemptNumber: schema.submissionDeliveryAttempts.attemptNumber,
      })
      .from(schema.submissionDeliveryAttempts)
      .where(eq(schema.submissionDeliveryAttempts.deliveryId, data.deliveryId))
      .orderBy(sql`${schema.submissionDeliveryAttempts.attemptNumber} DESC`)
      .limit(1);
    if (attempt === undefined) throw error;
    await recordFailure(
      context,
      {
        deliveryId: data.deliveryId,
        attemptNumber: attempt.attemptNumber,
        category:
          error instanceof MailProviderError
            ? error.category
            : "DELIVERY_PRECONDITION_FAILED",
        message:
          error instanceof MailProviderError
            ? error.message.slice(0, 300)
            : "The sealed package or mailbox failed a required delivery check.",
      },
      false,
    );
  }
}

async function recordFailure(
  context: WorkerContext,
  failure: {
    deliveryId: string;
    attemptNumber: number;
    category: string;
    message: string;
  },
  ambiguous: boolean,
): Promise<void> {
  await context.db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        delivery: schema.submissionDeliveries,
        submission: schema.submissions,
        organizationId: schema.cases.organizationId,
      })
      .from(schema.submissionDeliveries)
      .innerJoin(
        schema.submissions,
        eq(schema.submissions.id, schema.submissionDeliveries.submissionId),
      )
      .innerJoin(schema.cases, eq(schema.cases.id, schema.submissions.caseId))
      .where(eq(schema.submissionDeliveries.id, failure.deliveryId))
      .limit(1);
    if (row === undefined || row.delivery.status === "SENT") return;
    const now = new Date().toISOString();
    await tx
      .update(schema.submissionDeliveryAttempts)
      .set({
        outcome: ambiguous ? "DELIVERY_UNKNOWN" : "FAILED",
        errorCategory: failure.category,
        errorMessage: failure.message,
        completedAt: now,
      })
      .where(
        and(
          eq(schema.submissionDeliveryAttempts.deliveryId, failure.deliveryId),
          eq(
            schema.submissionDeliveryAttempts.attemptNumber,
            failure.attemptNumber,
          ),
        ),
      );
    await tx
      .update(schema.submissionDeliveries)
      .set({
        status: ambiguous ? "DELIVERY_UNKNOWN" : "FAILED",
        errorCategory: failure.category,
        errorMessage: failure.message,
        revision: row.delivery.revision + 1,
        updatedAt: now,
      })
      .where(eq(schema.submissionDeliveries.id, failure.deliveryId));
    if (!ambiguous) {
      const nextRevision = row.submission.revision + 1;
      await tx
        .update(schema.submissions)
        .set({ status: "SEND_FAILED", revision: nextRevision, updatedAt: now })
        .where(eq(schema.submissions.id, row.submission.id));
      await tx.insert(schema.submissionRevisions).values({
        submissionId: row.submission.id,
        revision: nextRevision,
        subject: row.submission.subject,
        bodyMarkdown: row.submission.bodyMarkdown,
        manualFields: row.submission.manualFields,
        cryptoMode: row.submission.cryptoMode,
        authoredBy: row.delivery.createdBy,
      });
    }
    await tx.insert(schema.auditEvents).values({
      organizationId: row.organizationId,
      action: ambiguous ? "submission.send_unknown" : "submission.send_failed",
      entityType: "submission_delivery",
      entityId: row.delivery.id,
      caseId: row.submission.caseId,
      actorId: row.delivery.createdBy,
      after: { errorCategory: failure.category },
    });
  });
}
