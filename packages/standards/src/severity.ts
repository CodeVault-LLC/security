/**
 * Qualitative severity ratings.
 *
 * The bands are identical in CVSS v3.1 and v4.0, so a single mapping serves
 * both. Severity is always derived from a score, never entered by hand: it is a
 * presentation of the vector, not an independent opinion.
 */

export const SEVERITY_RATINGS = [
  "NONE",
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;

export type SeverityRating = (typeof SEVERITY_RATINGS)[number];

export function severityFromScore(score: number): SeverityRating {
  if (score <= 0) {
    return "NONE";
  }

  if (score < 4) {
    return "LOW";
  }

  if (score < 7) {
    return "MEDIUM";
  }

  if (score < 9) {
    return "HIGH";
  }

  return "CRITICAL";
}

/** Sort weight, highest severity first, for list ordering. */
export function severityRank(rating: SeverityRating): number {
  return SEVERITY_RATINGS.indexOf(rating);
}
