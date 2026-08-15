import { Type, type Static } from "@sinclair/typebox";

import {
  ActorSummary,
  PriorArtStateSchema,
  Timestamp,
  Uuid,
} from "./common.js";

/**
 * Prior-art contracts.
 *
 * A check records what was searched, when, and what came back — so the answer
 * "no prior art found" always carries the evidence that it was actually looked
 * for, and can be re-run and compared later.
 */

export const PriorArtCheckStatusSchema = Type.Union([
  Type.Literal("QUEUED"),
  Type.Literal("RUNNING"),
  Type.Literal("COMPLETED"),
  Type.Literal("FAILED"),
]);

export const PriorArtMatch = Type.Object({
  id: Uuid,
  checkId: Uuid,
  origin: Type.Union([Type.Literal("INTERNAL"), Type.Literal("EXTERNAL")]),
  provider: Type.String(),
  externalId: Type.Union([Type.String(), Type.Null()]),
  /** Set when the match is another CodeVault finding. */
  findingId: Type.Union([Uuid, Type.Null()]),
  title: Type.String(),
  url: Type.Union([Type.String(), Type.Null()]),
  publisher: Type.Union([Type.String(), Type.Null()]),
  publishedAt: Type.Union([Timestamp, Type.Null()]),
  affectedIdentity: Type.Union([Type.String(), Type.Null()]),
  summary: Type.String(),
  /** The exact query that produced this result, kept for auditability. */
  query: Type.String(),
  retrievedAt: Timestamp,
  similarity: Type.Number({ minimum: 0, maximum: 1 }),
  /** Advisory AI verdict on this specific candidate, when AI ran. */
  aiRelationship: Type.Union([
    Type.Literal("SAME"),
    Type.Literal("RELATED"),
    Type.Literal("DIFFERENT"),
    Type.Null(),
  ]),
  aiReasoning: Type.Union([Type.String(), Type.Null()]),
});

export type PriorArtMatch = Static<typeof PriorArtMatch>;

export const PriorArtAnalysisSchema = Type.Object({
  conclusion: Type.Union([
    Type.Literal("NO_OBVIOUS_MATCH"),
    Type.Literal("POSSIBLE_MATCH"),
    Type.Literal("LIKELY_SAME_ROOT_CAUSE"),
    Type.Literal("LIKELY_DIFFERENT"),
  ]),
  confidence: Type.Union([
    Type.Literal("LOW"),
    Type.Literal("MEDIUM"),
    Type.Literal("HIGH"),
  ]),
  reasoning: Type.String({ maxLength: 20_000 }),
  matches: Type.Array(
    Type.Object({
      matchId: Type.String(),
      relationship: Type.Union([
        Type.Literal("SAME"),
        Type.Literal("RELATED"),
        Type.Literal("DIFFERENT"),
      ]),
      reasoning: Type.String({ maxLength: 5_000 }),
    }),
  ),
  missingChecks: Type.Array(Type.String({ maxLength: 500 })),
});

export type PriorArtAnalysis = Static<typeof PriorArtAnalysisSchema>;

export const PriorArtCheck = Type.Object({
  id: Uuid,
  findingId: Uuid,
  status: PriorArtCheckStatusSchema,
  /** Providers actually queried, including internal search. */
  sourcesChecked: Type.Array(
    Type.Object({
      provider: Type.String(),
      queries: Type.Array(Type.String()),
      resultCount: Type.Integer({ minimum: 0 }),
      error: Type.Union([Type.String(), Type.Null()]),
      retrievedAt: Type.Union([Timestamp, Type.Null()]),
    }),
  ),
  matches: Type.Array(PriorArtMatch),
  analysis: Type.Union([PriorArtAnalysisSchema, Type.Null()]),
  /** Human verdict; the only thing that changes the finding's state. */
  humanConclusion: Type.Union([PriorArtStateSchema, Type.Null()]),
  concludedBy: Type.Union([ActorSummary, Type.Null()]),
  concludedAt: Type.Union([Timestamp, Type.Null()]),
  startedBy: ActorSummary,
  startedAt: Timestamp,
  completedAt: Type.Union([Timestamp, Type.Null()]),
  failureReason: Type.Union([Type.String(), Type.Null()]),
});

export type PriorArtCheck = Static<typeof PriorArtCheck>;

export const StartPriorArtCheckRequest = Type.Object({
  /** Extra technical keywords such as an endpoint, parameter or symbol name. */
  keywords: Type.Optional(Type.Array(Type.String({ maxLength: 100 }))),
  /** Skips AI synthesis even when a provider is available. */
  skipAiSynthesis: Type.Optional(Type.Boolean()),
});

export type StartPriorArtCheckRequest = Static<
  typeof StartPriorArtCheckRequest
>;

export const ConcludePriorArtCheckRequest = Type.Object({
  conclusion: PriorArtStateSchema,
  note: Type.Optional(Type.String({ maxLength: 2_000 })),
});

export type ConcludePriorArtCheckRequest = Static<
  typeof ConcludePriorArtCheckRequest
>;

/** Difference between two checks of the same finding. */
export const PriorArtDiff = Type.Object({
  previousCheckId: Uuid,
  currentCheckId: Uuid,
  newMatches: Type.Array(PriorArtMatch),
  resolvedMatches: Type.Array(PriorArtMatch),
  unchangedCount: Type.Integer({ minimum: 0 }),
});

export type PriorArtDiff = Static<typeof PriorArtDiff>;
