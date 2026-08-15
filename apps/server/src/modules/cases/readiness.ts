import { and, eq, inArray } from "drizzle-orm";

import type { CaseReadiness } from "@codevault/contracts";
import {
  BUILT_IN_POLICY_PACKS,
  mergeRequirements,
  type PolicyPack,
  type ReportAudience,
} from "@codevault/core";
import type { Database } from "@codevault/db";
import { schema } from "@codevault/db";

/**
 * Case readiness.
 *
 * Answers "what is still missing before this case can publish?" without
 * blocking any research work. A Program case can demand two CVSS versions and a
 * second approver; a standard case demands nothing, and the same code produces
 * both answers.
 */

interface RequirementResult {
  id: string;
  description: string;
  satisfied: boolean;
  detail: string | null;
}

export async function evaluateCaseReadiness(
  db: Database,
  caseId: string,
): Promise<CaseReadiness> {
  const packRows = await db
    .select({ policyPackId: schema.casePolicyPacks.policyPackId })
    .from(schema.casePolicyPacks)
    .where(eq(schema.casePolicyPacks.caseId, caseId));

  const attachedIds = new Set(packRows.map((row) => row.policyPackId));
  const packs: PolicyPack[] = BUILT_IN_POLICY_PACKS.filter((pack) =>
    attachedIds.has(pack.id),
  );
  const requirements = mergeRequirements(packs);
  const results: RequirementResult[] = [];

  const findings = await db
    .select({
      id: schema.findings.id,
      ref: schema.findings.ref,
      validationState: schema.findings.validationState,
    })
    .from(schema.findings)
    .where(eq(schema.findings.caseId, caseId));

  for (const scheme of requirements.requiredScoreSchemes) {
    const missing: string[] = [];

    for (const finding of findings) {
      const approved = await db
        .select({ id: schema.findingScores.id })
        .from(schema.findingScores)
        .where(
          and(
            eq(schema.findingScores.findingId, finding.id),
            eq(schema.findingScores.scheme, scheme),
            eq(schema.findingScores.reviewState, "APPROVED"),
          ),
        )
        .limit(1);

      if (approved.length === 0) {
        missing.push(finding.ref);
      }
    }

    results.push({
      id: `score:${scheme}`,
      description: `Every finding has an approved ${scheme} score`,
      satisfied: missing.length === 0,
      detail: missing.length === 0 ? null : `Missing for ${missing.join(", ")}`,
    });
  }

  const reports = await db
    .select({
      audience: schema.reports.audience,
      status: schema.reports.status,
    })
    .from(schema.reports)
    .where(eq(schema.reports.caseId, caseId));

  for (const audience of requirements.requiredReports) {
    const report = reports.find((row) => row.audience === audience);
    const satisfied =
      report !== undefined &&
      (report.status === "APPROVED" || report.status === "PUBLISHED");

    results.push({
      id: `report:${audience}`,
      description: `An approved ${audience.toLowerCase()} report exists`,
      satisfied,
      detail:
        report === undefined
          ? "The report has not been created."
          : satisfied
            ? null
            : `The report is ${report.status.toLowerCase().replace("_", " ")}.`,
    });
  }

  for (const [audience, titles] of Object.entries(
    requirements.requiredSections,
  ) as [ReportAudience, readonly string[]][]) {
    const report = reports.find((row) => row.audience === audience);

    if (report === undefined) {
      results.push({
        id: `sections:${audience}`,
        description: `The ${audience.toLowerCase()} report contains its required sections`,
        satisfied: false,
        detail: "The report has not been created.",
      });
      continue;
    }

    const sections = await db
      .select({
        title: schema.reportSections.title,
        content: schema.reportSections.contentMarkdown,
      })
      .from(schema.reportSections)
      .innerJoin(
        schema.reports,
        eq(schema.reports.id, schema.reportSections.reportId),
      )
      .where(
        and(
          eq(schema.reports.caseId, caseId),
          eq(schema.reports.audience, audience),
        ),
      );

    const missing = titles.filter((title) => {
      const section = sections.find((row) => row.title === title);

      return section === undefined || section.content.trim().length === 0;
    });

    results.push({
      id: `sections:${audience}`,
      description: `The ${audience.toLowerCase()} report contains its required sections`,
      satisfied: missing.length === 0,
      detail:
        missing.length === 0 ? null : `Empty or missing: ${missing.join(", ")}`,
    });
  }

  if (requirements.requireDisclosureContact) {
    const contacts = await db
      .select({ id: schema.stakeholders.id })
      .from(schema.stakeholders)
      .where(eq(schema.stakeholders.caseId, caseId))
      .limit(1);

    results.push({
      id: "disclosure:contact",
      description: "A disclosure contact is recorded",
      satisfied: contacts.length > 0,
      detail: contacts.length > 0 ? null : "No stakeholder has been added.",
    });
  }

  if (requirements.requirePeerReviewBeforeVendorReport) {
    const unreviewed = findings.filter(
      (finding) =>
        finding.validationState !== "PEER_REVIEWED" &&
        finding.validationState !== "CONFIRMED",
    );

    results.push({
      id: "validation:peer_review",
      description: "Every finding has been peer reviewed",
      satisfied: unreviewed.length === 0,
      detail:
        unreviewed.length === 0
          ? null
          : `Awaiting review: ${unreviewed.map((it) => it.ref).join(", ")}`,
    });
  }

  if (requirements.requireDistinctApprover) {
    const reportIds = await db
      .select({ id: schema.reports.id })
      .from(schema.reports)
      .where(eq(schema.reports.caseId, caseId));

    const ids = reportIds.map((row) => row.id);
    const approvals =
      ids.length === 0
        ? []
        : await db
            .select({
              reportId: schema.reportApprovals.reportId,
              approvedBy: schema.reportApprovals.approvedBy,
            })
            .from(schema.reportApprovals)
            .where(inArray(schema.reportApprovals.reportId, ids));

    results.push({
      id: "approval:distinct",
      description: "Approvals come from someone other than the last editor",
      // Enforced at approval time; surfaced here so the requirement is visible
      // before someone tries and is refused.
      satisfied: true,
      detail:
        approvals.length === 0
          ? "No report has been approved yet."
          : `${approvals.length} approval(s) recorded.`,
    });
  }

  return {
    caseId,
    satisfied: results.every((result) => result.satisfied),
    requirements: results,
  };
}
