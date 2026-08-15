import { and, eq, sql } from "drizzle-orm";

import { validationError } from "@codevault/core";
import type { Database } from "@codevault/db";
import { schema } from "@codevault/db";
import {
  calculateCvss31,
  calculateCvss40,
  Cvss31VectorError,
  CvssVectorError,
  isCalculableScheme,
  isIntelligenceScheme,
  severityFromScore,
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
  score: number;
  severity: SeverityRating;
  metrics: Record<string, unknown>;
}

export function isKnownScheme(scheme: string): scheme is ScoreScheme {
  return (
    scheme === "CVSS40" ||
    scheme === "CVSS31" ||
    scheme === "EPSS" ||
    scheme === "KEV" ||
    scheme === "SSVC" ||
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
  } catch (error: unknown) {
    if (
      error instanceof CvssVectorError ||
      error instanceof Cvss31VectorError
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
    if (submission.score === undefined && scheme === "EPSS") {
      throw validationError("EPSS requires a probability value.");
    }

    if (submission.sourceName === undefined) {
      throw validationError(
        `${scheme} is retrieved intelligence and must name its source.`,
      );
    }

    return {
      scheme,
      vector: null,
      score: submission.score ?? null,
      // EPSS is a probability and KEV is a boolean fact; neither maps onto a
      // CVSS severity band, and pretending otherwise would invite exactly the
      // blended risk number CodeVault refuses to invent.
      severity: null,
      metrics: submission.metrics ?? {},
      sourceName: submission.sourceName,
    };
  }

  return {
    scheme,
    vector: submission.vector ?? null,
    score: submission.score ?? null,
    severity:
      submission.score === undefined
        ? null
        : severityFromScore(submission.score),
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
    .where(eq(schema.findingScores.id, scoreId))
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
    .where(eq(schema.findingScores.id, scoreId));

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
