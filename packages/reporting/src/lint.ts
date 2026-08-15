import {
  canInclude,
  type ContentVisibility,
  type ReportAudience,
  type ReviewState,
} from "@codevault/core";
import { isTlpAllowedForAudience, type TlpLabel } from "@codevault/standards";

import {
  isKnownDirectiveKind,
  parseDirectives,
} from "./directives.js";

/**
 * Report linter.
 *
 * Runs before approval and before export. Most rules are advisory; a few are
 * BLOCKING, and those are the ones that stop a report leaving the building with
 * something in it that should never have been there.
 *
 * The linter is deliberately noisy about things it cannot be certain of — an
 * internal hostname, a string that looks like an API key — because a false
 * positive costs a researcher ten seconds and a false negative can end an
 * embargo early.
 */

export const LINT_SEVERITIES = [
  "INFO",
  "WARNING",
  "ERROR",
  "BLOCKING",
] as const;

export type LintSeverity = (typeof LINT_SEVERITIES)[number];

export interface LintFinding {
  ruleId: string;
  severity: LintSeverity;
  message: string;
  sectionId: string | null;
  sectionTitle: string | null;
  line: number | null;
  excerpt: string | null;
}

export interface LintSectionInput {
  id: string;
  key: string;
  title: string;
  required: boolean;
  contentMarkdown: string;
  reviewState: ReviewState;
  /** Source records the section depends on, e.g. `finding:<uuid>`. */
  sourceRefs: readonly string[];
}

export interface LintReferencedItem {
  /** The directive argument, e.g. `EVID-000123`. */
  reference: string;
  kind: string;
  visibility: ContentVisibility;
  /** Set for PoCs; a PoC must be approved for the audience it appears in. */
  approvedForAudience?: boolean;
}

export interface LintInput {
  audience: ReportAudience;
  tlp: TlpLabel;
  sections: readonly LintSectionInput[];
  /** Section titles the template marks required. */
  requiredSectionTitles: readonly string[];
  /** Everything the report's directives point at, already looked up. */
  referencedItems: readonly LintReferencedItem[];
  /** Approved scores on the case's findings, used for score/vector checks. */
  scores: readonly {
    scheme: string;
    vector: string | null;
    score: number | null;
  }[];
  /** CVE identifiers recorded on the case's findings. */
  findingCveIds: readonly string[];
  /** Affected-version conclusions present on the case's findings. */
  hasAffectedVersionConclusion: boolean;
  /** Private addresses explicitly allow-listed for this report. */
  allowedPrivateAddresses?: readonly string[];
}

export interface LintResult {
  findings: LintFinding[];
  blocking: boolean;
  checkedAt: string;
}

interface SectionMatch {
  line: number;
  excerpt: string;
}

/** Finds every match of a pattern with its line number and a short excerpt. */
function scan(markdown: string, pattern: RegExp): SectionMatch[] {
  const matches: SectionMatch[] = [];
  const lines = markdown.split("\n");

  for (const [index, line] of lines.entries()) {
    // Each line is tested independently, so a global regex would carry its
    // lastIndex between lines and skip matches.
    const linePattern = new RegExp(pattern.source, pattern.flags.replace("g", ""));
    const match = linePattern.exec(line);

    if (match !== null) {
      matches.push({
        line: index + 1,
        excerpt: line.trim().slice(0, 160),
      });
    }
  }

  return matches;
}

/** Private and link-local ranges, plus loopback. */
const PRIVATE_ADDRESS_PATTERN =
  /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})\b/;

/** Hostnames that only exist inside a network. */
const INTERNAL_HOSTNAME_PATTERN =
  /\b[a-z0-9-]+\.(?:internal|intranet|corp|lan|local|home\.arpa)\b/i;

/**
 * Credential-shaped strings.
 *
 * Tuned for the tokens that actually turn up pasted into a reproduction step:
 * cloud keys, personal access tokens, private-key headers and `password=`.
 */
const CREDENTIAL_PATTERNS: Array<{ id: string; pattern: RegExp; label: string }> =
  [
    {
      id: "aws-access-key",
      pattern: /\bAKIA[0-9A-Z]{16}\b/,
      label: "an AWS access key ID",
    },
    {
      id: "github-token",
      pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
      label: "a GitHub token",
    },
    {
      id: "slack-token",
      pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/,
      label: "a Slack token",
    },
    {
      id: "private-key",
      pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
      label: "a private key block",
    },
    {
      id: "bearer-token",
      pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/,
      label: "a bearer token",
    },
    {
      id: "inline-password",
      pattern: /\b(?:password|passwd|secret|api[_-]?key)\s*[=:]\s*\S{6,}/i,
      label: "an inline credential",
    },
  ];

/** Filenames that only make sense inside CodeVault's own workspace. */
const INTERNAL_FILENAME_PATTERN =
  /\b[\w.-]*(?:internal|private|confidential|do[-_]not[-_]share)[\w.-]*\.(?:md|txt|pdf|docx?|xlsx?|zip|tar|gz)\b/i;

export function lintReport(input: LintInput): LintResult {
  const findings: LintFinding[] = [];
  const isPublic = input.audience === "PUBLIC";

  const add = (
    finding: Omit<LintFinding, "sectionId" | "sectionTitle"> &
      Partial<Pick<LintFinding, "sectionId" | "sectionTitle">>,
  ): void => {
    findings.push({
      sectionId: null,
      sectionTitle: null,
      ...finding,
    });
  };

  // --- Structure ----------------------------------------------------------

  for (const title of input.requiredSectionTitles) {
    const section = input.sections.find((it) => it.title === title);

    if (section === undefined) {
      add({
        ruleId: "required-section-missing",
        severity: "BLOCKING",
        message: `The required section "${title}" is missing from this report.`,
        line: null,
        excerpt: null,
      });
      continue;
    }

    if (section.contentMarkdown.trim().length === 0) {
      add({
        ruleId: "required-section-empty",
        severity: "BLOCKING",
        message: `The required section "${title}" is empty.`,
        sectionId: section.id,
        sectionTitle: section.title,
        line: null,
        excerpt: null,
      });
    }
  }

  // --- Per-section content ------------------------------------------------

  for (const section of input.sections) {
    const { contentMarkdown: markdown } = section;
    const inSection = (
      finding: Omit<LintFinding, "sectionId" | "sectionTitle">,
    ): void => {
      findings.push({
        ...finding,
        sectionId: section.id,
        sectionTitle: section.title,
      });
    };

    if (section.reviewState === "AI_DRAFT" && markdown.trim().length > 0) {
      inSection({
        ruleId: "unapproved-ai-section",
        severity: isPublic ? "BLOCKING" : "ERROR",
        message:
          `"${section.title}" is still an unreviewed AI draft. ` +
          `A person has to read it before it is published.`,
        line: null,
        excerpt: null,
      });
    }

    if (section.reviewState === "NEEDS_REVIEW") {
      inSection({
        ruleId: "stale-approved-section",
        severity: "ERROR",
        message:
          `"${section.title}" was approved earlier, but a fact it relies on ` +
          `has since changed. Re-read it before publishing.`,
        line: null,
        excerpt: null,
      });
    }

    for (const directive of parseDirectives(markdown)) {
      if (!isKnownDirectiveKind(directive.kind)) {
        inSection({
          ruleId: "unknown-directive",
          severity: "BLOCKING",
          message: `"${directive.raw}" is not a directive CodeVault knows.`,
          line: directive.line,
          excerpt: directive.raw,
        });
        continue;
      }

      if (directive.argument.length === 0 && directive.kind !== "disclosure-timeline") {
        inSection({
          ruleId: "directive-missing-argument",
          severity: "BLOCKING",
          message: `"${directive.raw}" is missing its reference.`,
          line: directive.line,
          excerpt: directive.raw,
        });
        continue;
      }

      const item = input.referencedItems.find(
        (candidate) => candidate.reference === directive.argument,
      );

      if (item === undefined && directive.kind !== "disclosure-timeline") {
        inSection({
          ruleId: "unresolved-directive",
          severity: "BLOCKING",
          message: `"${directive.raw}" does not resolve to anything in this case.`,
          line: directive.line,
          excerpt: directive.raw,
        });
        continue;
      }

      if (item !== undefined && !canInclude(item.visibility, input.audience)) {
        inSection({
          ruleId: "visibility-violation",
          severity: "BLOCKING",
          message:
            `"${directive.raw}" is ${item.visibility} content and cannot ` +
            `appear in a ${input.audience} report.`,
          line: directive.line,
          excerpt: directive.raw,
        });
        continue;
      }

      if (
        item !== undefined &&
        item.kind === "poc" &&
        item.approvedForAudience === false
      ) {
        inSection({
          ruleId: "poc-not-approved",
          severity: "BLOCKING",
          message:
            `The proof of concept "${directive.argument}" has not been approved ` +
            `for a ${input.audience} audience.`,
          line: directive.line,
          excerpt: directive.raw,
        });
      }
    }

    for (const credential of CREDENTIAL_PATTERNS) {
      for (const match of scan(markdown, credential.pattern)) {
        inSection({
          ruleId: `credential:${credential.id}`,
          severity: isPublic ? "BLOCKING" : "ERROR",
          message: `This looks like ${credential.label}. Redact it before publishing.`,
          line: match.line,
          excerpt: match.excerpt,
        });
      }
    }

    if (isPublic) {
      for (const match of scan(markdown, PRIVATE_ADDRESS_PATTERN)) {
        const allowed = (input.allowedPrivateAddresses ?? []).some((address) =>
          match.excerpt.includes(address),
        );

        if (allowed) {
          continue;
        }

        inSection({
          ruleId: "private-address-in-public",
          severity: "ERROR",
          message:
            "A private or loopback address appears in a public report. " +
            "Replace it with a placeholder unless it is genuinely part of the finding.",
          line: match.line,
          excerpt: match.excerpt,
        });
      }

      for (const match of scan(markdown, INTERNAL_HOSTNAME_PATTERN)) {
        inSection({
          ruleId: "internal-hostname-in-public",
          severity: "ERROR",
          message: "An internal hostname appears in a public report.",
          line: match.line,
          excerpt: match.excerpt,
        });
      }

      for (const match of scan(markdown, INTERNAL_FILENAME_PATTERN)) {
        inSection({
          ruleId: "internal-filename-in-public",
          severity: "WARNING",
          message: "A filename marked internal or confidential appears in a public report.",
          line: match.line,
          excerpt: match.excerpt,
        });
      }

      for (const match of scan(markdown, /TLP:\s*RED|TLP:\s*AMBER/i)) {
        inSection({
          ruleId: "restricted-tlp-in-public",
          severity: "BLOCKING",
          message:
            "Content marked TLP:RED or TLP:AMBER cannot appear in a public report.",
          line: match.line,
          excerpt: match.excerpt,
        });
      }
    }

    for (const match of scan(
      markdown,
      /\bthe vendor (?:confirms|states|says|reports)\b/i,
    )) {
      inSection({
        ruleId: "vendor-claim-attribution",
        severity: "INFO",
        message:
          "A vendor statement is presented here. Make sure it reads as the " +
          "vendor's claim rather than as something CodeVault verified.",
        line: match.line,
        excerpt: match.excerpt,
      });
    }
  }

  // --- Cross-cutting checks ----------------------------------------------

  if (!isTlpAllowedForAudience(input.tlp, input.audience)) {
    add({
      ruleId: "tlp-audience-mismatch",
      severity: "BLOCKING",
      message: `${input.tlp} is not a valid marking for a ${input.audience} report.`,
      line: null,
      excerpt: null,
    });
  }

  if (!input.hasAffectedVersionConclusion) {
    add({
      ruleId: "missing-affected-versions",
      severity: input.audience === "INTERNAL" ? "WARNING" : "ERROR",
      message:
        "No affected-version conclusion has been recorded. A reader cannot act " +
        "on a report that does not say what is affected.",
      line: null,
      excerpt: null,
    });
  }

  const showsScore = input.sections.some((section) =>
    /\b(?:CVSS|severity|score)\b/i.test(section.contentMarkdown),
  );
  const hasVector = input.scores.some(
    (score) => score.vector !== null && score.vector.length > 0,
  );

  if (showsScore && !hasVector) {
    add({
      ruleId: "score-without-vector",
      severity: "ERROR",
      message:
        "The report discusses severity but no approved CVSS vector exists. " +
        "A score without its vector cannot be checked by the reader.",
      line: null,
      excerpt: null,
    });
  }

  for (const score of input.scores) {
    if (score.vector !== null && score.score === null) {
      add({
        ruleId: "vector-without-score",
        severity: "ERROR",
        message: `The ${score.scheme} vector has no computed score.`,
        line: null,
        excerpt: null,
      });
    }
  }

  const mentionedCves = new Set<string>();

  for (const section of input.sections) {
    for (const match of section.contentMarkdown.matchAll(
      /\bCVE-\d{4}-\d{4,}\b/g,
    )) {
      mentionedCves.add(match[0].toUpperCase());
    }
  }

  const recordedCves = new Set(
    input.findingCveIds.map((id) => id.toUpperCase()),
  );

  for (const cve of mentionedCves) {
    if (recordedCves.size > 0 && !recordedCves.has(cve)) {
      add({
        ruleId: "cve-mismatch",
        severity: "WARNING",
        message:
          `${cve} appears in the report but is not recorded on any finding in ` +
          `this case. Check it is the right identifier.`,
        line: null,
        excerpt: null,
      });
    }
  }

  return {
    findings,
    blocking: findings.some((finding) => finding.severity === "BLOCKING"),
    checkedAt: new Date().toISOString(),
  };
}

/** Convenience predicate used by the export path. */
export function hasBlockingFindings(result: LintResult): boolean {
  return result.blocking;
}
