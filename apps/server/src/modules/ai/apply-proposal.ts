import type { AppInstance } from "../../http/app-instance.js";
import { eq, sql } from "drizzle-orm";

import {
  aiAction,
  AI_FORBIDDEN_PATCH_FIELDS,
  assertPatchAllowed,
  AiOutputError,
  isAiActionId,
} from "@codevault/ai";
import {
  aiOutputInvalid,
  conflict,
  DomainError,
  isValidCweId,
  notFound,
  validationError,
} from "@codevault/core";
import { schema } from "@codevault/db";
import { buildCvss31Vector, buildCvss40Vector } from "@codevault/standards";

import { assertRevision } from "../../http/concurrency.js";
import { normaliseScoreSubmission } from "../findings/scoring.js";

/**
 * Applying an accepted proposal.
 *
 * This is the only place AI output becomes canonical data, and it is where the
 * product's central promise is enforced: the patch is checked against the
 * action's allow-list, the target's revision must match what the proposal was
 * computed against, the change is applied in a transaction, and an audit event
 * naming both the reviewer and the run is written alongside it.
 */

export interface ApplyProposalInput {
  proposal: typeof schema.aiProposals.$inferSelect;
  run: typeof schema.aiRuns.$inferSelect;
  patch: Record<string, unknown>;
  expectedRevision: number;
  actorId: string;
  sessionId: string;
  requestId: string;
}

export async function applyProposalPatch(
  app: AppInstance,
  input: ApplyProposalInput,
): Promise<void> {
  const { proposal, run, patch } = input;

  if (!isAiActionId(proposal.action)) {
    throw new DomainError(
      "SERVER_ERROR",
      "This proposal references an action that no longer exists.",
    );
  }

  const definition = aiAction(proposal.action);

  try {
    assertPatchAllowed(definition, patch);
  } catch (error: unknown) {
    if (error instanceof AiOutputError) {
      throw aiOutputInvalid(error.message);
    }

    throw error;
  }

  // A second, explicit check. The allow-list above is per-action; this one is
  // the invariant that holds no matter which action is involved.
  for (const field of Object.keys(patch)) {
    if (AI_FORBIDDEN_PATCH_FIELDS.includes(field)) {
      throw aiOutputInvalid(
        `AI cannot change "${field}". That is a decision a person records.`,
      );
    }
  }

  if (proposal.targetType === "REPORT_SECTION") {
    await applyToReportSection(app, input);

    return;
  }

  if (proposal.targetType === "SCORE") {
    await applyToScore(app, input);

    return;
  }

  if (proposal.targetType === "SUBMISSION") {
    await applyToSubmission(app, input);
    return;
  }

  if (proposal.targetType === "CORRESPONDENCE_MESSAGE") {
    await applyToCorrespondence(app, input);
    return;
  }

  await applyToFinding(app, input);

  void run;
}

async function applyToSubmission(
  app: AppInstance,
  input: ApplyProposalInput,
): Promise<void> {
  const { proposal, patch } = input;
  const [submission] = await app.db
    .select()
    .from(schema.submissions)
    .where(eq(schema.submissions.id, proposal.targetId))
    .limit(1);
  if (submission === undefined) throw notFound("Submission");
  assertRevision(submission, input.expectedRevision, "submission");
  if (submission.revision !== proposal.baseRevision) {
    throw conflict(
      "This submission changed since the AI proposal was created. Review the latest version before applying it.",
      {
        proposalBaseRevision: proposal.baseRevision,
        currentRevision: submission.revision,
      },
    );
  }
  if (!["DRAFT", "IN_REVIEW", "APPROVED"].includes(submission.status)) {
    throw conflict(
      "A sealed or delivered submission cannot accept a draft proposal.",
    );
  }
  const nextRevision = submission.revision + 1;
  await app.db.transaction(async (tx) => {
    await tx
      .update(schema.submissions)
      .set({
        ...patch,
        status: "DRAFT",
        lastEditedBy: input.actorId,
        revision: nextRevision,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.submissions.id, submission.id));
    await tx.insert(schema.submissionRevisions).values({
      submissionId: submission.id,
      revision: nextRevision,
      subject:
        typeof patch.subject === "string" ? patch.subject : submission.subject,
      bodyMarkdown:
        typeof patch.bodyMarkdown === "string"
          ? patch.bodyMarkdown
          : submission.bodyMarkdown,
      manualFields: submission.manualFields,
      cryptoMode: submission.cryptoMode,
      authoredBy: input.actorId,
      aiRunId: proposal.runId,
    });
    await app.audit.write(
      tx,
      {
        actorId: input.actorId,
        sessionId: input.sessionId,
        requestId: input.requestId,
      },
      {
        action: "ai.proposal_accepted",
        entityType: "submission",
        entityId: submission.id,
        caseId: submission.caseId,
        aiRunId: proposal.runId,
        before: { revision: submission.revision, status: submission.status },
        after: { revision: nextRevision, status: "DRAFT" },
      },
    );
  });
}

async function applyToCorrespondence(
  app: AppInstance,
  input: ApplyProposalInput,
): Promise<void> {
  const { proposal, patch } = input;
  const [message] = await app.db
    .select()
    .from(schema.correspondenceMessages)
    .where(eq(schema.correspondenceMessages.id, proposal.targetId))
    .limit(1);
  if (message === undefined) throw notFound("Correspondence message");
  assertRevision(message, input.expectedRevision, "correspondence message");
  if (message.revision !== proposal.baseRevision) {
    throw conflict("This message changed since the AI proposal was created.");
  }
  const classification = patch.classification;
  const allowed = [
    "UNREVIEWED",
    "AUTO_REPLY",
    "ACKNOWLEDGEMENT",
    "REQUEST_FOR_INFORMATION",
    "STATUS_UPDATE",
    "FIX_AVAILABLE",
    "REJECTION",
    "OTHER",
  ];
  if (typeof classification !== "string" || !allowed.includes(classification)) {
    throw aiOutputInvalid(
      "The proposal contains an invalid reply classification.",
    );
  }
  const [submission] = await app.db
    .select({ caseId: schema.submissions.caseId })
    .from(schema.submissions)
    .where(eq(schema.submissions.id, message.submissionId))
    .limit(1);
  if (submission === undefined) throw notFound("Submission");
  await app.db.transaction(async (tx) => {
    await tx
      .update(schema.correspondenceMessages)
      .set({
        classification: classification as typeof message.classification,
        revision: message.revision + 1,
      })
      .where(eq(schema.correspondenceMessages.id, message.id));
    await app.audit.write(
      tx,
      {
        actorId: input.actorId,
        sessionId: input.sessionId,
        requestId: input.requestId,
      },
      {
        action: "ai.proposal_accepted",
        entityType: "correspondence_message",
        entityId: message.id,
        caseId: submission.caseId,
        aiRunId: proposal.runId,
        before: { classification: message.classification },
        after: { classification },
      },
    );
  });
}

async function applyToFinding(
  app: AppInstance,
  input: ApplyProposalInput,
): Promise<void> {
  const { proposal, patch } = input;

  const rows = await app.db
    .select()
    .from(schema.findings)
    .where(eq(schema.findings.id, proposal.targetId))
    .limit(1);

  const finding = rows[0];

  if (finding === undefined) {
    throw notFound("Finding");
  }

  assertRevision(finding, input.expectedRevision, "finding");

  if (finding.revision !== proposal.baseRevision) {
    throw conflict(
      "This finding changed since the AI proposal was created. " +
        "Review the latest version before applying the proposal.",
      {
        proposalBaseRevision: proposal.baseRevision,
        currentRevision: finding.revision,
      },
    );
  }

  if (Array.isArray(patch.cweIds)) {
    const invalid = patch.cweIds.filter(
      (id) => typeof id !== "string" || !isValidCweId(id),
    );

    if (invalid.length > 0) {
      throw validationError("The proposal contains invalid CWE identifiers.");
    }
  }

  await app.db.transaction(async (tx) => {
    await tx
      .update(schema.findings)
      .set({
        ...patch,
        revision: finding.revision + 1,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.findings.id, finding.id));

    await app.audit.write(
      tx,
      {
        actorId: input.actorId,
        sessionId: input.sessionId,
        requestId: input.requestId,
      },
      {
        action: "ai.proposal_accepted",
        entityType: "finding",
        entityId: finding.id,
        caseId: finding.caseId,
        aiRunId: proposal.runId,
        before: Object.fromEntries(
          Object.keys(patch).map((key) => [
            key,
            (finding as unknown as Record<string, unknown>)[key],
          ]),
        ),
        after: patch,
      },
    );
  });
}

/**
 * Applies a CVSS metric proposal.
 *
 * The proposal carries metrics only. The vector is assembled here and the score
 * computed by the deterministic implementation, so the number a report shows is
 * never one a model produced. The result is recorded as PROPOSED: approving it
 * is a separate, deliberate action.
 */
async function applyToScore(
  app: AppInstance,
  input: ApplyProposalInput,
): Promise<void> {
  const { proposal, patch } = input;
  const scheme =
    proposal.action === "FINDING_SUGGEST_CVSS40" ? "CVSS40" : "CVSS31";
  const metrics = patch.metrics;

  if (typeof metrics !== "object" || metrics === null) {
    throw aiOutputInvalid("The proposal contains no CVSS metrics.");
  }

  const metricRecord = Object.fromEntries(
    Object.entries(metrics as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

  const vector =
    scheme === "CVSS40"
      ? buildCvss40Vector(metricRecord)
      : buildCvss31Vector(metricRecord);

  const normalised = normaliseScoreSubmission({ scheme, vector });

  const findingRows = await app.db
    .select()
    .from(schema.findings)
    .where(eq(schema.findings.id, proposal.targetId))
    .limit(1);

  const finding = findingRows[0];

  if (finding === undefined) {
    throw notFound("Finding");
  }

  await app.db.transaction(async (tx) => {
    const [score] = await tx
      .insert(schema.findingScores)
      .values({
        findingId: finding.id,
        scheme: normalised.scheme,
        vector: normalised.vector,
        score: normalised.score,
        severity: normalised.severity,
        metrics: normalised.metrics,
        source: "AI_PROPOSAL",
        reasoningMarkdown:
          typeof patch.reasoningMarkdown === "string"
            ? patch.reasoningMarkdown
            : proposal.rationaleMarkdown,
        // Deliberately PROPOSED. Accepting the AI's metrics records them; a
        // researcher still has to approve the resulting vector.
        reviewState: "PROPOSED",
        createdBy: input.actorId,
      })
      .returning({ id: schema.findingScores.id });

    await app.audit.write(
      tx,
      {
        actorId: input.actorId,
        sessionId: input.sessionId,
        requestId: input.requestId,
      },
      {
        action: "ai.proposal_accepted",
        entityType: "finding_score",
        entityId: score?.id ?? finding.id,
        caseId: finding.caseId,
        aiRunId: proposal.runId,
        after: {
          scheme: normalised.scheme,
          vector: normalised.vector,
          score: normalised.score,
          reviewState: "PROPOSED",
        },
      },
    );
  });
}

async function applyToReportSection(
  app: AppInstance,
  input: ApplyProposalInput,
): Promise<void> {
  const { proposal, patch } = input;

  const rows = await app.db
    .select({ section: schema.reportSections, report: schema.reports })
    .from(schema.reportSections)
    .innerJoin(
      schema.reports,
      eq(schema.reports.id, schema.reportSections.reportId),
    )
    .where(eq(schema.reportSections.id, proposal.targetId))
    .limit(1);

  const row = rows[0];

  if (row === undefined) {
    throw notFound("Report section");
  }

  const { section, report } = row;

  assertRevision(section, input.expectedRevision, "section");

  if (section.revision !== proposal.baseRevision) {
    throw conflict(
      "This section changed since the AI proposal was created. " +
        "Review the latest version before applying the proposal.",
      {
        proposalBaseRevision: proposal.baseRevision,
        currentRevision: section.revision,
      },
    );
  }

  const content = patch.contentMarkdown;

  if (typeof content !== "string") {
    throw aiOutputInvalid("The proposal contains no section content.");
  }

  const nextRevision = section.revision + 1;

  await app.db.transaction(async (tx) => {
    await tx
      .update(schema.reportSections)
      .set({
        contentMarkdown: content,
        // AI-written content enters as a draft, never as approved text, no
        // matter what state the section was in before.
        reviewState: "AI_DRAFT",
        lastEditedBy: input.actorId,
        approvedBy: null,
        approvedAt: null,
        approvedRevision: null,
        revision: nextRevision,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.reportSections.id, section.id));

    await tx.insert(schema.reportRevisions).values({
      sectionId: section.id,
      revision: nextRevision,
      contentMarkdown: content,
      reviewState: "AI_DRAFT",
      authoredBy: input.actorId,
      aiRunId: proposal.runId,
    });

    await app.audit.write(
      tx,
      {
        actorId: input.actorId,
        sessionId: input.sessionId,
        requestId: input.requestId,
      },
      {
        action: "ai.proposal_accepted",
        entityType: "report_section",
        entityId: section.id,
        caseId: report.caseId,
        aiRunId: proposal.runId,
        before: {
          reviewState: section.reviewState,
          revision: section.revision,
        },
        after: { reviewState: "AI_DRAFT", revision: nextRevision },
      },
    );
  });
}
