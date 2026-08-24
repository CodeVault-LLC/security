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
  if (!Number.isFinite(score) || score < 0 || score > 10) {
    throw new RangeError("A CVSS score must be a finite number from 0 to 10.");
  }

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

export function isSeverityRating(value: unknown): value is SeverityRating {
  return (
    typeof value === "string" &&
    (SEVERITY_RATINGS as readonly string[]).includes(value)
  );
}

/** Highest rating in a collection, or NONE when the collection is empty. */
export function highestSeverity(
  ratings: readonly SeverityRating[],
): SeverityRating {
  return ratings.reduce<SeverityRating>(
    (highest, rating) =>
      severityRank(rating) > severityRank(highest) ? rating : highest,
    "NONE",
  );
}
