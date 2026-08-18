import {
  addBusinessDays,
  type CoordinationState,
  type MessageClassification,
} from "@codevault/core";
import { and, eq } from "drizzle-orm";

import {
  ErrorResponse,
  SubmissionDetail,
  UpdateSubmissionLifecycleRequest,
  Uuid,
} from "@codevault/contracts";
import { conflict, validationError } from "@codevault/core";
import { schema } from "@codevault/db";
import { Type } from "@sinclair/typebox";

import type { AppInstance } from "../../http/app-instance.js";
import { principalOf, requireAuthor } from "../../http/guards.js";
import {
  loadSubmissionDetail,
  requireSubmissionWrite,
  writeSubmissionRevision,
} from "./service.js";

export type SubmissionNextActionKind =
  | "SUBMISSION_SEND_FAILED"
  | "GMAIL_RECONNECT_REQUIRED"
  | "VENDOR_REPLY_NEEDS_REVIEW"
  | "VENDOR_INFORMATION_REQUEST_PENDING"
  | "VENDOR_ACKNOWLEDGEMENT_OVERDUE"
  | "VENDOR_UPDATE_OVERDUE"
  | "DISCLOSURE_DATE_APPROACHING"
  | "NONE";

export interface SubmissionLifecycleFacts {
  coordinationState: CoordinationState;
  deliveryStatus: string | null;
  mailboxStatus: string | null;
  lastOutboundAt: string | null;
  lastInboundAt: string | null;
  lastInboundClassification: MessageClassification | null;
  plannedNextContactAt?: string | null;
  acknowledgementBusinessDays: number;
  updateCadenceDays: number;
  agreedDisclosureAt: string | null;
  snoozedUntil: string | null;
  now?: string;
}

export interface SubmissionNextAction {
  kind: SubmissionNextActionKind;
  dueAt: string | null;
  detail: string | null;
}

function addDays(value: string, days: number): string {
  return new Date(Date.parse(value) + days * 86_400_000).toISOString();
}

export function deriveSubmissionNextAction(
  facts: SubmissionLifecycleFacts,
): SubmissionNextAction {
  const now = facts.now ?? new Date().toISOString();
  const nowMs = Date.parse(now);
  if (facts.snoozedUntil !== null && Date.parse(facts.snoozedUntil) > nowMs) {
    return {
      kind: "NONE",
      dueAt: facts.snoozedUntil,
      detail: "Snoozed by a researcher.",
    };
  }
  if (["FAILED", "DELIVERY_UNKNOWN"].includes(facts.deliveryStatus ?? "")) {
    return {
      kind: "SUBMISSION_SEND_FAILED",
      dueAt: now,
      detail:
        facts.deliveryStatus === "DELIVERY_UNKNOWN"
          ? "Gmail may have accepted the message. Reconcile before any retry."
          : "Gmail rejected or could not prepare the message.",
    };
  }
  if (
    facts.mailboxStatus !== null &&
    ["REAUTH_REQUIRED", "WATCH_EXPIRED", "ERROR"].includes(facts.mailboxStatus)
  ) {
    return {
      kind: "GMAIL_RECONNECT_REQUIRED",
      dueAt: now,
      detail: "The selected Gmail connection needs attention.",
    };
  }
  if (
    facts.lastInboundAt !== null &&
    facts.lastInboundClassification === "UNREVIEWED"
  ) {
    return {
      kind: "VENDOR_REPLY_NEEDS_REVIEW",
      dueAt: facts.lastInboundAt,
      detail: "A reply arrived and still needs human review.",
    };
  }
  if (
    facts.coordinationState === "NEEDS_INFORMATION" &&
    facts.lastInboundClassification === "REQUEST_FOR_INFORMATION" &&
    (facts.lastOutboundAt === null ||
      (facts.lastInboundAt !== null &&
        Date.parse(facts.lastOutboundAt) < Date.parse(facts.lastInboundAt)))
  ) {
    return {
      kind: "VENDOR_INFORMATION_REQUEST_PENDING",
      dueAt: facts.lastInboundAt,
      detail:
        "The vendor requested information and no reviewed reply has been sent.",
    };
  }
  if (
    facts.plannedNextContactAt != null &&
    Date.parse(facts.plannedNextContactAt) <= nowMs
  ) {
    return {
      kind: "VENDOR_UPDATE_OVERDUE",
      dueAt: facts.plannedNextContactAt,
      detail: "The explicitly planned next contact is overdue.",
    };
  }
  if (
    facts.coordinationState === "AWAITING_ACKNOWLEDGEMENT" &&
    facts.lastOutboundAt !== null &&
    (facts.lastInboundAt === null ||
      facts.lastInboundClassification === "AUTO_REPLY")
  ) {
    const dueAt = addBusinessDays(
      facts.lastOutboundAt,
      facts.acknowledgementBusinessDays,
    );
    if (Date.parse(dueAt) <= nowMs) {
      return {
        kind: "VENDOR_ACKNOWLEDGEMENT_OVERDUE",
        dueAt,
        detail: "No human acknowledgement was recorded by the route deadline.",
      };
    }
  }
  if (
    [
      "ACKNOWLEDGED",
      "IN_TRIAGE",
      "IN_REMEDIATION",
      "COORDINATING_DISCLOSURE",
    ].includes(facts.coordinationState)
  ) {
    const latest = [facts.lastInboundAt, facts.lastOutboundAt]
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1);
    if (latest !== undefined) {
      const dueAt = addDays(latest, facts.updateCadenceDays);
      if (Date.parse(dueAt) <= nowMs) {
        return {
          kind: "VENDOR_UPDATE_OVERDUE",
          dueAt,
          detail: "No update was recorded within the route cadence.",
        };
      }
    }
  }
  if (
    facts.agreedDisclosureAt !== null &&
    Date.parse(facts.agreedDisclosureAt) <= nowMs + 14 * 86_400_000
  ) {
    return {
      kind: "DISCLOSURE_DATE_APPROACHING",
      dueAt: facts.agreedDisclosureAt,
      detail: "The agreed disclosure date is approaching.",
    };
  }
  return { kind: "NONE", dueAt: null, detail: null };
}

const SubmissionParam = Type.Object({ id: Uuid });

export function validateLifecycleUpdate(input: {
  coordinationState: CoordinationState;
  coordinationNotes: string | null;
  snoozedUntil: string | null;
  snoozeReason: string | null;
  now?: string;
}): void {
  if (
    ["RESOLVED", "CLOSED"].includes(input.coordinationState) &&
    (input.coordinationNotes ?? "").trim().length < 5
  ) {
    throw validationError(
      "Resolved or closed coordination requires a short outcome note.",
    );
  }
  const snoozeReason = input.snoozeReason?.trim() || null;
  if ((input.snoozedUntil === null) !== (snoozeReason === null)) {
    throw validationError(
      "A snooze date and reason must be set or cleared together.",
    );
  }
  if (input.snoozedUntil !== null) {
    const now = Date.parse(input.now ?? new Date().toISOString());
    const until = Date.parse(input.snoozedUntil);
    if (until <= now || until > now + 180 * 86_400_000) {
      throw validationError(
        "Snooze until a future date no more than 180 days away.",
      );
    }
    if ((snoozeReason ?? "").length < 5) {
      throw validationError("Explain why coordination is being snoozed.");
    }
  }
}

export async function registerSubmissionLifecycleRoutes(
  app: AppInstance,
): Promise<void> {
  app.patch(
    "/v1/submissions/:id/lifecycle",
    {
      schema: {
        params: SubmissionParam,
        body: UpdateSubmissionLifecycleRequest,
        response: {
          200: SubmissionDetail,
          400: ErrorResponse,
          409: ErrorResponse,
        },
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
      if (submission.revision !== request.body.expectedRevision) {
        throw conflict("The submission changed since it was loaded.");
      }
      validateLifecycleUpdate(request.body);
      const vendorReference = request.body.vendorReference?.trim() || null;
      const coordinationNotes = request.body.coordinationNotes?.trim() || null;
      const snoozeReason = request.body.snoozeReason?.trim() || null;
      await app.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(schema.submissions)
          .set({
            coordinationState: request.body.coordinationState,
            plannedNextContactAt: request.body.plannedNextContactAt,
            agreedDisclosureAt: request.body.agreedDisclosureAt,
            vendorReference,
            coordinationNotes,
            snoozedUntil: request.body.snoozedUntil,
            snoozeReason,
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
            action: "submission.lifecycle_updated",
            entityType: "submission",
            entityId: submission.id,
            caseId: submission.caseId,
            before: { coordinationState: submission.coordinationState },
            after: {
              coordinationState: request.body.coordinationState,
              plannedNextContactAt: request.body.plannedNextContactAt,
              agreedDisclosureAt: request.body.agreedDisclosureAt,
              snoozedUntil: request.body.snoozedUntil,
              hasCoordinationNotes: coordinationNotes !== null,
            },
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
}
