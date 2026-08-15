import type { NormalizedIdentity } from "./normalize.js";

/**
 * Prior-art provider contract.
 *
 * Providers are pure lookups: they take a query and return records. They never
 * decide whether a finding is novel, and they never write to the database — the
 * worker stores their output verbatim alongside the query that produced it so a
 * researcher can audit the check months later.
 */

export interface PriorArtQuery {
  identity: NormalizedIdentity;
  /** Finding title, used for text search against advisory titles. */
  title: string;
  /** CWE identifiers already assigned to the finding, e.g. `CWE-89`. */
  cweIds: readonly string[];
  /** Known CVE identifiers, when the finding already has one. */
  cveIds: readonly string[];
  /** Free-text technical keywords such as an endpoint or function name. */
  keywords: readonly string[];
  /** Upper bound on results per provider. */
  limit: number;
}

export interface PriorArtProviderResult {
  /** Provider identifier, e.g. `NVD`. */
  provider: string;
  /** Provider-scoped identifier, e.g. `CVE-2024-1234` or `GHSA-xxxx`. */
  externalId: string;
  title: string;
  url: string;
  publisher: string | null;
  publishedAt: string | null;
  /** Affected product identity as the provider reported it. */
  affectedIdentity: string | null;
  /** Short normalized summary, truncated by the provider adapter. */
  summary: string;
  /** The exact query string sent, recorded for auditability. */
  query: string;
  retrievedAt: string;
  /** Deterministic 0-1 score from local comparison, not a provider ranking. */
  localSimilarity: number;
}

export interface PriorArtProvider {
  id: string;
  displayName: string;
  /** Whether this provider can act on the given query at all. */
  supports(query: PriorArtQuery): boolean;
  search(query: PriorArtQuery): Promise<PriorArtProviderResult[]>;
}

export const PRIOR_ART_CONCLUSIONS = [
  "NO_OBVIOUS_MATCH",
  "POSSIBLE_MATCH",
  "LIKELY_SAME_ROOT_CAUSE",
  "LIKELY_DIFFERENT",
] as const;

export type PriorArtConclusion = (typeof PRIOR_ART_CONCLUSIONS)[number];

export const PRIOR_ART_MATCH_RELATIONSHIPS = [
  "SAME",
  "RELATED",
  "DIFFERENT",
] as const;

export type PriorArtMatchRelationship =
  (typeof PRIOR_ART_MATCH_RELATIONSHIPS)[number];

/** Structured AI output. Advisory only: a human still records the conclusion. */
export interface PriorArtAnalysis {
  conclusion: PriorArtConclusion;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  reasoning: string;
  matches: Array<{
    matchId: string;
    relationship: PriorArtMatchRelationship;
    reasoning: string;
  }>;
  missingChecks: string[];
}

export const PRIOR_ART_CHECK_STATUSES = [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
] as const;

export type PriorArtCheckStatus = (typeof PRIOR_ART_CHECK_STATUSES)[number];
