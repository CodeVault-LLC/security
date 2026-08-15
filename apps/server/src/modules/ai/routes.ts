import type { AppInstance } from "../../http/app-instance.js";
import { and, desc, eq, sql } from "drizzle-orm";

import {
  AcceptAiProposalRequest,
  AiContextPreview,
  AiProposal,
  AiProviderPolicy,
  AiRun,
  AiRunWithProposals,
  CreateAiRunRequest,
  ErrorResponse,
  IdParam,
  OkResponse,
  PreparedAiRun,
  RejectAiProposalRequest,
  SubmitAiRunResultRequest,
  UpdateAiProviderPolicyRequest,
} from "@codevault/contracts";
import {
  aiAction,
  AiOutputError,
  isAiActionId,
  buildProposal,
  extractJson,
  ProviderPolicyError,
  sha256,
  validateOutput,
  type PriorArtSynthesisOutput,
} from "@codevault/ai";
import {
  aiOutputInvalid,
  conflict,
  DomainError,
  notFound,
  permissionDenied,
  validationError,
} from "@codevault/core";
import { schema } from "@codevault/db";
import { Type } from "@sinclair/typebox";

import {
  actingUser,
  principalOf,
  requireAdmin,
  requireAuthor,
} from "../../http/guards.js";
import {
  requireCaseRead,
  requireCaseWrite,
} from "../../services/case-access.js";
import { prepareRun } from "./context-builder.js";
import { applyProposalPatch } from "./apply-proposal.js";

/**
 * AI routes.
 *
 * The shape of this module is the security argument: a run is prepared on the
 * server (which is where context filtering happens), executed by the desktop
 * client against a local provider, and its output submitted back for
 * validation. At no point does a client choose what data is sent or what a
 * proposal is allowed to change.
 */

const PolicyListResponse = Type.Object({
  items: Type.Array(AiProviderPolicy),
});

const DEFAULT_PROVIDER_ID = "claude-code";

export async function registerAiRoutes(app: AppInstance): Promise<void> {
  app.get(
    "/v1/ai/policies",
    { schema: { response: { 200: PolicyListResponse } } },
    async (request) => {
      actingUser(request);

      const rows = await app.db.select().from(schema.aiProviderPolicies);

      return {
        items: rows.map((row) => ({
          providerId: row.providerId,
          enabled: row.enabled,
          allowedVisibility: row.allowedVisibility,
          allowRestrictedCases: row.allowRestrictedCases,
          retainFullPrompts: row.retainFullPrompts,
          updatedAt: row.updatedAt,
        })),
      };
    },
  );

  app.patch(
    "/v1/ai/policies/:providerId",
    {
      schema: {
        params: Type.Object({ providerId: Type.String({ maxLength: 60 }) }),
        body: UpdateAiProviderPolicyRequest,
        response: { 200: AiProviderPolicy, 403: ErrorResponse },
      },
    },
    async (request) => {
      const admin = requireAdmin(request);
      const principal = principalOf(request);
      const { providerId } = request.params;
      const body = request.body;

      const [row] = await app.db
        .insert(schema.aiProviderPolicies)
        .values({
          providerId,
          enabled: body.enabled ?? false,
          allowedVisibility: body.allowedVisibility ?? [],
          allowRestrictedCases: body.allowRestrictedCases ?? false,
          retainFullPrompts: body.retainFullPrompts ?? false,
          updatedBy: admin.id,
        })
        .onConflictDoUpdate({
          target: schema.aiProviderPolicies.providerId,
          set: {
            ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
            ...(body.allowedVisibility === undefined
              ? {}
              : { allowedVisibility: body.allowedVisibility }),
            ...(body.allowRestrictedCases === undefined
              ? {}
              : { allowRestrictedCases: body.allowRestrictedCases }),
            ...(body.retainFullPrompts === undefined
              ? {}
              : { retainFullPrompts: body.retainFullPrompts }),
            updatedBy: admin.id,
            updatedAt: sql`now()`,
          },
        })
        .returning();

      if (row === undefined) {
        throw new DomainError("SERVER_ERROR", "Could not update the policy.");
      }

      await app.audit.write(
        app.db,
        {
          actorId: admin.id,
          sessionId: principal.session.id,
          requestId: request.requestId,
        },
        {
          action: "ai.policy_updated",
          entityType: "ai_provider_policy",
          entityId: providerId,
          after: {
            enabled: row.enabled,
            allowedVisibility: row.allowedVisibility,
            allowRestrictedCases: row.allowRestrictedCases,
          },
        },
      );

      return {
        providerId: row.providerId,
        enabled: row.enabled,
        allowedVisibility: row.allowedVisibility,
        allowRestrictedCases: row.allowRestrictedCases,
        retainFullPrompts: row.retainFullPrompts,
        updatedAt: row.updatedAt,
      };
    },
  );

  /**
   * Prepares a run.
   *
   * Builds and filters the context, stores the manifest and prompt hash, and
   * returns the prompt for the desktop client to execute locally. The run is
   * recorded before anything leaves the server, so an execution that never
   * reports back still leaves a trace of what was assembled.
   */
  app.post(
    "/v1/ai/runs",
    {
      schema: {
        body: CreateAiRunRequest,
        response: {
          200: PreparedAiRun,
          403: ErrorResponse,
          503: ErrorResponse,
        },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const body = request.body;
      const definition = aiAction(body.action);

      if (definition.targetType !== body.targetType) {
        throw validationError(
          `${body.action} operates on a ${definition.targetType}, not a ${body.targetType}.`,
        );
      }

      const providerId = body.providerId ?? DEFAULT_PROVIDER_ID;
      const policy = await loadPolicy(app, providerId);

      if (!policy.enabled) {
        throw new DomainError(
          "PROVIDER_UNAVAILABLE",
          `The ${providerId} provider is not enabled for this workspace.`,
        );
      }

      let prepared;

      try {
        prepared = await prepareRun({
          db: app.db,
          action: body.action,
          targetId: body.targetId,
          policy: {
            allowedVisibility: policy.allowedVisibility,
            allowRestrictedCases: policy.allowRestrictedCases,
          },
          researcherInstruction: body.instruction ?? null,
        });
      } catch (error: unknown) {
        if (error instanceof ProviderPolicyError) {
          throw permissionDenied(error.message);
        }

        throw error;
      }

      await requireCaseWrite(app.db, user, prepared.caseId);

      const promptHash = sha256(prepared.promptText);

      const [run] = await app.db
        .insert(schema.aiRuns)
        .values({
          action: body.action,
          targetType: body.targetType,
          targetId: body.targetId,
          caseId: prepared.caseId,
          providerId,
          status: "PREPARED",
          contextManifest: prepared.context.manifest,
          promptSha256: promptHash,
          // The prompt itself is retained only when policy says to: a prompt
          // about a restricted case is restricted material.
          promptText: policy.retainFullPrompts ? prepared.promptText : null,
          startedBy: user.id,
        })
        .returning();

      if (run === undefined) {
        throw new DomainError("SERVER_ERROR", "Could not record the AI run.");
      }

      await app.audit.write(
        app.db,
        {
          actorId: user.id,
          sessionId: principal.session.id,
          requestId: request.requestId,
        },
        {
          action: "ai.run_prepared",
          entityType: "ai_run",
          entityId: run.id,
          caseId: prepared.caseId,
          aiRunId: run.id,
          after: {
            action: body.action,
            providerId,
            contextItems: prepared.context.manifest.length,
            promptSha256: promptHash,
          },
        },
      );

      return {
        ...toAiRun(run, principal.user),
        promptText: prepared.promptText,
      };
    },
  );

  /**
   * "View context being sent".
   *
   * Builds the exact same context the run would use, without recording a run,
   * so a researcher can inspect it before deciding to invoke a provider.
   */
  app.post(
    "/v1/ai/context-preview",
    {
      schema: {
        body: CreateAiRunRequest,
        response: { 200: AiContextPreview, 403: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const body = request.body;
      const providerId = body.providerId ?? DEFAULT_PROVIDER_ID;
      const policy = await loadPolicy(app, providerId);

      let prepared;

      try {
        prepared = await prepareRun({
          db: app.db,
          action: body.action,
          targetId: body.targetId,
          policy: {
            allowedVisibility: policy.allowedVisibility,
            allowRestrictedCases: policy.allowRestrictedCases,
          },
          researcherInstruction: body.instruction ?? null,
        });
      } catch (error: unknown) {
        if (error instanceof ProviderPolicyError) {
          throw permissionDenied(error.message);
        }

        throw error;
      }

      await requireCaseRead(app.db, user, prepared.caseId);

      return {
        action: body.action,
        targetType: body.targetType,
        targetId: body.targetId,
        audience: prepared.audience,
        items: prepared.context.manifest,
        promptText: prepared.promptText,
        excluded: prepared.context.excluded,
      };
    },
  );

  app.post(
    "/v1/ai/runs/:id/result",
    {
      schema: {
        params: IdParam,
        body: SubmitAiRunResultRequest,
        response: {
          200: AiRunWithProposals,
          422: ErrorResponse,
        },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const body = request.body;

      const rows = await app.db
        .select()
        .from(schema.aiRuns)
        .where(eq(schema.aiRuns.id, request.params.id))
        .limit(1);

      const run = rows[0];

      if (run === undefined) {
        throw notFound("AI run");
      }

      await requireCaseWrite(app.db, user, run.caseId);

      if (run.startedBy !== user.id) {
        throw permissionDenied(
          "Only the person who started a run may report its result.",
        );
      }

      if (run.status !== "PREPARED" && run.status !== "RUNNING") {
        throw conflict("That run has already been completed.");
      }

      if (body.status !== "COMPLETED") {
        await app.db
          .update(schema.aiRuns)
          .set({
            status: body.status,
            failureReason: body.failureReason ?? null,
            providerVersion: body.providerVersion ?? null,
            durationMs: body.durationMs ?? null,
            completedAt: sql`now()`,
          })
          .where(eq(schema.aiRuns.id, run.id));

        return loadRunWithProposals(app, run.id);
      }

      const output = body.output ?? "";

      if (!isAiActionId(run.action)) {
        throw new DomainError(
          "SERVER_ERROR",
          "This run references an action that no longer exists.",
        );
      }

      const action = run.action;
      let proposalDraft;
      let parsed: unknown;

      try {
        parsed = extractJson(output);

        const validated = validateOutput<unknown>(action, parsed);

        parsed = validated;
        proposalDraft = buildProposal(action, validated);
      } catch (error: unknown) {
        if (error instanceof AiOutputError) {
          // Invalid output is a failed run, never a proposal. This is the point
          // where a hallucinated shape stops being able to influence anything.
          await app.db
            .update(schema.aiRuns)
            .set({
              status: "FAILED",
              failureReason: error.message,
              rawOutput: output.slice(0, 100_000),
              providerVersion: body.providerVersion ?? null,
              durationMs: body.durationMs ?? null,
              completedAt: sql`now()`,
            })
            .where(eq(schema.aiRuns.id, run.id));

          throw aiOutputInvalid(error.message, {
            detail: error.detail ?? null,
          });
        }

        throw error;
      }

      const targetRevision = await currentTargetRevision(
        app,
        run.targetType,
        run.targetId,
      );

      await app.db.transaction(async (tx) => {
        await tx
          .update(schema.aiRuns)
          .set({
            status: "COMPLETED",
            providerVersion: body.providerVersion ?? null,
            durationMs: body.durationMs ?? null,
            rawOutput: JSON.stringify(parsed).slice(0, 100_000),
            completedAt: sql`now()`,
          })
          .where(eq(schema.aiRuns.id, run.id));

        if (proposalDraft !== null) {
          await tx.insert(schema.aiProposals).values({
            runId: run.id,
            action: run.action,
            targetType: run.targetType,
            targetId: run.targetId,
            patch: proposalDraft.patch,
            rationaleMarkdown: proposalDraft.rationaleMarkdown,
            baseRevision: targetRevision,
          });
        }

        if (run.action === "FINDING_PRIOR_ART_SYNTHESIS") {
          await attachPriorArtAnalysis(
            tx,
            run.targetId,
            parsed as PriorArtSynthesisOutput,
          );
        }

        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "ai.run_completed",
            entityType: "ai_run",
            entityId: run.id,
            caseId: run.caseId,
            aiRunId: run.id,
            after: {
              action: run.action,
              producedProposal: proposalDraft !== null,
              providerVersion: body.providerVersion ?? null,
            },
          },
        );
      });

      return loadRunWithProposals(app, run.id);
    },
  );

  app.get(
    "/v1/ai/runs",
    {
      schema: {
        querystring: Type.Object({
          caseId: Type.Optional(IdParam.properties.id),
          targetId: Type.Optional(IdParam.properties.id),
        }),
        response: {
          200: Type.Object({ items: Type.Array(AiRunWithProposals) }),
        },
      },
    },
    async (request) => {
      const user = actingUser(request);
      const filters = [];

      if (request.query.caseId !== undefined) {
        await requireCaseRead(app.db, user, request.query.caseId);
        filters.push(eq(schema.aiRuns.caseId, request.query.caseId));
      }

      if (request.query.targetId !== undefined) {
        filters.push(eq(schema.aiRuns.targetId, request.query.targetId));
      }

      const rows = await app.db
        .select({ id: schema.aiRuns.id, caseId: schema.aiRuns.caseId })
        .from(schema.aiRuns)
        .where(filters.length === 0 ? undefined : and(...filters))
        .orderBy(desc(schema.aiRuns.createdAt))
        .limit(50);

      const items = [];

      for (const row of rows) {
        await requireCaseRead(app.db, user, row.caseId);

        items.push(await loadRunWithProposals(app, row.id));
      }

      return { items };
    },
  );

  app.post(
    "/v1/ai/proposals/:id/accept",
    {
      schema: {
        params: IdParam,
        body: AcceptAiProposalRequest,
        response: { 200: AiProposal, 409: ErrorResponse, 422: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);

      const rows = await app.db
        .select({ proposal: schema.aiProposals, run: schema.aiRuns })
        .from(schema.aiProposals)
        .innerJoin(
          schema.aiRuns,
          eq(schema.aiRuns.id, schema.aiProposals.runId),
        )
        .where(eq(schema.aiProposals.id, request.params.id))
        .limit(1);

      const row = rows[0];

      if (row === undefined) {
        throw notFound("Proposal");
      }

      const { proposal, run } = row;

      await requireCaseWrite(app.db, user, run.caseId);

      if (proposal.status !== "PENDING") {
        throw conflict("That proposal has already been reviewed.");
      }

      // A researcher may edit the proposed patch before accepting it; the
      // edited version is what gets applied and audited.
      const patch = request.body.patch ?? proposal.patch;

      await applyProposalPatch(app, {
        proposal,
        run,
        patch,
        expectedRevision: request.body.expectedRevision,
        actorId: user.id,
        sessionId: principal.session.id,
        requestId: request.requestId,
      });

      const [updated] = await app.db
        .update(schema.aiProposals)
        .set({
          status: "ACCEPTED",
          reviewedBy: user.id,
          reviewedAt: sql`now()`,
          patch,
        })
        .where(eq(schema.aiProposals.id, proposal.id))
        .returning();

      if (updated === undefined) {
        throw new DomainError(
          "SERVER_ERROR",
          "Could not record the acceptance.",
        );
      }

      return toProposal(updated, {
        id: principal.user.id,
        displayName: principal.user.displayName,
        email: principal.user.email,
      });
    },
  );

  app.post(
    "/v1/ai/proposals/:id/reject",
    {
      schema: {
        params: IdParam,
        body: RejectAiProposalRequest,
        response: { 200: OkResponse, 404: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);

      const rows = await app.db
        .select({ proposal: schema.aiProposals, run: schema.aiRuns })
        .from(schema.aiProposals)
        .innerJoin(
          schema.aiRuns,
          eq(schema.aiRuns.id, schema.aiProposals.runId),
        )
        .where(eq(schema.aiProposals.id, request.params.id))
        .limit(1);

      const row = rows[0];

      if (row === undefined) {
        throw notFound("Proposal");
      }

      await requireCaseWrite(app.db, user, row.run.caseId);

      await app.db.transaction(async (tx) => {
        await tx
          .update(schema.aiProposals)
          .set({
            status: "REJECTED",
            reviewedBy: user.id,
            reviewedAt: sql`now()`,
            rejectionReason: request.body.reason ?? null,
          })
          .where(eq(schema.aiProposals.id, row.proposal.id));

        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "ai.proposal_rejected",
            entityType: "ai_proposal",
            entityId: row.proposal.id,
            caseId: row.run.caseId,
            aiRunId: row.run.id,
          },
        );
      });

      return { ok: true as const };
    },
  );
}

async function loadPolicy(
  app: AppInstance,
  providerId: string,
): Promise<{
  enabled: boolean;
  allowedVisibility: ("INTERNAL" | "VENDOR" | "PUBLIC")[];
  allowRestrictedCases: boolean;
  retainFullPrompts: boolean;
}> {
  const rows = await app.db
    .select()
    .from(schema.aiProviderPolicies)
    .where(eq(schema.aiProviderPolicies.providerId, providerId))
    .limit(1);

  const row = rows[0];

  if (row === undefined) {
    // A provider with no policy is disabled. Defaulting to "allowed" would
    // make forgetting to configure something the same as approving it.
    return {
      enabled: false,
      allowedVisibility: [],
      allowRestrictedCases: false,
      retainFullPrompts: false,
    };
  }

  return {
    enabled: row.enabled,
    allowedVisibility: row.allowedVisibility,
    allowRestrictedCases: row.allowRestrictedCases,
    retainFullPrompts: row.retainFullPrompts,
  };
}

async function currentTargetRevision(
  app: AppInstance,
  targetType: string,
  targetId: string,
): Promise<number> {
  if (targetType === "REPORT_SECTION") {
    const rows = await app.db
      .select({ revision: schema.reportSections.revision })
      .from(schema.reportSections)
      .where(eq(schema.reportSections.id, targetId))
      .limit(1);

    return rows[0]?.revision ?? 1;
  }

  const rows = await app.db
    .select({ revision: schema.findings.revision })
    .from(schema.findings)
    .where(eq(schema.findings.id, targetId))
    .limit(1);

  return rows[0]?.revision ?? 1;
}

/**
 * Stores the AI's prior-art comparison on the latest completed check.
 *
 * Stored as advisory analysis beside the deterministic results. It never sets
 * the finding's prior-art state — only a person's recorded conclusion does.
 */
async function attachPriorArtAnalysis(
  tx: AppInstance["db"],
  findingId: string,
  analysis: PriorArtSynthesisOutput,
): Promise<void> {
  const checks = await tx
    .select({ id: schema.priorArtChecks.id })
    .from(schema.priorArtChecks)
    .where(
      and(
        eq(schema.priorArtChecks.findingId, findingId),
        eq(schema.priorArtChecks.status, "COMPLETED"),
      ),
    )
    .orderBy(desc(schema.priorArtChecks.startedAt))
    .limit(1);

  const check = checks[0];

  if (check === undefined) {
    return;
  }

  await tx
    .update(schema.priorArtChecks)
    .set({ analysis: analysis as unknown as Record<string, unknown> })
    .where(eq(schema.priorArtChecks.id, check.id));

  for (const match of analysis.matches) {
    await tx
      .update(schema.priorArtMatches)
      .set({
        aiRelationship: match.relationship,
        aiReasoning: match.reasoning,
      })
      .where(
        and(
          eq(schema.priorArtMatches.id, match.matchId),
          eq(schema.priorArtMatches.checkId, check.id),
        ),
      );
  }
}

type AiRunRow = typeof schema.aiRuns.$inferSelect;
type AiProposalRow = typeof schema.aiProposals.$inferSelect;
type Actor = { id: string; displayName: string; email: string };

function toAiRun(row: AiRunRow, startedBy: Actor): AiRun {
  return {
    id: row.id,
    action: row.action as AiRun["action"],
    targetType: row.targetType,
    targetId: row.targetId,
    caseId: row.caseId,
    providerId: row.providerId,
    providerVersion: row.providerVersion,
    status: row.status,
    contextManifest: row.contextManifest,
    promptSha256: row.promptSha256,
    promptText: row.promptText,
    failureReason: row.failureReason,
    startedBy,
    startedAt: row.createdAt,
    completedAt: row.completedAt,
    durationMs: row.durationMs,
  };
}

function toProposal(row: AiProposalRow, reviewedBy: Actor | null): AiProposal {
  return {
    id: row.id,
    runId: row.runId,
    action: row.action as AiProposal["action"],
    targetType: row.targetType,
    targetId: row.targetId,
    patch: row.patch,
    rationaleMarkdown: row.rationaleMarkdown,
    status: row.status,
    baseRevision: row.baseRevision,
    reviewedBy: row.reviewedBy === null ? null : reviewedBy,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
  };
}

async function loadRunWithProposals(
  app: AppInstance,
  runId: string,
): Promise<AiRunWithProposals> {
  const rows = await app.db
    .select({
      run: schema.aiRuns,
      userId: schema.users.id,
      userName: schema.users.displayName,
      userEmail: schema.users.email,
    })
    .from(schema.aiRuns)
    .innerJoin(schema.users, eq(schema.users.id, schema.aiRuns.startedBy))
    .where(eq(schema.aiRuns.id, runId))
    .limit(1);

  const row = rows[0];

  if (row === undefined) {
    throw notFound("AI run");
  }

  const proposalRows = await app.db
    .select({
      proposal: schema.aiProposals,
      reviewerId: schema.users.id,
      reviewerName: schema.users.displayName,
      reviewerEmail: schema.users.email,
    })
    .from(schema.aiProposals)
    .leftJoin(schema.users, eq(schema.users.id, schema.aiProposals.reviewedBy))
    .where(eq(schema.aiProposals.runId, runId));

  return {
    ...toAiRun(row.run, {
      id: row.userId,
      displayName: row.userName,
      email: row.userEmail,
    }),
    proposals: proposalRows.map(
      ({ proposal, reviewerId, reviewerName, reviewerEmail }) =>
        toProposal(
          proposal,
          reviewerId === null || reviewerName === null || reviewerEmail === null
            ? null
            : {
                id: reviewerId,
                displayName: reviewerName,
                email: reviewerEmail,
              },
        ),
    ),
  };
}
