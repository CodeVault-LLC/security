import { and, eq, sql } from "drizzle-orm";

import {
  ErrorResponse,
  IdParam,
  RemediationSla,
  RemediationSlaSettings,
  SetRemediationSlaRequest,
} from "@codevault/contracts";
import { conflict, notFound, type RemediationState } from "@codevault/core";
import { schema } from "@codevault/db";

import type { AppInstance } from "../../http/app-instance.js";
import { assertRevision } from "../../http/concurrency.js";
import { actingUser, principalOf, requireAuthor } from "../../http/guards.js";
import {
  requireCaseRead,
  requireCaseWrite,
} from "../../services/case-access.js";

export async function registerRemediationRoutes(
  app: AppInstance,
): Promise<void> {
  app.get(
    "/v1/findings/:id/remediation-sla",
    {
      schema: {
        params: IdParam,
        response: { 200: RemediationSlaSettings, 404: ErrorResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      const finding = await requireFinding(app, request.params.id);
      await requireCaseRead(app.db, user, finding.caseId);
      return { sla: await loadSla(app, finding) };
    },
  );

  app.patch(
    "/v1/findings/:id/remediation-sla",
    {
      schema: {
        params: IdParam,
        body: SetRemediationSlaRequest,
        response: {
          200: RemediationSla,
          400: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const finding = await requireFinding(app, request.params.id);
      await requireCaseWrite(app.db, user, finding.caseId);
      const current = await loadSla(app, finding);
      if (current !== null) {
        if (request.body.expectedRevision === undefined) {
          throw conflict("The remediation SLA already exists.");
        }
        assertRevision(
          current,
          request.body.expectedRevision,
          "remediation SLA",
        );
      }
      const now = new Date().toISOString();
      await app.db.transaction(async (tx) => {
        if (current === null) {
          await tx.insert(schema.remediationSlas).values({
            findingId: finding.id,
            startedAt: now,
            targetAt: request.body.targetAt,
            note: request.body.note?.trim() || null,
            createdBy: user.id,
            updatedBy: user.id,
          });
        } else {
          const [updated] = await tx
            .update(schema.remediationSlas)
            .set({
              targetAt: request.body.targetAt,
              ...(request.body.note === undefined
                ? {}
                : { note: request.body.note?.trim() || null }),
              updatedBy: user.id,
              revision: sql`${schema.remediationSlas.revision} + 1`,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(schema.remediationSlas.findingId, finding.id),
                eq(
                  schema.remediationSlas.revision,
                  request.body.expectedRevision!,
                ),
              ),
            )
            .returning({ id: schema.remediationSlas.findingId });
          if (updated === undefined) {
            throw conflict("The remediation SLA changed since you loaded it.");
          }
        }
        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action:
              current === null
                ? "finding.remediation_sla_created"
                : "finding.remediation_sla_updated",
            entityType: "finding",
            entityId: finding.id,
            caseId: finding.caseId,
            before: current,
            after: {
              targetAt: request.body.targetAt,
              note: request.body.note ?? current?.note ?? null,
            },
          },
        );
      });
      app.events.publish({
        type: "entity.changed",
        entityType: "finding",
        entityId: finding.id,
        caseId: finding.caseId,
      });
      const result = await loadSla(app, finding);
      if (result === null) throw notFound("Remediation SLA");
      return result;
    },
  );
}

interface FindingState {
  id: string;
  caseId: string;
  remediationState: RemediationState;
}

async function requireFinding(
  app: AppInstance,
  findingId: string,
): Promise<FindingState> {
  const [finding] = await app.db
    .select({
      id: schema.findings.id,
      caseId: schema.findings.caseId,
      remediationState: schema.findings.remediationState,
    })
    .from(schema.findings)
    .where(eq(schema.findings.id, findingId));
  if (finding === undefined) throw notFound("Finding");
  return finding;
}

async function loadSla(
  app: AppInstance,
  finding: FindingState,
): Promise<RemediationSla | null> {
  const [row] = await app.db
    .select()
    .from(schema.remediationSlas)
    .where(eq(schema.remediationSlas.findingId, finding.id));
  if (row === undefined) return null;
  const remainingDays = Math.ceil(
    (new Date(row.targetAt).getTime() - Date.now()) / 86_400_000,
  );
  return {
    ...row,
    remainingDays,
    status: remediationSlaStatus(finding.remediationState, remainingDays),
  };
}

export function remediationSlaStatus(
  remediationState: RemediationState,
  remainingDays: number,
): RemediationSla["status"] {
  if (["FIXED", "FIX_VERIFIED", "NOT_APPLICABLE"].includes(remediationState)) {
    return "MET";
  }
  if (remainingDays < 0) return "OVERDUE";
  if (remainingDays <= 7) return "AT_RISK";
  return "ON_TRACK";
}
