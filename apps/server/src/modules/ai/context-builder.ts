import { and, desc, eq } from "drizzle-orm";

import type { AiActionId } from "@codevault/contracts";
import {
  assemblePrompt,
  buildContext,
  promptFor,
  SYSTEM_INSTRUCTION,
  aiAction,
  type BuiltContext,
  type ContextCandidate,
  type ContextPolicy,
} from "@codevault/ai";
import { notFound, type ReportAudience } from "@codevault/core";
import type { Database } from "@codevault/db";
import { schema } from "@codevault/db";

/**
 * Context assembly.
 *
 * Gathers the records an action needs, tags each with its real visibility, and
 * hands the whole set to the filter in `@codevault/ai`. The filtering itself
 * lives there so it can be unit-tested without a database; this module's job is
 * to make sure nothing reaches it with the wrong visibility attached.
 */

export interface PreparedRun {
  caseId: string;
  audience: ReportAudience;
  context: BuiltContext;
  promptText: string;
}

export interface PrepareInput {
  db: Database;
  action: AiActionId;
  targetId: string;
  policy: Omit<ContextPolicy, "caseIsRestricted">;
  researcherInstruction?: string | null;
}

export async function prepareRun(input: PrepareInput): Promise<PreparedRun> {
  const definition = aiAction(input.action);

  if (definition.targetType === "REPORT_SECTION") {
    return prepareReportSectionRun(input);
  }

  return prepareFindingRun(input);
}

async function loadCase(
  db: Database,
  caseId: string,
): Promise<{ id: string; ref: string; title: string; restricted: boolean }> {
  const rows = await db
    .select({
      id: schema.cases.id,
      ref: schema.cases.ref,
      title: schema.cases.title,
      restricted: schema.cases.restricted,
    })
    .from(schema.cases)
    .where(eq(schema.cases.id, caseId))
    .limit(1);

  const row = rows[0];

  if (row === undefined) {
    throw notFound("Case");
  }

  return row;
}

/**
 * Finding context.
 *
 * The finding's own narrative, its assets and affected ranges, its evidence
 * with artifact digests, its claims, its references, and — for the prior-art
 * synthesis action — the stored search results.
 */
async function prepareFindingRun(input: PrepareInput): Promise<PreparedRun> {
  const { db, action } = input;
  const findingId =
    action === "FINDING_SUGGEST_CVSS40" || action === "FINDING_SUGGEST_CVSS31"
      ? await findingIdForScoreTarget(db, input.targetId)
      : input.targetId;

  const rows = await db
    .select()
    .from(schema.findings)
    .where(eq(schema.findings.id, findingId))
    .limit(1);

  const finding = rows[0];

  if (finding === undefined) {
    throw notFound("Finding");
  }

  const researchCase = await loadCase(db, finding.caseId);
  const candidates: ContextCandidate[] = [];

  candidates.push({
    kind: "finding",
    id: finding.ref,
    label: finding.title,
    visibility: finding.visibility,
    text: renderFinding(finding),
  });

  const assets = await db
    .select({
      asset: schema.assets,
      primary: schema.findingAssets.primary,
    })
    .from(schema.findingAssets)
    .innerJoin(
      schema.assets,
      eq(schema.assets.id, schema.findingAssets.assetId),
    )
    .where(eq(schema.findingAssets.findingId, finding.id));

  for (const { asset, primary } of assets) {
    const identifiers = await db
      .select({
        scheme: schema.assetIdentifiers.scheme,
        value: schema.assetIdentifiers.value,
      })
      .from(schema.assetIdentifiers)
      .where(eq(schema.assetIdentifiers.assetId, asset.id));

    candidates.push({
      kind: "asset",
      id: asset.ref,
      label: `${primary ? "Primary target" : "Related asset"}: ${asset.name}`,
      // Asset identity describes the target, which any audience of a report
      // about that target necessarily knows.
      visibility: "PUBLIC",
      text:
        `Name: ${asset.name}\nKind: ${asset.kind}\n` +
        `Vendor: ${asset.vendor ?? "unknown"}\nVersion: ${asset.version ?? "unknown"}\n` +
        `Identifiers: ${
          identifiers.length === 0
            ? "none recorded"
            : identifiers.map((it) => `${it.scheme}=${it.value}`).join(", ")
        }`,
    });
  }

  const ranges = await db
    .select()
    .from(schema.affectedRanges)
    .where(eq(schema.affectedRanges.findingId, finding.id));

  if (ranges.length > 0) {
    candidates.push({
      kind: "affected_versions",
      id: `${finding.ref}-versions`,
      label: "Affected version conclusions",
      visibility: "VENDOR",
      text: ranges
        .map(
          (range) =>
            `${range.expression} (${range.kind}) — ${range.status}` +
            `${range.fixedIn === null ? "" : `, fixed in ${range.fixedIn}`}` +
            `${range.verifiedAt === null ? " [not verified]" : ` [verified ${range.verifiedAt}]`}` +
            `${range.evidenceNote === null ? "" : `\n  Note: ${range.evidenceNote}`}`,
        )
        .join("\n"),
    });
  }

  const evidence = await db
    .select()
    .from(schema.evidence)
    .where(eq(schema.evidence.findingId, finding.id));

  for (const item of evidence) {
    const artifacts = await db
      .select({
        filename: schema.artifacts.filename,
        sha256: schema.artifacts.sha256,
        artifactKind: schema.artifacts.artifactKind,
        visibility: schema.artifacts.visibility,
        previewText: schema.artifacts.previewText,
      })
      .from(schema.evidenceArtifacts)
      .innerJoin(
        schema.artifacts,
        eq(schema.artifacts.id, schema.evidenceArtifacts.artifactId),
      )
      .where(eq(schema.evidenceArtifacts.evidenceId, item.id));

    candidates.push({
      kind: "evidence",
      id: item.ref,
      label: item.title,
      // An evidence record is only as shareable as the most restricted thing
      // attached to it.
      visibility: artifacts.some((it) => it.visibility === "INTERNAL")
        ? "INTERNAL"
        : artifacts.some((it) => it.visibility === "VENDOR")
          ? mostRestrictive(item.visibility, "VENDOR")
          : item.visibility,
      text:
        `${item.title}\n${item.descriptionMarkdown ?? ""}\n\nFiles:\n` +
        artifacts
          .map(
            (artifact) =>
              `- ${artifact.filename} (${artifact.artifactKind}, sha256 ${artifact.sha256})` +
              `${artifact.previewText === null ? "" : `\n  Preview: ${artifact.previewText.slice(0, 2_000)}`}`,
          )
          .join("\n"),
    });
  }

  const claims = await db
    .select()
    .from(schema.claims)
    .where(eq(schema.claims.findingId, finding.id));

  for (const claim of claims) {
    candidates.push({
      kind: "claim",
      id: claim.key,
      label: `Claim: ${claim.key}`,
      visibility: claim.visibility,
      text:
        `${claim.statementMarkdown}\n` +
        `Source: ${claim.sourceType}${claim.sourceRef === null ? "" : ` (${claim.sourceRef})`}\n` +
        `Confidence: ${claim.confidence}` +
        `${claim.retrievedAt === null ? "" : `\nRetrieved: ${claim.retrievedAt}`}`,
    });
  }

  const references = await db
    .select()
    .from(schema.externalReferences)
    .where(eq(schema.externalReferences.findingId, finding.id));

  for (const reference of references) {
    candidates.push({
      kind: "reference",
      id: reference.ref,
      label: reference.title,
      visibility: reference.visibility,
      text:
        `${reference.title}\n${reference.url}\n` +
        `Publisher: ${reference.publisher ?? "unknown"}\n` +
        `Published: ${reference.publishedAt ?? "unknown"}`,
    });
  }

  if (action === "FINDING_PRIOR_ART_SYNTHESIS") {
    const checks = await db
      .select({ id: schema.priorArtChecks.id })
      .from(schema.priorArtChecks)
      .where(
        and(
          eq(schema.priorArtChecks.findingId, finding.id),
          eq(schema.priorArtChecks.status, "COMPLETED"),
        ),
      )
      .orderBy(desc(schema.priorArtChecks.startedAt))
      .limit(1);

    const latest = checks[0];

    if (latest !== undefined) {
      const matches = await db
        .select()
        .from(schema.priorArtMatches)
        .where(eq(schema.priorArtMatches.checkId, latest.id))
        .orderBy(desc(schema.priorArtMatches.similarity))
        .limit(40);

      for (const match of matches) {
        candidates.push({
          kind: "prior_art_match",
          id: match.id,
          label: `${match.provider}: ${match.externalId ?? match.title}`,
          // Advisory records already published elsewhere.
          visibility: "PUBLIC",
          text:
            `Provider: ${match.provider}\nIdentifier: ${match.externalId ?? "none"}\n` +
            `Title: ${match.title}\nAffected: ${match.affectedIdentity ?? "unknown"}\n` +
            `Published: ${match.publishedAt ?? "unknown"}\n` +
            `Query: ${match.query}\nRetrieved: ${match.retrievedAt}\n\n${match.summary}`,
        });
      }
    }
  }

  const context = buildContext(candidates, "INTERNAL", {
    ...input.policy,
    caseIsRestricted: researchCase.restricted,
  });

  const prompt = promptFor(action);

  return {
    caseId: finding.caseId,
    audience: "INTERNAL",
    context,
    promptText: assemblePrompt({
      systemInstruction: SYSTEM_INSTRUCTION,
      taskInstruction: prompt.taskInstruction,
      outputSchemaDescription: prompt.outputSchemaDescription,
      contextText: context.contextText,
      researcherInstruction: input.researcherInstruction ?? null,
    }),
  };
}

/**
 * Report-section context.
 *
 * Built at the report's audience, so drafting a public advisory sees only
 * PUBLIC material. This is the boundary the leak-prevention test exercises.
 */
async function prepareReportSectionRun(
  input: PrepareInput,
): Promise<PreparedRun> {
  const { db } = input;

  const rows = await db
    .select({
      section: schema.reportSections,
      report: schema.reports,
    })
    .from(schema.reportSections)
    .innerJoin(
      schema.reports,
      eq(schema.reports.id, schema.reportSections.reportId),
    )
    .where(eq(schema.reportSections.id, input.targetId))
    .limit(1);

  const row = rows[0];

  if (row === undefined) {
    throw notFound("Report section");
  }

  const { section, report } = row;
  const researchCase = await loadCase(db, report.caseId);
  const audience = report.audience;
  const candidates: ContextCandidate[] = [];

  candidates.push({
    kind: "section",
    id: section.key,
    label: `Section: ${section.title}`,
    visibility: "PUBLIC",
    text:
      `Report audience: ${audience}\nSection: ${section.title}\n` +
      `Purpose: ${section.promptPurpose ?? "not specified"}\n\n` +
      `Current content:\n${section.contentMarkdown || "(empty)"}`,
  });

  const findings = await db
    .select()
    .from(schema.findings)
    .where(eq(schema.findings.caseId, report.caseId));

  for (const finding of findings) {
    candidates.push({
      kind: "finding",
      id: finding.ref,
      label: finding.title,
      visibility: finding.visibility,
      text: renderFinding(finding),
    });

    const scores = await db
      .select()
      .from(schema.findingScores)
      .where(
        and(
          eq(schema.findingScores.findingId, finding.id),
          eq(schema.findingScores.reviewState, "APPROVED"),
        ),
      );

    for (const score of scores) {
      candidates.push({
        kind: "score",
        id: `${finding.ref}-${score.scheme}`,
        label: `${score.scheme} for ${finding.ref}`,
        visibility: "PUBLIC",
        text: `${score.scheme}: ${score.score ?? "n/a"} ${score.vector ?? ""}`.trim(),
      });
    }

    const ranges = await db
      .select()
      .from(schema.affectedRanges)
      .where(eq(schema.affectedRanges.findingId, finding.id));

    if (ranges.length > 0) {
      candidates.push({
        kind: "affected_versions",
        id: `${finding.ref}-versions`,
        label: `Affected versions for ${finding.ref}`,
        visibility: "VENDOR",
        text: ranges
          .map(
            (range) =>
              `${range.expression} — ${range.status}` +
              `${range.fixedIn === null ? "" : `, fixed in ${range.fixedIn}`}`,
          )
          .join("\n"),
      });
    }
  }

  const evidence = await db
    .select()
    .from(schema.evidence)
    .where(eq(schema.evidence.caseId, report.caseId));

  for (const item of evidence) {
    candidates.push({
      kind: "evidence",
      id: item.ref,
      label: item.title,
      visibility: item.visibility,
      text: `${item.title}\n${item.descriptionMarkdown ?? ""}`,
    });
  }

  const context = buildContext(candidates, audience, {
    ...input.policy,
    caseIsRestricted: researchCase.restricted,
  });

  const prompt = promptFor(input.action);

  return {
    caseId: report.caseId,
    audience,
    context,
    promptText: assemblePrompt({
      systemInstruction: SYSTEM_INSTRUCTION,
      taskInstruction: prompt.taskInstruction,
      outputSchemaDescription: prompt.outputSchemaDescription,
      contextText: context.contextText,
      researcherInstruction: input.researcherInstruction ?? null,
    }),
  };
}

async function findingIdForScoreTarget(
  db: Database,
  targetId: string,
): Promise<string> {
  const scores = await db
    .select({ findingId: schema.findingScores.findingId })
    .from(schema.findingScores)
    .where(eq(schema.findingScores.id, targetId))
    .limit(1);

  const score = scores[0];

  if (score !== undefined) {
    return score.findingId;
  }

  // Scoring actions may also target the finding directly, before any score
  // record exists for it.
  return targetId;
}

type FindingRow = typeof schema.findings.$inferSelect;

/**
 * Renders a finding as context text.
 *
 * Researcher notes are deliberately left out. The same rendering is used for
 * report contexts at every audience, and the whole blob carries a single
 * visibility tag, so private working notes would ride along into a vendor or
 * public draft on the strength of the finding's own visibility alone.
 */
function renderFinding(finding: FindingRow): string {
  const parts: string[] = [
    `Reference: ${finding.ref}`,
    `Title: ${finding.title}`,
    `Validation: ${finding.validationState}`,
    `Remediation: ${finding.remediationState}`,
    `Disclosure: ${finding.disclosureState}`,
    `CWE: ${finding.cweIds.length === 0 ? "none" : finding.cweIds.join(", ")}`,
  ];

  const sections: Array<[string, string | null]> = [
    ["Summary", finding.summaryMarkdown],
    ["Technical description", finding.technicalMarkdown],
    ["Preconditions", finding.preconditionsMarkdown],
    ["Attack path", finding.attackPathMarkdown],
    ["Impact", finding.impactMarkdown],
    ["Reproduction", finding.reproductionMarkdown],
    ["Remediation", finding.remediationMarkdown],
  ];

  for (const [heading, body] of sections) {
    if (body !== null && body.trim().length > 0) {
      parts.push(`\n## ${heading}\n${body}`);
    }
  }

  return parts.join("\n");
}

function mostRestrictive(
  left: "INTERNAL" | "VENDOR" | "PUBLIC",
  right: "INTERNAL" | "VENDOR" | "PUBLIC",
): "INTERNAL" | "VENDOR" | "PUBLIC" {
  if (left === "INTERNAL" || right === "INTERNAL") {
    return "INTERNAL";
  }

  if (left === "VENDOR" || right === "VENDOR") {
    return "VENDOR";
  }

  return "PUBLIC";
}
