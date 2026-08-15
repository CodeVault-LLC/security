import type { ContentVisibility, ReportAudience } from "@codevault/core";
import { defaultTlpForAudience, type TlpLabel } from "@codevault/standards";

/**
 * Built-in report templates.
 *
 * A template states what a report of a given audience contains, what it may
 * consume, and what each section is for. The `promptPurpose` is shown above the
 * editor and is also what an AI drafting action is told to write toward, so the
 * human and the model are working from the same brief.
 */

export interface TemplateSection {
  key: string;
  title: string;
  required: boolean;
  promptPurpose: string;
}

export interface ReportTemplate {
  id: string;
  name: string;
  audience: ReportAudience;
  defaultTlp: TlpLabel;
  visibilityCeiling: ContentVisibility;
  version: string;
  sections: TemplateSection[];
}

const section = (
  key: string,
  title: string,
  required: boolean,
  promptPurpose: string,
): TemplateSection => ({ key, title, required, promptPurpose });

export const INTERNAL_TEMPLATE: ReportTemplate = {
  id: "CODEVAULT_INTERNAL_V1",
  name: "CodeVault Internal Report",
  audience: "INTERNAL",
  defaultTlp: defaultTlpForAudience("INTERNAL"),
  visibilityCeiling: "INTERNAL",
  version: "1.0.0",
  sections: [
    section(
      "executive_summary",
      "Executive Summary",
      true,
      "What was found, in whose product, and why it matters — for a colleague who has not read the case.",
    ),
    section(
      "research_context",
      "Research Context",
      false,
      "Why this research was undertaken and what scope it covered.",
    ),
    section("target", "Target / Asset", true, "The asset under test and how it was obtained or accessed."),
    section(
      "affected_versions",
      "Affected Versions",
      true,
      "Which versions were tested, which are affected, and how each conclusion was reached.",
    ),
    section(
      "technical_analysis",
      "Technical Analysis",
      true,
      "The root cause in technical detail, including the code path or protocol behaviour involved.",
    ),
    section(
      "attack_preconditions",
      "Attack Preconditions",
      false,
      "What an attacker needs before exploitation is possible.",
    ),
    section("attack_path", "Attack Path", false, "The steps from precondition to impact."),
    section("impact", "Impact", true, "What an attacker gains, in security terms rather than adjectives."),
    section("reproduction", "Reproduction", false, "Steps a colleague can follow to see the issue."),
    section("poc", "Proof of Concept", false, "The proof-of-concept material and how to run it safely."),
    section("evidence", "Evidence", false, "The captures, screenshots and artifacts that support the claims."),
    section(
      "scoring",
      "Scoring and Classification",
      false,
      "The approved CVSS vectors, CWE classification and the reasoning behind each metric.",
    ),
    section(
      "alternatives",
      "Alternative Exploitation / Failed Hypotheses",
      false,
      "Approaches that were tried and did not work, so the next researcher does not repeat them.",
    ),
    section(
      "remediation_analysis",
      "Remediation Analysis",
      false,
      "What a correct fix looks like, and what would only be a mitigation.",
    ),
    section(
      "prior_art",
      "Prior Art / Related Vulnerabilities",
      false,
      "What was searched, what was found, and the recorded conclusion.",
    ),
    section(
      "vendor_context",
      "Vendor / Stakeholder Context",
      false,
      "Who the vendor is, their disclosure posture, and any history with them.",
    ),
    section("disclosure_strategy", "Disclosure Strategy", false, "The plan, and the reasoning behind the timing."),
    section("disclosure_timeline", "Disclosure Timeline", false, "The recorded sequence of disclosure events."),
    section("references", "References", false, "External sources relied upon."),
    section("appendices", "Appendices", false, "Supporting material that would interrupt the narrative."),
  ],
};

export const VENDOR_TEMPLATE: ReportTemplate = {
  id: "CODEVAULT_VENDOR_V1",
  name: "CodeVault Vendor Disclosure Report",
  audience: "VENDOR",
  defaultTlp: defaultTlpForAudience("VENDOR"),
  visibilityCeiling: "VENDOR",
  version: "1.0.0",
  sections: [
    section(
      "executive_summary",
      "Executive Summary",
      true,
      "What the vendor needs to understand in the first thirty seconds.",
    ),
    section("affected_product", "Affected Product", true, "The product, component and configuration affected."),
    section("affected_versions", "Affected Versions", true, "Exact affected and unaffected versions."),
    section("severity", "Severity and CVSS", true, "The approved vector and score, with the reasoning for each metric."),
    section("description", "Vulnerability Description", true, "The vulnerability class and root cause."),
    section("impact", "Security Impact", true, "What an attacker achieves against the vendor's users."),
    section("preconditions", "Attack Preconditions", false, "Access, privileges or configuration required."),
    section("technical_details", "Technical Details", true, "Enough detail for the vendor's engineers to locate the flaw."),
    section("reproduction", "Reproduction Steps", true, "Steps the vendor can follow to reproduce it."),
    section("poc", "Proof of Concept", false, "Proof-of-concept material cleared for the vendor."),
    section(
      "remediation",
      "Recommended Remediation",
      true,
      "The fix being recommended, and why a narrower patch would be insufficient.",
    ),
    section("evidence", "Supporting Evidence", false, "Evidence cleared for vendor disclosure."),
    section("timeline", "Disclosure Timeline", false, "The disclosure history to date."),
    section("references", "References", false, "External sources relied upon."),
    section("contact", "Contact", true, "How to reach the researcher, and the expected response window."),
  ],
};

export const PUBLIC_TEMPLATE: ReportTemplate = {
  id: "CODEVAULT_PUBLIC_V1",
  name: "CodeVault Public Advisory",
  audience: "PUBLIC",
  defaultTlp: defaultTlpForAudience("PUBLIC"),
  visibilityCeiling: "PUBLIC",
  version: "1.0.0",
  sections: [
    section("summary", "Summary", true, "The advisory in a paragraph a reader can act on."),
    section("affected_products", "Affected Products", true, "Products and components affected."),
    section("affected_versions", "Affected Versions", true, "Affected and fixed versions."),
    section("identifiers", "Identifiers", false, "CVE and vendor identifiers."),
    section("severity", "Severity", true, "The published score and vector."),
    section("description", "Technical Description", true, "The vulnerability class, at a level appropriate for public release."),
    section("impact", "Impact", true, "What an attacker achieves."),
    section(
      "exploitation",
      "Exploitation Requirements",
      false,
      "What is required to exploit it, without providing a recipe.",
    ),
    section("remediation", "Remediation / Fixed Versions", true, "What users should install or change."),
    section("analysis", "Technical Analysis", false, "Deeper analysis, published only once a fix is available."),
    section("timeline", "Disclosure Timeline", false, "The public disclosure timeline."),
    section("credits", "Credits", false, "Who found it and who coordinated the fix."),
    section("references", "References", false, "Vendor advisories and related publications."),
  ],
};

export const BUILT_IN_TEMPLATES: readonly ReportTemplate[] = [
  INTERNAL_TEMPLATE,
  VENDOR_TEMPLATE,
  PUBLIC_TEMPLATE,
];

export function templateForAudience(audience: ReportAudience): ReportTemplate {
  if (audience === "INTERNAL") {
    return INTERNAL_TEMPLATE;
  }

  if (audience === "VENDOR") {
    return VENDOR_TEMPLATE;
  }

  return PUBLIC_TEMPLATE;
}

export function templateById(id: string): ReportTemplate | null {
  return BUILT_IN_TEMPLATES.find((template) => template.id === id) ?? null;
}
