/**
 * Finding lifecycle vocabulary.
 *
 * A finding never has one overloaded "status". Validation, remediation,
 * disclosure, external identifier and prior-art progress move independently,
 * because in real research they genuinely do: a finding can be CONFIRMED,
 * still UNFIXED, already EMBARGOED and have a CVE reserved, all at once.
 */

export const VALIDATION_STATES = [
  "DRAFT",
  "REPRODUCED",
  "PEER_REVIEWED",
  "CONFIRMED",
  "DISPUTED",
  "INVALID",
] as const;

export type ValidationState = (typeof VALIDATION_STATES)[number];

export const REMEDIATION_STATES = [
  "UNKNOWN",
  "UNFIXED",
  "FIX_PROPOSED",
  "FIX_AVAILABLE",
  "FIXED",
  "FIX_VERIFIED",
  "REGRESSED",
  "NOT_APPLICABLE",
] as const;

export type RemediationState = (typeof REMEDIATION_STATES)[number];

export const DISCLOSURE_STATES = [
  "PRIVATE",
  "CONTACT_PREPARED",
  "VENDOR_CONTACTED",
  "ACKNOWLEDGED",
  "COORDINATING",
  "EMBARGOED",
  "PUBLIC",
] as const;

export type DisclosureState = (typeof DISCLOSURE_STATES)[number];

export const EXTERNAL_ID_STATES = [
  "NONE",
  "CVE_REQUESTED",
  "CVE_RESERVED",
  "CVE_PUBLISHED",
  "VENDOR_ID_ASSIGNED",
] as const;

export type ExternalIdState = (typeof EXTERNAL_ID_STATES)[number];

export const PRIOR_ART_STATES = [
  "UNCHECKED",
  "NO_PRIOR_ART_FOUND",
  "POSSIBLE_MATCH",
  "LIKELY_KNOWN",
  "CONFIRMED_KNOWN",
  "HUMAN_CONFIRMED_NOVEL",
] as const;

export type PriorArtState = (typeof PRIOR_ART_STATES)[number];

export const CASE_PROFILES = [
  "STANDARD",
  "COORDINATED_DISCLOSURE",
  "CRITICAL_ZERO_DAY",
  "PROGRAM",
] as const;

export type CaseProfile = (typeof CASE_PROFILES)[number];

export const CASE_STATUSES = ["OPEN", "PAUSED", "CLOSED", "ARCHIVED"] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];

export const ASSET_KINDS = [
  "SOFTWARE_COMPONENT",
  "APPLICATION",
  "SERVICE",
  "API",
  "DEVICE",
  "FIRMWARE",
  "HARDWARE",
  "HOST_SYSTEM",
  "CLOUD_RESOURCE",
  "NETWORK_SERVICE",
  "REPOSITORY",
  "CONTAINER_IMAGE",
] as const;

export type AssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_IDENTIFIER_SCHEMES = [
  "CPE23",
  "PURL",
  "SWID",
  "REPOSITORY_URL",
  "VENDOR_PRODUCT",
  "MODEL",
  "SERIAL",
  "CUSTOM",
] as const;

export type AssetIdentifierScheme = (typeof ASSET_IDENTIFIER_SCHEMES)[number];

export const ASSET_RELATIONSHIPS = [
  "CONTAINS",
  "DEPENDS_ON",
  "RUNS_ON",
  "EXPOSES",
  "DEPLOYS_AS",
  "FIRMWARE_FOR",
  "BUILT_FROM",
  "RELATED_TO",
] as const;

export type AssetRelationship = (typeof ASSET_RELATIONSHIPS)[number];

export const ARTIFACT_KINDS = [
  "SCREENSHOT",
  "IMAGE",
  "HTTP_CAPTURE",
  "HAR",
  "PCAP",
  "SOURCE_CODE",
  "BINARY",
  "FIRMWARE",
  "DOCUMENT",
  "POC",
  "ARCHIVE",
  "LOG",
  "TERMINAL_OUTPUT",
  "VIDEO",
  "OTHER",
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const POC_STATUSES = ["DRAFT", "VERIFIED", "FAILED", "RETIRED"] as const;

export type PocStatus = (typeof POC_STATUSES)[number];

export const REVIEW_STATES = [
  "NOT_WRITTEN",
  "AI_DRAFT",
  "RESEARCHER_EDITED",
  "NEEDS_REVIEW",
  "APPROVED",
  "LOCKED",
] as const;

export type ReviewState = (typeof REVIEW_STATES)[number];

export const DISCLOSURE_EVENT_TYPES = [
  "DISCOVERED",
  "REPRODUCED",
  "PEER_REVIEWED",
  "VENDOR_CONTACTED",
  "VENDOR_ACKNOWLEDGED",
  "DETAILS_SENT",
  "POC_SENT",
  "PATCH_RECEIVED",
  "PATCH_VERIFIED",
  "CVE_REQUESTED",
  "CVE_RESERVED",
  "PUBLICATION_SCHEDULED",
  "PUBLISHED",
  "CUSTOM",
] as const;

export type DisclosureEventType = (typeof DISCLOSURE_EVENT_TYPES)[number];

export const CLAIM_SOURCE_TYPES = [
  "EVIDENCE",
  "EXTERNAL",
  "HUMAN",
  "AI_PROPOSAL",
] as const;

export type ClaimSourceType = (typeof CLAIM_SOURCE_TYPES)[number];

export const CONFIDENCE_LEVELS = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "AUTHORITATIVE",
] as const;

export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const AFFECTED_RANGE_KINDS = [
  "EXACT_VERSION",
  "SEMVER_RANGE",
  "VENDOR_EXPRESSION",
] as const;

export type AffectedRangeKind = (typeof AFFECTED_RANGE_KINDS)[number];

export const AFFECTED_STATUSES = [
  "CONFIRMED_VULNERABLE",
  "INFERRED_AFFECTED",
  "CONFIRMED_FIXED",
  "CONFIRMED_NOT_VULNERABLE",
  "UNKNOWN",
] as const;

export type AffectedStatus = (typeof AFFECTED_STATUSES)[number];

/**
 * Prior-art conclusions a human must own.
 *
 * AI may argue for any of them, but the platform refuses to let a provider
 * write them: "we found nothing" and "this is genuinely new" are claims a
 * researcher puts their name on.
 */
export const HUMAN_ONLY_PRIOR_ART_STATES: readonly PriorArtState[] = [
  "HUMAN_CONFIRMED_NOVEL",
];

export function isHumanOnlyPriorArtState(state: PriorArtState): boolean {
  return HUMAN_ONLY_PRIOR_ART_STATES.includes(state);
}

/**
 * Validation transitions.
 *
 * Research is not a one-way pipeline — a CONFIRMED finding can be disputed and
 * a disputed one can be re-reproduced — so the graph is permissive but still
 * refuses nonsense such as resurrecting an INVALID finding straight to
 * CONFIRMED without re-reproducing it.
 */
const VALIDATION_TRANSITIONS: Record<ValidationState, ValidationState[]> = {
  DRAFT: ["REPRODUCED", "DISPUTED", "INVALID"],
  REPRODUCED: ["PEER_REVIEWED", "CONFIRMED", "DISPUTED", "INVALID", "DRAFT"],
  PEER_REVIEWED: ["CONFIRMED", "DISPUTED", "INVALID", "REPRODUCED"],
  CONFIRMED: ["DISPUTED", "INVALID", "PEER_REVIEWED"],
  DISPUTED: ["REPRODUCED", "PEER_REVIEWED", "CONFIRMED", "INVALID"],
  INVALID: ["DRAFT", "REPRODUCED"],
};

export function canTransitionValidation(
  from: ValidationState,
  to: ValidationState,
): boolean {
  if (from === to) {
    return true;
  }

  return VALIDATION_TRANSITIONS[from].includes(to);
}

/**
 * Disclosure transitions.
 *
 * PUBLIC is terminal: once details are out, the platform will not pretend they
 * can be pulled back into an embargo.
 */
const DISCLOSURE_TRANSITIONS: Record<DisclosureState, DisclosureState[]> = {
  PRIVATE: ["CONTACT_PREPARED", "VENDOR_CONTACTED", "PUBLIC"],
  CONTACT_PREPARED: ["VENDOR_CONTACTED", "PRIVATE", "PUBLIC"],
  VENDOR_CONTACTED: ["ACKNOWLEDGED", "COORDINATING", "EMBARGOED", "PUBLIC"],
  ACKNOWLEDGED: ["COORDINATING", "EMBARGOED", "PUBLIC"],
  COORDINATING: ["EMBARGOED", "PUBLIC", "ACKNOWLEDGED"],
  EMBARGOED: ["COORDINATING", "PUBLIC"],
  PUBLIC: [],
};

export function canTransitionDisclosure(
  from: DisclosureState,
  to: DisclosureState,
): boolean {
  if (from === to) {
    return true;
  }

  return DISCLOSURE_TRANSITIONS[from].includes(to);
}

/**
 * Section review transitions.
 *
 * LOCKED sections only reopen through an explicit unlock, which the API models
 * as LOCKED -> NEEDS_REVIEW rather than a silent edit.
 */
const REVIEW_TRANSITIONS: Record<ReviewState, ReviewState[]> = {
  NOT_WRITTEN: ["AI_DRAFT", "RESEARCHER_EDITED"],
  AI_DRAFT: ["RESEARCHER_EDITED", "NEEDS_REVIEW", "NOT_WRITTEN"],
  RESEARCHER_EDITED: ["NEEDS_REVIEW", "APPROVED", "AI_DRAFT"],
  NEEDS_REVIEW: ["RESEARCHER_EDITED", "APPROVED", "AI_DRAFT"],
  APPROVED: ["NEEDS_REVIEW", "RESEARCHER_EDITED", "LOCKED"],
  LOCKED: ["NEEDS_REVIEW"],
};

export function canTransitionReview(
  from: ReviewState,
  to: ReviewState,
): boolean {
  if (from === to) {
    return true;
  }

  return REVIEW_TRANSITIONS[from].includes(to);
}

/** Sections whose content is frozen against ordinary edits. */
export function isSectionEditable(state: ReviewState): boolean {
  return state !== "LOCKED";
}
