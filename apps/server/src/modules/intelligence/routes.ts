import { and, eq, sql } from "drizzle-orm";

import {
  ErrorResponse,
  IdParam,
  IntelligenceRefreshPolicy,
  IntelligenceRefreshQueued,
  IntelligenceRefreshSettings,
  SetIntelligenceRefreshPolicyRequest,
} from "@codevault/contracts";
import { conflict, notFound, validationError } from "@codevault/core";
import { schema } from "@codevault/db";

import type { AppInstance } from "../../http/app-instance.js";
import { assertRevision } from "../../http/concurrency.js";
import { actingUser, principalOf, requireAuthor } from "../../http/guards.js";
import {
  requireCaseRead,
  requireCaseWrite,
} from "../../services/case-access.js";
import { JOB_QUEUES } from "../../services/jobs.js";

const SCHEDULE_KEY_PREFIX = "finding-intelligence-";

export async function registerIntelligenceRoutes(
  app: AppInstance,
): Promise<void> {
  app.get(
    "/v1/findings/:id/intelligence-refresh",
    {
      schema: {
        params: IdParam,
        response: { 200: IntelligenceRefreshSettings, 404: ErrorResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      const finding = await requireFinding(app, request.params.id);
      await requireCaseRead(app.db, user, finding.caseId);
      return { policy: await loadPolicy(app, finding.id) };
    },
  );

  app.patch(
    "/v1/findings/:id/intelligence-refresh",
    {
      schema: {
        params: IdParam,
        body: SetIntelligenceRefreshPolicyRequest,
        response: {
          200: IntelligenceRefreshPolicy,
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
      const current = await loadPolicy(app, finding.id);
      if (current !== null) {
        if (request.body.expectedRevision === undefined) {
          throw conflict("The intelligence refresh policy already exists.");
        }
        assertRevision(
          current,
          request.body.expectedRevision,
          "intelligence refresh policy",
        );
      }

      const cveIds = await loadCveIds(app, finding.id);
      if (request.body.enabled && cveIds.length === 0) {
        throw validationError(
          "Add at least one CVE identifier before enabling intelligence refresh.",
        );
      }

      const scheduleKey = `${SCHEDULE_KEY_PREFIX}${finding.id}`;
      if (request.body.enabled) {
        await app.jobs.schedule(
          JOB_QUEUES.intelligenceRefresh,
          cronFor(request.body.cadence),
          { findingId: finding.id, cveIds, scheduled: true },
          scheduleKey,
        );
      } else {
        await app.jobs.unschedule(JOB_QUEUES.intelligenceRefresh, scheduleKey);
      }

      const next = await app.db.transaction(async (tx) => {
        const nextRunAt = request.body.enabled
          ? nextRun(request.body.cadence)
          : null;
        if (current === null) {
          const [inserted] = await tx
            .insert(schema.intelligenceRefreshPolicies)
            .values({
              findingId: finding.id,
              cadence: request.body.cadence,
              enabled: request.body.enabled,
              nextRunAt,
              createdBy: user.id,
            })
            .returning(policySelection);
          if (inserted === undefined) {
            throw conflict("The intelligence refresh policy was not created.");
          }
          return inserted;
        }

        const [updated] = await tx
          .update(schema.intelligenceRefreshPolicies)
          .set({
            cadence: request.body.cadence,
            enabled: request.body.enabled,
            nextRunAt,
            revision: sql`revision + 1`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(schema.intelligenceRefreshPolicies.findingId, finding.id),
              eq(
                schema.intelligenceRefreshPolicies.revision,
                request.body.expectedRevision!,
              ),
            ),
          )
          .returning(policySelection);
        if (updated === undefined) {
          throw conflict(
            "The intelligence refresh policy changed since you loaded it.",
          );
        }
        return updated;
      });

      await app.audit.write(
        app.db,
        {
          actorId: user.id,
          sessionId: principal.session.id,
          requestId: request.requestId,
        },
        {
          action:
            current === null
              ? "intelligence.refresh_policy_created"
              : "intelligence.refresh_policy_updated",
          entityType: "intelligence_refresh_policy",
          entityId: finding.id,
          caseId: finding.caseId,
          before:
            current === null
              ? null
              : { cadence: current.cadence, enabled: current.enabled },
          after: {
            cadence: request.body.cadence,
            enabled: request.body.enabled,
          },
        },
      );
      publish(app, finding.id, finding.caseId);
      return next;
    },
  );

  app.post(
    "/v1/findings/:id/intelligence-refresh/run",
    {
      schema: {
        params: IdParam,
        response: {
          200: IntelligenceRefreshQueued,
          400: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const finding = await requireFinding(app, request.params.id);
      await requireCaseWrite(app.db, user, finding.caseId);
      const cveIds = await loadCveIds(app, finding.id);
      if (cveIds.length === 0) {
        throw validationError(
          "Add at least one CVE identifier before refreshing intelligence.",
        );
      }
      await app.jobs.send(
        JOB_QUEUES.intelligenceRefresh,
        { findingId: finding.id, cveIds },
        { singletonKey: `manual-${finding.id}` },
      );
      const queuedAt = new Date().toISOString();
      await app.db
        .update(schema.intelligenceRefreshPolicies)
        .set({ lastQueuedAt: queuedAt, updatedAt: sql`now()` })
        .where(eq(schema.intelligenceRefreshPolicies.findingId, finding.id));
      await app.audit.write(
        app.db,
        {
          actorId: user.id,
          sessionId: principal.session.id,
          requestId: request.requestId,
        },
        {
          action: "intelligence.refresh_queued",
          entityType: "finding",
          entityId: finding.id,
          caseId: finding.caseId,
          after: { cveIds },
        },
      );
      publish(app, finding.id, finding.caseId);
      return { findingId: finding.id, queuedAt, cveIds };
    },
  );
}

const policySelection = {
  findingId: schema.intelligenceRefreshPolicies.findingId,
  cadence: schema.intelligenceRefreshPolicies.cadence,
  enabled: schema.intelligenceRefreshPolicies.enabled,
  lastQueuedAt: schema.intelligenceRefreshPolicies.lastQueuedAt,
  nextRunAt: schema.intelligenceRefreshPolicies.nextRunAt,
  revision: schema.intelligenceRefreshPolicies.revision,
  createdAt: schema.intelligenceRefreshPolicies.createdAt,
  updatedAt: schema.intelligenceRefreshPolicies.updatedAt,
};

async function requireFinding(
  app: AppInstance,
  findingId: string,
): Promise<{ id: string; caseId: string }> {
  const [finding] = await app.db
    .select({ id: schema.findings.id, caseId: schema.findings.caseId })
    .from(schema.findings)
    .where(eq(schema.findings.id, findingId));
  if (finding === undefined) throw notFound("Finding");
  return finding;
}

async function loadPolicy(
  app: AppInstance,
  findingId: string,
): Promise<IntelligenceRefreshPolicy | null> {
  const [policy] = await app.db
    .select(policySelection)
    .from(schema.intelligenceRefreshPolicies)
    .where(eq(schema.intelligenceRefreshPolicies.findingId, findingId));
  return policy ?? null;
}

async function loadCveIds(
  app: AppInstance,
  findingId: string,
): Promise<string[]> {
  const identifiers = await app.db
    .select({ value: schema.findingIdentifiers.value })
    .from(schema.findingIdentifiers)
    .where(
      and(
        eq(schema.findingIdentifiers.findingId, findingId),
        eq(schema.findingIdentifiers.scheme, "CVE"),
      ),
    );
  return [...new Set(identifiers.map((item) => item.value.toUpperCase()))];
}

function cronFor(cadence: "DAILY" | "WEEKLY"): string {
  return cadence === "DAILY" ? "0 3 * * *" : "0 3 * * 1";
}

function nextRun(cadence: "DAILY" | "WEEKLY"): string {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(3, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  if (cadence === "WEEKLY") {
    const daysToMonday = (8 - next.getUTCDay()) % 7;
    next.setUTCDate(next.getUTCDate() + daysToMonday);
  }
  return next.toISOString();
}

function publish(app: AppInstance, findingId: string, caseId: string): void {
  app.events.publish({
    type: "entity.changed",
    entityType: "intelligence_refresh_policy",
    entityId: findingId,
    caseId,
  });
}
