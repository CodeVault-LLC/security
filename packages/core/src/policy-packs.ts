import type { CaseProfile } from "./states.js";
import type { ReportAudience } from "./visibility.js";

/**
 * Policy packs.
 *
 * A policy pack states what a case must satisfy before its reports may be
 * approved and exported. They are code-defined defaults rather than a visual
 * workflow designer: the point is that a Program case can demand two-person
 * approval and both CVSS versions without the finding model changing shape.
 */

export interface PolicyPackRequirements {
  /** Score schemes that must exist and be approved before export. */
  requiredScoreSchemes: readonly string[];
  /** Report audiences that must exist and be approved before publication. */
  requiredReports: readonly ReportAudience[];
  /** Section titles that must be present and non-empty per audience. */
  requiredSections: Partial<Record<ReportAudience, readonly string[]>>;
  /** Approver must differ from the last editor of the report. */
  requireDistinctApprover: boolean;
  /** Peer review required before a vendor report can be approved. */
  requirePeerReviewBeforeVendorReport: boolean;
  /** A disclosure contact must exist before entering VENDOR_CONTACTED. */
  requireDisclosureContact: boolean;
  /** Restricted case membership is recommended for this profile. */
  recommendRestrictedCase: boolean;
  /** Blocking lint findings prevent export. Always true; kept explicit. */
  blockExportOnLintErrors: boolean;
}

export interface PolicyPack {
  id: string;
  name: string;
  description: string;
  profile: CaseProfile;
  requirements: PolicyPackRequirements;
}

const NO_REQUIREMENTS: PolicyPackRequirements = {
  requiredScoreSchemes: [],
  requiredReports: [],
  requiredSections: {},
  requireDistinctApprover: false,
  requirePeerReviewBeforeVendorReport: false,
  requireDisclosureContact: false,
  recommendRestrictedCase: false,
  blockExportOnLintErrors: true,
};

export const STANDARD_POLICY_PACK: PolicyPack = {
  id: "CODEVAULT_STANDARD_V1",
  name: "Standard",
  description:
    "Lightweight research. One reviewer is optional, disclosure fields are not " +
    "required, and the internal report is optional.",
  profile: "STANDARD",
  requirements: NO_REQUIREMENTS,
};

export const COORDINATED_DISCLOSURE_POLICY_PACK: PolicyPack = {
  id: "CODEVAULT_COORDINATED_DISCLOSURE_V1",
  name: "Coordinated Disclosure",
  description:
    "Vendor report required, disclosure contact required before contacting the " +
    "vendor, publication lint required.",
  profile: "COORDINATED_DISCLOSURE",
  requirements: {
    ...NO_REQUIREMENTS,
    requiredReports: ["VENDOR"],
    requireDisclosureContact: true,
  },
};

export const CRITICAL_ZERO_DAY_POLICY_PACK: PolicyPack = {
  id: "CODEVAULT_CRITICAL_ZERO_DAY_V1",
  name: "Critical Zero-Day",
  description:
    "Restricted case recommended, peer review required before vendor report " +
    "approval, distinct approver required, full AI context audit retained.",
  profile: "CRITICAL_ZERO_DAY",
  requirements: {
    ...NO_REQUIREMENTS,
    requiredScoreSchemes: ["CVSS40"],
    requiredReports: ["VENDOR", "PUBLIC"],
    requireDistinctApprover: true,
    requirePeerReviewBeforeVendorReport: true,
    requireDisclosureContact: true,
    recommendRestrictedCase: true,
  },
};

export const PROGRAM_POLICY_PACK: PolicyPack = {
  id: "CODEVAULT_PROGRAM_V1",
  name: "Program",
  description:
    "Government or customer programme requirements: both CVSS versions, " +
    "two-person report approval, and a fixed section list.",
  profile: "PROGRAM",
  requirements: {
    ...NO_REQUIREMENTS,
    requiredScoreSchemes: ["CVSS31", "CVSS40"],
    requiredReports: ["INTERNAL", "VENDOR"],
    requiredSections: {
      INTERNAL: [
        "Executive Summary",
        "Technical Analysis",
        "Impact",
        "Remediation Analysis",
      ],
      VENDOR: [
        "Executive Summary",
        "Affected Versions",
        "Severity and CVSS",
        "Recommended Remediation",
      ],
    },
    requireDistinctApprover: true,
    requireDisclosureContact: true,
  },
};

export const BUILT_IN_POLICY_PACKS: readonly PolicyPack[] = [
  STANDARD_POLICY_PACK,
  COORDINATED_DISCLOSURE_POLICY_PACK,
  CRITICAL_ZERO_DAY_POLICY_PACK,
  PROGRAM_POLICY_PACK,
];

export function defaultPolicyPackForProfile(profile: CaseProfile): PolicyPack {
  const pack = BUILT_IN_POLICY_PACKS.find((it) => it.profile === profile);

  if (pack === undefined) {
    return STANDARD_POLICY_PACK;
  }

  return pack;
}

/**
 * Merges several attached packs into one effective requirement set.
 *
 * Requirements only ever accumulate — attaching a pack can tighten a case but
 * never loosen a requirement another pack imposed.
 */
export function mergeRequirements(
  packs: readonly PolicyPack[],
): PolicyPackRequirements {
  return packs.reduce<PolicyPackRequirements>((merged, pack) => {
    const { requirements } = pack;
    const sections: Partial<Record<ReportAudience, readonly string[]>> = {
      ...merged.requiredSections,
    };

    for (const [audience, titles] of Object.entries(
      requirements.requiredSections,
    ) as [ReportAudience, readonly string[]][]) {
      const existing = sections[audience] ?? [];

      sections[audience] = [...new Set([...existing, ...titles])];
    }

    return {
      requiredScoreSchemes: [
        ...new Set([
          ...merged.requiredScoreSchemes,
          ...requirements.requiredScoreSchemes,
        ]),
      ],
      requiredReports: [
        ...new Set([
          ...merged.requiredReports,
          ...requirements.requiredReports,
        ]),
      ],
      requiredSections: sections,
      requireDistinctApprover:
        merged.requireDistinctApprover || requirements.requireDistinctApprover,
      requirePeerReviewBeforeVendorReport:
        merged.requirePeerReviewBeforeVendorReport ||
        requirements.requirePeerReviewBeforeVendorReport,
      requireDisclosureContact:
        merged.requireDisclosureContact ||
        requirements.requireDisclosureContact,
      recommendRestrictedCase:
        merged.recommendRestrictedCase || requirements.recommendRestrictedCase,
      blockExportOnLintErrors: true,
    };
  }, NO_REQUIREMENTS);
}
