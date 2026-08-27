import { and, asc, desc, eq, inArray } from "drizzle-orm";

import {
  ErrorResponse,
  IdParam,
  type SubmissionRouteSnapshot,
  VendorResponseSla,
} from "@codevault/contracts";
import { addBusinessDays } from "@codevault/core";
import { schema } from "@codevault/db";

import type { AppInstance } from "../../http/app-instance.js";
import { actingUser } from "../../http/guards.js";
import { requireSubmissionRead } from "./service.js";

export async function registerVendorResponseSlaRoutes(
  app: AppInstance,
): Promise<void> {
  app.get(
    "/v1/submissions/:id/vendor-response-sla",
    {
      schema: {
        params: IdParam,
        response: { 200: VendorResponseSla, 404: ErrorResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      const submission = await requireSubmissionRead(
        app,
        user,
        request.params.id,
      );
      const deliveries = await app.db
        .select({ sentAt: schema.submissionDeliveries.sentAt })
        .from(schema.submissionDeliveries)
        .where(
          and(
            eq(schema.submissionDeliveries.submissionId, submission.id),
            inArray(schema.submissionDeliveries.status, [
              "SENT",
              "RECORDED_MANUALLY",
            ]),
          ),
        )
        .orderBy(desc(schema.submissionDeliveries.sentAt));
      const inbound = await app.db
        .select({
          receivedAt: schema.correspondenceMessages.receivedAt,
          createdAt: schema.correspondenceMessages.createdAt,
        })
        .from(schema.correspondenceMessages)
        .where(
          and(
            eq(schema.correspondenceMessages.submissionId, submission.id),
            eq(schema.correspondenceMessages.direction, "INBOUND"),
          ),
        )
        .orderBy(
          asc(schema.correspondenceMessages.receivedAt),
          asc(schema.correspondenceMessages.createdAt),
        );
      const outbound = await app.db
        .select({
          sentAt: schema.correspondenceMessages.sentAt,
          createdAt: schema.correspondenceMessages.createdAt,
        })
        .from(schema.correspondenceMessages)
        .where(
          and(
            eq(schema.correspondenceMessages.submissionId, submission.id),
            eq(schema.correspondenceMessages.direction, "OUTBOUND"),
          ),
        )
        .orderBy(
          asc(schema.correspondenceMessages.sentAt),
          asc(schema.correspondenceMessages.createdAt),
        );
      const snapshot = submission.routeSnapshot as SubmissionRouteSnapshot;
      return deriveVendorResponseSla({
        submissionId: submission.id,
        acknowledgementBusinessDays: snapshot.route.acknowledgementBusinessDays,
        updateCadenceDays: snapshot.route.updateCadenceDays,
        sentAt:
          deliveries.find((item) => item.sentAt !== null)?.sentAt ??
          outbound.find((item) => item.sentAt !== null)?.sentAt ??
          null,
        inboundAt: inbound.map((item) => item.receivedAt ?? item.createdAt),
        now: new Date().toISOString(),
      });
    },
  );
}

interface SlaInput {
  submissionId: string;
  acknowledgementBusinessDays: number;
  updateCadenceDays: number | null;
  sentAt: string | null;
  inboundAt: string[];
  now: string;
}

export function deriveVendorResponseSla(input: SlaInput): VendorResponseSla {
  if (input.sentAt === null) {
    return {
      submissionId: input.submissionId,
      status: "NOT_STARTED",
      acknowledgementBusinessDays: input.acknowledgementBusinessDays,
      updateCadenceDays: input.updateCadenceDays,
      sentAt: null,
      acknowledgementDueAt: null,
      firstResponseAt: null,
      lastResponseAt: null,
      nextUpdateDueAt: null,
      remainingDays: null,
    };
  }
  const acknowledgementDueAt = addBusinessDays(
    input.sentAt,
    input.acknowledgementBusinessDays,
  );
  const firstResponseAt = input.inboundAt[0] ?? null;
  const lastResponseAt = input.inboundAt.at(-1) ?? null;
  if (firstResponseAt === null) {
    const remainingDays = daysUntil(acknowledgementDueAt, input.now);
    return {
      submissionId: input.submissionId,
      status:
        remainingDays < 0
          ? "ACKNOWLEDGEMENT_OVERDUE"
          : "AWAITING_ACKNOWLEDGEMENT",
      acknowledgementBusinessDays: input.acknowledgementBusinessDays,
      updateCadenceDays: input.updateCadenceDays,
      sentAt: input.sentAt,
      acknowledgementDueAt,
      firstResponseAt: null,
      lastResponseAt: null,
      nextUpdateDueAt: null,
      remainingDays,
    };
  }
  if (input.updateCadenceDays === null) {
    return {
      submissionId: input.submissionId,
      status: "NO_UPDATE_CADENCE",
      acknowledgementBusinessDays: input.acknowledgementBusinessDays,
      updateCadenceDays: null,
      sentAt: input.sentAt,
      acknowledgementDueAt,
      firstResponseAt,
      lastResponseAt,
      nextUpdateDueAt: null,
      remainingDays: null,
    };
  }
  const nextUpdate = new Date(lastResponseAt!);
  nextUpdate.setUTCDate(nextUpdate.getUTCDate() + input.updateCadenceDays);
  const nextUpdateDueAt = nextUpdate.toISOString();
  const remainingDays = daysUntil(nextUpdateDueAt, input.now);
  return {
    submissionId: input.submissionId,
    status: remainingDays < 0 ? "UPDATE_OVERDUE" : "AWAITING_UPDATE",
    acknowledgementBusinessDays: input.acknowledgementBusinessDays,
    updateCadenceDays: input.updateCadenceDays,
    sentAt: input.sentAt,
    acknowledgementDueAt,
    firstResponseAt,
    lastResponseAt,
    nextUpdateDueAt,
    remainingDays,
  };
}

function daysUntil(target: string, now: string): number {
  return Math.ceil(
    (new Date(target).getTime() - new Date(now).getTime()) / 86_400_000,
  );
}
