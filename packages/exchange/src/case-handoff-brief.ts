import type {
  AuditEvent,
  CaseDetail,
  CaseReadiness,
  DisclosureOverview,
  FindingSummary,
} from "@codevault/contracts";

export interface CaseHandoffBriefInput {
  researchCase: CaseDetail;
  findings: readonly FindingSummary[];
  readiness: CaseReadiness;
  disclosure: DisclosureOverview | null;
  activity: readonly AuditEvent[];
  generatedAt: string;
}

/** Builds a byte-stable Markdown snapshot for handing active research to another person. */
export function buildCaseHandoffBrief(input: CaseHandoffBriefInput): string {
  const { researchCase, findings, readiness, disclosure, activity } = input;
  const lines = [
    `# ${inline(researchCase.ref)}: ${inline(researchCase.title)}`,
    "",
    `Generated at ${input.generatedAt}.`,
    "",
    "## Case snapshot",
    "",
    `- **Status:** ${researchCase.status}`,
    `- **Profile:** ${researchCase.profile}`,
    `- **Access:** ${researchCase.restricted ? "Restricted" : "Organization-visible"}`,
    `- **Owner:** ${inline(researchCase.owner.displayName)} (${inline(researchCase.owner.email)})`,
    `- **Last updated:** ${researchCase.updatedAt}`,
    `- **Revision:** ${researchCase.revision}`,
    "",
    researchCase.summary ?? "No case summary recorded.",
    "",
    "## Readiness",
    "",
    readiness.satisfied
      ? "All configured publication requirements are satisfied."
      : "Publication requirements remain outstanding.",
    "",
  ];

  if (readiness.requirements.length === 0) {
    lines.push("No policy requirements are configured.", "");
  } else {
    for (const requirement of readiness.requirements) {
      lines.push(
        `- [${requirement.satisfied ? "x" : " "}] ${inline(requirement.description)}${
          requirement.detail === null ? "" : `: ${inline(requirement.detail)}`
        }`,
      );
    }
    lines.push("");
  }

  lines.push("## Findings", "");
  if (findings.length === 0) {
    lines.push("No findings recorded.", "");
  } else {
    lines.push(
      "| Ref | Finding | Severity | Validation | Remediation | Disclosure |",
      "| --- | --- | --- | --- | --- | --- |",
    );
    for (const finding of findings) {
      lines.push(
        `| ${table(finding.ref)} | ${table(finding.title)} | ${table(
          finding.severity ?? "UNSCORED",
        )} | ${table(finding.validationState)} | ${table(
          finding.remediationState,
        )} | ${table(finding.disclosureState)} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Disclosure timing", "");
  if (!researchCase.disclosureEnabled) {
    lines.push("Disclosure coordination is not enabled.", "");
  } else if (disclosure === null) {
    lines.push("Disclosure coordination data was unavailable.", "");
  } else {
    const embargo = disclosure.embargo;
    lines.push(
      `- **Expected response:** ${embargo?.expectedResponseAt ?? "Not set"}`,
      `- **Embargo ends:** ${embargo?.endsAt ?? "Not set"}`,
      `- **Planned disclosure:** ${embargo?.plannedDisclosureAt ?? "Not set"}`,
      `- **Stakeholders:** ${disclosure.stakeholders.length}`,
      "",
    );
    if (disclosure.warnings.length > 0) {
      lines.push("### Coordination warnings", "");
      for (const warning of disclosure.warnings) {
        lines.push(
          `- ${inline(warning.message)}${warning.dueAt === null ? "" : ` (${warning.dueAt})`}`,
        );
      }
      lines.push("");
    }
  }

  lines.push("## Recent activity", "");
  if (activity.length === 0) {
    lines.push("No recent activity recorded.", "");
  } else {
    for (const event of activity.slice(0, 50)) {
      lines.push(
        `- ${event.occurredAt} · ${inline(event.action)} · ${inline(
          event.actor?.displayName ?? "system",
        )} · ${inline(event.entityType)}${
          event.entityId === null ? "" : ` ${inline(event.entityId)}`
        }`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function inline(value: string): string {
  return value.replaceAll(/\s+/gu, " ").trim();
}

function table(value: string): string {
  return inline(value).replaceAll("|", "\\|");
}
