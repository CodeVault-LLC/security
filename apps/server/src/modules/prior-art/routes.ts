import type { AppInstance } from "../../http/app-instance.js";
import { desc, eq, sql } from "drizzle-orm";

import {
  ConcludePriorArtCheckRequest,
  ErrorResponse,
  IdParam,
  PriorArtCheck,
  PriorArtDiff,
  StartPriorArtCheckRequest,
} from "@codevault/contracts";
import {
  DomainError,
  isHumanOnlyPriorArtState,
  notFound,
  validationError,
} from "@codevault/core";
import type { Database } from "@codevault/db";
import { schema } from "@codevault/db";
import { Type } from "@sinclair/typebox";

import { actingUser, principalOf, requireAuthor } from "../../http/guards.js";
import { JOB_QUEUES } from "../../services/jobs.js";
import {
  requireCaseRead,
  requireCaseWrite,
} from "../../services/case-access.js";

/**
 * Prior-art routes.
 *
 * A check is a record of what was searched and when. The conclusion is always a
 * person's: the API accepts an AI analysis as advisory data on the check, and
 * separately accepts a human conclusion that is the only thing which moves the
 * finding's prior-art state.
 */

const CheckListResponse = Type.Object({ items: Type.Array(PriorArtCheck) });

export async function registerPriorArtRoutes(app: AppInstance): Promise<void> {
  app.post(
    "/v1/findings/:id/prior-art-checks",
    {
      schema: {
        params: IdParam,
        body: StartPriorArtCheckRequest,
        response: { 200: PriorArtCheck, 404: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const finding = await requireFinding(app, request.params.id);

      await requireCaseWrite(app.db, user, finding.caseId);

      const [check] = await app.db
        .insert(schema.priorArtChecks)
        .values({
          findingId: finding.id,
          status: "QUEUED",
          startedBy: user.id,
        })
        .returning({ id: schema.priorArtChecks.id });

      if (check === undefined) {
        throw new DomainError("SERVER_ERROR", "Could not start the check.");
      }

      await app.jobs.send(JOB_QUEUES.priorArt, {
        checkId: check.id,
        findingId: finding.id,
        caseId: finding.caseId,
        keywords: request.body.keywords ?? [],
        skipAiSynthesis: request.body.skipAiSynthesis ?? false,
      });

      await app.audit.write(
        app.db,
        {
          actorId: user.id,
          sessionId: principal.session.id,
          requestId: request.requestId,
        },
        {
          action: "prior_art.check_started",
          entityType: "prior_art_check",
          entityId: check.id,
          caseId: finding.caseId,
          after: { findingId: finding.id },
        },
      );

      const result = await loadCheck(app.db, check.id);

      if (result === null) {
        throw notFound("Prior-art check");
      }

      return result;
    },
  );

  app.get(
    "/v1/findings/:id/prior-art-checks",
    { schema: { params: IdParam, response: { 200: CheckListResponse } } },
    async (request) => {
      const user = actingUser(request);
      const finding = await requireFinding(app, request.params.id);

      await requireCaseRead(app.db, user, finding.caseId);

      const rows = await app.db
        .select({ id: schema.priorArtChecks.id })
        .from(schema.priorArtChecks)
        .where(eq(schema.priorArtChecks.findingId, finding.id))
        .orderBy(desc(schema.priorArtChecks.startedAt))
        .limit(20);

      const checks = [];

      for (const row of rows) {
        const check = await loadCheck(app.db, row.id);

        if (check !== null) {
          checks.push(check);
        }
      }

      return { items: checks };
    },
  );

  app.post(
    "/v1/prior-art-checks/:id/conclude",
    {
      schema: {
        params: IdParam,
        body: ConcludePriorArtCheckRequest,
        response: { 200: PriorArtCheck, 400: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const body = request.body;

      const rows = await app.db
        .select()
        .from(schema.priorArtChecks)
        .where(eq(schema.priorArtChecks.id, request.params.id))
        .limit(1);

      const check = rows[0];

      if (check === undefined) {
        throw notFound("Prior-art check");
      }

      const finding = await requireFinding(app, check.findingId);

      await requireCaseWrite(app.db, user, finding.caseId);

      if (check.status === "QUEUED" || check.status === "RUNNING") {
        throw validationError(
          "Wait for the check to finish before recording a conclusion.",
        );
      }

      if (body.conclusion === "UNCHECKED") {
        throw validationError("UNCHECKED is not a conclusion.");
      }

      await app.db.transaction(async (tx) => {
        await tx
          .update(schema.priorArtChecks)
          .set({
            humanConclusion: body.conclusion,
            concludedBy: user.id,
            concludedAt: sql`now()`,
            conclusionNote: body.note ?? null,
          })
          .where(eq(schema.priorArtChecks.id, check.id));

        await tx
          .update(schema.findings)
          .set({ priorArtState: body.conclusion, updatedAt: sql`now()` })
          .where(eq(schema.findings.id, finding.id));

        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: isHumanOnlyPriorArtState(body.conclusion)
              ? "prior_art.human_confirmed_novel"
              : "prior_art.concluded",
            entityType: "finding",
            entityId: finding.id,
            caseId: finding.caseId,
            before: { priorArtState: finding.priorArtState },
            after: { priorArtState: body.conclusion, checkId: check.id },
          },
        );
      });

      const result = await loadCheck(app.db, check.id);

      if (result === null) {
        throw notFound("Prior-art check");
      }

      return result;
    },
  );

  app.get(
    "/v1/findings/:id/prior-art-diff",
    { schema: { params: IdParam, response: { 200: PriorArtDiff } } },
    async (request) => {
      const user = actingUser(request);
      const finding = await requireFinding(app, request.params.id);

      await requireCaseRead(app.db, user, finding.caseId);

      const rows = await app.db
        .select({ id: schema.priorArtChecks.id })
        .from(schema.priorArtChecks)
        .where(eq(schema.priorArtChecks.findingId, finding.id))
        .orderBy(desc(schema.priorArtChecks.startedAt))
        .limit(2);

      const [current, previous] = rows;

      if (current === undefined || previous === undefined) {
        throw validationError(
          "Two completed checks are needed before they can be compared.",
        );
      }

      const currentCheck = await loadCheck(app.db, current.id);
      const previousCheck = await loadCheck(app.db, previous.id);

      if (currentCheck === null || previousCheck === null) {
        throw notFound("Prior-art check");
      }

      const keyOf = (match: { provider: string; externalId: string | null }) =>
        `${match.provider}:${match.externalId ?? ""}`;
      const previousKeys = new Set(previousCheck.matches.map(keyOf));
      const currentKeys = new Set(currentCheck.matches.map(keyOf));

      return {
        previousCheckId: previousCheck.id,
        currentCheckId: currentCheck.id,
        newMatches: currentCheck.matches.filter(
          (match) => !previousKeys.has(keyOf(match)),
        ),
        resolvedMatches: previousCheck.matches.filter(
          (match) => !currentKeys.has(keyOf(match)),
        ),
        unchangedCount: currentCheck.matches.filter((match) =>
          previousKeys.has(keyOf(match)),
        ).length,
      };
    },
  );
}

async function requireFinding(
  app: AppInstance,
  findingId: string,
): Promise<{ id: string; caseId: string; priorArtState: string }> {
  const rows = await app.db
    .select({
      id: schema.findings.id,
      caseId: schema.findings.caseId,
      priorArtState: schema.findings.priorArtState,
    })
    .from(schema.findings)
    .where(eq(schema.findings.id, findingId))
    .limit(1);

  const row = rows[0];

  if (row === undefined) {
    throw notFound("Finding");
  }

  return row;
}

export async function loadCheck(
  db: Database,
  checkId: string,
): Promise<PriorArtCheck | null> {
  const rows = await db
    .select({
      check: schema.priorArtChecks,
      starterId: schema.users.id,
      starterName: schema.users.displayName,
      starterEmail: schema.users.email,
    })
    .from(schema.priorArtChecks)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.priorArtChecks.startedBy),
    )
    .where(eq(schema.priorArtChecks.id, checkId))
    .limit(1);

  const row = rows[0];

  if (row === undefined) {
    return null;
  }

  const matches = await db
    .select()
    .from(schema.priorArtMatches)
    .where(eq(schema.priorArtMatches.checkId, checkId))
    .orderBy(desc(schema.priorArtMatches.similarity));

  const concluder =
    row.check.concludedBy === null
      ? null
      : ((
          await db
            .select({
              id: schema.users.id,
              displayName: schema.users.displayName,
              email: schema.users.email,
            })
            .from(schema.users)
            .where(eq(schema.users.id, row.check.concludedBy))
            .limit(1)
        )[0] ?? null);

  const analysis = row.check.analysis;

  return {
    id: row.check.id,
    findingId: row.check.findingId,
    status: row.check.status,
    sourcesChecked: row.check.sourcesChecked,
    matches: matches.map((match) => ({
      id: match.id,
      checkId: match.checkId,
      origin: match.origin,
      provider: match.provider,
      externalId: match.externalId,
      findingId: match.matchedFindingId,
      title: match.title,
      url: match.url,
      publisher: match.publisher,
      publishedAt: match.publishedAt,
      affectedIdentity: match.affectedIdentity,
      summary: match.summary,
      query: match.query,
      retrievedAt: match.retrievedAt,
      similarity: match.similarity,
      aiRelationship: match.aiRelationship,
      aiReasoning: match.aiReasoning,
    })),
    analysis:
      analysis === null || analysis === undefined
        ? null
        : (analysis as PriorArtCheck["analysis"]),
    humanConclusion: row.check.humanConclusion,
    concludedBy: concluder,
    concludedAt: row.check.concludedAt,
    startedBy: {
      id: row.starterId,
      displayName: row.starterName,
      email: row.starterEmail,
    },
    startedAt: row.check.startedAt,
    completedAt: row.check.completedAt,
    failureReason: row.check.failureReason,
  };
}
