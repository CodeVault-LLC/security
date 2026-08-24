import { and, eq, sql } from "drizzle-orm";

import { validationError } from "@codevault/core";
import type { Database } from "@codevault/db";
import { schema } from "@codevault/db";
import {
  calculateCwss10,
  calculateCvss31,
  calculateCvss40,
  calculateOwaspRisk,
  calculateSsvcCoordinatorPublish,
  Cwss10VectorError,
  Cvss31VectorError,
  CvssVectorError,
  isCalculableScheme,
  isIntelligenceScheme,
  OwaspRiskVectorError,
  SsvcVectorError,
  type ScoreScheme,
  type SeverityRating,
} from "@codevault/standards";

/**
 * Scoring.
 *
 * The rule that matters: for CVSS the server computes the number from the
 * vector with the deterministic implementation. A client — human or AI — may
 * propose metrics, never a score. An AI that "thinks it is a 9.8" has no way to
 * make it a 9.8.
 */

export interface ComputedScore {
  vector: string;
  score: number | null;
  severity: SeverityRating | null;
  metrics: Record<string, unknown>;
}

export function isKnownScheme(scheme: string): scheme is ScoreScheme {
  return (
    scheme === "CVSS40" ||
    scheme === "CVSS31" ||
    scheme === "CWSS10" ||
    scheme === "OWASP_RR" ||
    scheme === "EPSS" ||
    scheme === "KEV" ||
    scheme === "SSVC" ||
    scheme === "EVSS" ||
    scheme === "CUSTOM"
  );
}

/**
 * Computes a score from a vector.
 *
 * A malformed vector is a validation failure, not a server error: the string
 * came from a client, and the researcher needs to be told which metric is
 * wrong rather than seeing "something went wrong".
 */
export function computeScore(
  scheme: ScoreScheme,
  vector: string,
): ComputedScore {
  try {
    if (scheme === "CVSS40") {
      const result = calculateCvss40(vector);

      return {
        vector: result.vector,
        score: result.score,
        severity: result.severity,
        metrics: { ...result.metrics, macroVector: result.macroVector },
      };
    }

    if (scheme === "CVSS31") {
      const result = calculateCvss31(vector);

      return {
        vector: result.vector,
        score: result.score,
        severity: result.severity,
        metrics: {
          ...result.metrics,
          baseScore: result.baseScore,
          temporalScore: result.temporalScore,
          environmentalScore: result.environmentalScore,
        },
      };
    }

    if (scheme === "CWSS10") {
      const result = calculateCwss10(vector);

      return {
        vector: result.vector,
        score: result.score,
        severity: null,
        metrics: {
          ...result.metrics,
          weights: result.weights,
          baseFindingScore: result.baseFindingScore,
          attackSurfaceScore: result.attackSurfaceScore,
          environmentalScore: result.environmentalScore,
          scale: 100,
        },
      };
    }

    if (scheme === "OWASP_RR") {
      const result = calculateOwaspRisk(vector);

      return {
        vector: result.vector,
        score: null,
        severity: null,
        metrics: {
          ...result.metrics,
          rating: result.rating,
          likelihood: result.likelihood,
          technicalImpact: result.technicalImpact,
          businessImpact: result.businessImpact,
          selectedImpact: result.selectedImpact,
          impactBasis: result.impactBasis,
        },
      };
    }

    if (scheme === "SSVC") {
      const result = calculateSsvcCoordinatorPublish(vector);

      return {
        vector: result.vector,
        score: null,
        severity: null,
        metrics: { ...result.metrics, decision: result.decision },
      };
    }
  } catch (error: unknown) {
    if (
      error instanceof CvssVectorError ||
      error instanceof Cvss31VectorError ||
      error instanceof Cwss10VectorError ||
      error instanceof OwaspRiskVectorError ||
      error instanceof SsvcVectorError
    ) {
      throw validationError(error.message, {
        ...(error.metric === undefined ? {} : { metric: error.metric }),
      });
    }

    throw error;
  }

  throw validationError(`Scheme "${scheme}" has no deterministic calculation.`);
}

export interface ScoreSubmission {
  scheme: string;
  vector?: string | undefined;
  score?: number | undefined;
  metrics?: Record<string, unknown> | undefined;
  sourceName?: string | undefined;
}

export interface NormalisedScore {
  scheme: ScoreScheme;
  vector: string | null;
  score: number | null;
  severity: SeverityRating | null;
  metrics: Record<string, unknown>;
  sourceName: string | null;
}

/**
 * Validates a submitted score and derives everything derivable.
 *
 * Calculable schemes must supply a vector and may not supply a score.
 * Intelligence schemes are the reverse: a retrieved value with a named source.
 */
export function normaliseScoreSubmission(
  submission: ScoreSubmission,
): NormalisedScore {
  if (!isKnownScheme(submission.scheme)) {
    throw validationError(`Unknown score scheme "${submission.scheme}".`);
  }

  const scheme = submission.scheme;

  if (isCalculableScheme(scheme)) {
    if (submission.vector === undefined) {
      throw validationError(`${scheme} requires a vector string.`);
    }

    if (submission.score !== undefined) {
      throw validationError(
        `${scheme} scores are computed from the vector and cannot be supplied.`,
      );
    }

    const computed = computeScore(scheme, submission.vector);

    return {
      scheme,
      vector: computed.vector,
      score: computed.score,
      severity: computed.severity,
      metrics: computed.metrics,
      sourceName: submission.sourceName ?? null,
    };
  }

  if (isIntelligenceScheme(scheme)) {
    const sourceName = submission.sourceName?.trim();

    if (submission.score === undefined && scheme === "EPSS") {
      throw validationError("EPSS requires a probability value.");
    }

    if (submission.score === undefined && scheme === "EVSS") {
      throw validationError("EVSS requires a score from Edgescan.");
    }

    if (sourceName === undefined || sourceName.length === 0) {
      throw validationError(
        `${scheme} is retrieved intelligence and must name its source.`,
      );
    }

    if (
      submission.score !== undefined &&
      (!Number.isFinite(submission.score) ||
        submission.score < 0 ||
        (scheme === "EPSS" && submission.score > 1) ||
        (scheme === "KEV" &&
          submission.score !== 0 &&
          submission.score !== 1) ||
        (scheme === "EVSS" && submission.score > 10))
    ) {
      const range =
        scheme === "EPSS" ? "0 to 1" : scheme === "KEV" ? "0 or 1" : "0 to 10";
      throw validationError(`${scheme} values must be ${range}.`);
    }

    return {
      scheme,
      vector: null,
      score: submission.score ?? null,
      // These values use different meanings and scales. None maps onto a CVSS
      // severity band or contributes to the finding's headline CVSS score.
      severity: null,
      metrics: submission.metrics ?? {},
      sourceName,
    };
  }

  return {
    scheme,
    vector: submission.vector ?? null,
    score: submission.score ?? null,
    // A custom numeric value has no authority to use CVSS qualitative bands.
    severity: null,
    metrics: submission.metrics ?? {},
    sourceName: submission.sourceName ?? null,
  };
}

/**
 * Approves a score, superseding any previous approval for the same scheme, and
 * refreshes the finding's denormalised headline severity.
 *
 * CVSS 4.0 wins over 3.1 for the headline because it is the newer standard and
 * the one a modern advisory leads with; both remain stored and displayed.
 */
export async function approveScore(
  tx: Database,
  findingId: string,
  scoreId: string,
  reviewerId: string,
): Promise<void> {
  const rows = await tx
    .select()
    .from(schema.findingScores)
    .where(
      and(
        eq(schema.findingScores.id, scoreId),
        eq(schema.findingScores.findingId, findingId),
      ),
    )
    .limit(1);

  const score = rows[0];

  if (score === undefined) {
    throw validationError("That score record no longer exists.");
  }

  await tx
    .update(schema.findingScores)
    .set({ reviewState: "SUPERSEDED" })
    .where(
      and(
        eq(schema.findingScores.findingId, findingId),
        eq(schema.findingScores.scheme, score.scheme),
        eq(schema.findingScores.reviewState, "APPROVED"),
      ),
    );

  await tx
    .update(schema.findingScores)
    .set({
      reviewState: "APPROVED",
      reviewedBy: reviewerId,
      reviewedAt: sql`now()`,
    })
    .where(
      and(
        eq(schema.findingScores.id, scoreId),
        eq(schema.findingScores.findingId, findingId),
      ),
    );

  await refreshHeadlineSeverity(tx, findingId);
}

export async function refreshHeadlineSeverity(
  tx: Database,
  findingId: string,
): Promise<void> {
  const approved = await tx
    .select({
      scheme: schema.findingScores.scheme,
      score: schema.findingScores.score,
      severity: schema.findingScores.severity,
    })
    .from(schema.findingScores)
    .where(
      and(
        eq(schema.findingScores.findingId, findingId),
        eq(schema.findingScores.reviewState, "APPROVED"),
      ),
    );

  const headline =
    approved.find((row) => row.scheme === "CVSS40") ??
    approved.find((row) => row.scheme === "CVSS31") ??
    null;

  await tx
    .update(schema.findings)
    .set({
      severity: headline?.severity ?? null,
      score: headline?.score ?? null,
      updatedAt: sql`now()`,
    })
    .where(eq(schema.findings.id, findingId));
}
