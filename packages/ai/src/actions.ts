import type { TSchema } from "@sinclair/typebox";

import type { AiActionId, AiTargetType } from "@codevault/contracts";
import type { ReportAudience } from "@codevault/core";

import {
  AffectedVersionReviewOutput,
  ConsistencyReviewOutput,
  CvssSuggestionOutput,
  CweSuggestionOutput,
  DraftTextOutput,
  DraftTitleOutput,
  FactCheckOutput,
  LeakReviewOutput,
  PolishSectionOutput,
  PriorArtSynthesisOutput,
} from "./schemas.js";

/**
 * The AI action registry.
 *
 * This table is the entire surface a renderer can invoke. There is no route
 * that takes a prompt, a command or a provider argument — a client names an
 * action and a target, and the server decides what that means. Adding a
 * capability means adding a row here, in a reviewed commit.
 */

export interface AiActionDefinition {
  id: AiActionId;
  /** Short label for the AI toolbar. */
  label: string;
  /** One line explaining what the researcher gets. */
  description: string;
  targetType: AiTargetType;
  /** Schema the provider's JSON output must satisfy. */
  outputSchema: TSchema;
  /**
   * Audience whose visibility rules bound the context.
   *
   * Finding actions build an INTERNAL context because the researcher already
   * has full access to their own case; report actions inherit the audience of
   * the report being written, which is what keeps public drafting away from
   * internal evidence.
   */
  contextAudience: ReportAudience | "INHERIT_FROM_REPORT";
  /**
   * Whether accepting the resulting proposal changes canonical data.
   *
   * Review actions produce findings for a person to read; they never patch
   * anything, so accepting one records that it was read.
   */
  producesPatch: boolean;
  /**
   * Fields the accepted patch may touch.
   *
   * Enforced when a proposal is applied, so a drafting action cannot smuggle a
   * state change into its patch.
   */
  allowedPatchFields: readonly string[];
}

const DRAFT_FIELDS = {
  FINDING_DRAFT_SUMMARY: "summaryMarkdown",
  FINDING_DRAFT_TECHNICAL: "technicalMarkdown",
  FINDING_DRAFT_IMPACT: "impactMarkdown",
  FINDING_DRAFT_REMEDIATION: "remediationMarkdown",
} as const;

export const AI_ACTIONS: Readonly<Record<AiActionId, AiActionDefinition>> = {
  FINDING_DRAFT_TITLE: {
    id: "FINDING_DRAFT_TITLE",
    label: "Draft title",
    description: "Proposes a precise, non-sensational finding title.",
    targetType: "FINDING",
    outputSchema: DraftTitleOutput,
    contextAudience: "INTERNAL",
    producesPatch: true,
    allowedPatchFields: ["title"],
  },
  FINDING_DRAFT_SUMMARY: {
    id: "FINDING_DRAFT_SUMMARY",
    label: "Draft summary",
    description: "Drafts the executive summary from the recorded evidence.",
    targetType: "FINDING",
    outputSchema: DraftTextOutput,
    contextAudience: "INTERNAL",
    producesPatch: true,
    allowedPatchFields: [DRAFT_FIELDS.FINDING_DRAFT_SUMMARY],
  },
  FINDING_DRAFT_TECHNICAL: {
    id: "FINDING_DRAFT_TECHNICAL",
    label: "Draft technical description",
    description: "Drafts the technical analysis from evidence and notes.",
    targetType: "FINDING",
    outputSchema: DraftTextOutput,
    contextAudience: "INTERNAL",
    producesPatch: true,
    allowedPatchFields: [DRAFT_FIELDS.FINDING_DRAFT_TECHNICAL],
  },
  FINDING_DRAFT_IMPACT: {
    id: "FINDING_DRAFT_IMPACT",
    label: "Draft impact",
    description: "Describes what an attacker gains, in security terms.",
    targetType: "FINDING",
    outputSchema: DraftTextOutput,
    contextAudience: "INTERNAL",
    producesPatch: true,
    allowedPatchFields: [DRAFT_FIELDS.FINDING_DRAFT_IMPACT],
  },
  FINDING_DRAFT_REMEDIATION: {
    id: "FINDING_DRAFT_REMEDIATION",
    label: "Draft remediation",
    description: "Proposes remediation guidance for the vendor.",
    targetType: "FINDING",
    outputSchema: DraftTextOutput,
    contextAudience: "INTERNAL",
    producesPatch: true,
    allowedPatchFields: [DRAFT_FIELDS.FINDING_DRAFT_REMEDIATION],
  },
  FINDING_SUGGEST_CWE: {
    id: "FINDING_SUGGEST_CWE",
    label: "Suggest CWE",
    description: "Ranks candidate weakness classifications with reasoning.",
    targetType: "FINDING",
    outputSchema: CweSuggestionOutput,
    contextAudience: "INTERNAL",
    producesPatch: true,
    allowedPatchFields: ["cweIds"],
  },
  FINDING_SUGGEST_CVSS40: {
    id: "FINDING_SUGGEST_CVSS40",
    label: "Suggest CVSS 4.0",
    description: "Proposes each CVSS 4.0 metric with its justification.",
    targetType: "SCORE",
    outputSchema: CvssSuggestionOutput,
    contextAudience: "INTERNAL",
    producesPatch: true,
    // The vector is assembled from approved metrics; the score is computed.
    allowedPatchFields: ["metrics", "reasoningMarkdown"],
  },
  FINDING_SUGGEST_CVSS31: {
    id: "FINDING_SUGGEST_CVSS31",
    label: "Suggest CVSS 3.1",
    description: "Proposes each CVSS 3.1 metric with its justification.",
    targetType: "SCORE",
    outputSchema: CvssSuggestionOutput,
    contextAudience: "INTERNAL",
    producesPatch: true,
    allowedPatchFields: ["metrics", "reasoningMarkdown"],
  },
  FINDING_FACT_CHECK: {
    id: "FINDING_FACT_CHECK",
    label: "Fact check",
    description:
      "Classifies each claim as verified, externally supported, conflicting, unsupported or stale.",
    targetType: "FINDING",
    outputSchema: FactCheckOutput,
    contextAudience: "INTERNAL",
    producesPatch: false,
    allowedPatchFields: [],
  },
  FINDING_PRIOR_ART_SYNTHESIS: {
    id: "FINDING_PRIOR_ART_SYNTHESIS",
    label: "Compare prior art",
    description:
      "Compares stored search results against the finding. Advisory only — a person records the conclusion.",
    targetType: "FINDING",
    outputSchema: PriorArtSynthesisOutput,
    contextAudience: "INTERNAL",
    producesPatch: false,
    allowedPatchFields: [],
  },
  REPORT_DRAFT_SECTION: {
    id: "REPORT_DRAFT_SECTION",
    label: "Draft section",
    description: "Drafts this report section from data its audience may see.",
    targetType: "REPORT_SECTION",
    outputSchema: DraftTextOutput,
    contextAudience: "INHERIT_FROM_REPORT",
    producesPatch: true,
    allowedPatchFields: ["contentMarkdown"],
  },
  REPORT_POLISH_SECTION: {
    id: "REPORT_POLISH_SECTION",
    label: "Polish section",
    description: "Rewrites for clarity without changing any claim.",
    targetType: "REPORT_SECTION",
    outputSchema: PolishSectionOutput,
    contextAudience: "INHERIT_FROM_REPORT",
    producesPatch: true,
    allowedPatchFields: ["contentMarkdown"],
  },
  REPORT_CONSISTENCY_REVIEW: {
    id: "REPORT_CONSISTENCY_REVIEW",
    label: "Consistency review",
    description:
      "Checks the report's statements against the canonical finding, asset, version and score records.",
    targetType: "REPORT_SECTION",
    outputSchema: ConsistencyReviewOutput,
    contextAudience: "INHERIT_FROM_REPORT",
    producesPatch: false,
    allowedPatchFields: [],
  },
  REPORT_LEAK_REVIEW: {
    id: "REPORT_LEAK_REVIEW",
    label: "Leak review",
    description:
      "A second opinion on anything that should not be published. The deterministic linter remains authoritative.",
    targetType: "REPORT_SECTION",
    outputSchema: LeakReviewOutput,
    contextAudience: "INHERIT_FROM_REPORT",
    producesPatch: false,
    allowedPatchFields: [],
  },
  AFFECTED_VERSION_REVIEW: {
    id: "AFFECTED_VERSION_REVIEW",
    label: "Review affected versions",
    description:
      "Highlights version conclusions that were inferred rather than tested.",
    targetType: "FINDING",
    outputSchema: AffectedVersionReviewOutput,
    contextAudience: "INTERNAL",
    producesPatch: false,
    allowedPatchFields: [],
  },
};

export function isAiActionId(value: string): value is AiActionId {
  return Object.hasOwn(AI_ACTIONS, value);
}

export function aiAction(id: AiActionId): AiActionDefinition {
  return AI_ACTIONS[id];
}

/**
 * States AI is never allowed to reach, whatever an action's patch contains.
 *
 * Enforced when a proposal is applied. A model may argue that a finding is
 * novel, fixed or ready to publish; it cannot record that judgement.
 */
export const AI_FORBIDDEN_PATCH_FIELDS: readonly string[] = [
  "priorArtState",
  "validationState",
  "disclosureState",
  "externalIdState",
  "remediationState",
  "visibility",
  "reviewState",
  "approvedBy",
  "approvedAt",
  "status",
  "revision",
  "ownerId",
  "caseId",
];
