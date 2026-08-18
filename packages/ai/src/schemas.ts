import { Type, type Static } from "@sinclair/typebox";

/**
 * Structured AI output schemas.
 *
 * Every action declares exactly what shape it expects back. Provider output is
 * validated against this before a proposal exists, so a model that returns
 * prose, invents a field or hallucinates a numeric score produces a failed run
 * rather than a plausible-looking edit.
 */

/** Common to every drafting action: prose plus the evidence it leaned on. */
export const DraftTextOutput = Type.Object({
  markdown: Type.String({ minLength: 1, maxLength: 50_000 }),
  /** Evidence, claim or reference identifiers the draft relies on. */
  sourceIds: Type.Array(Type.String({ maxLength: 100 }), { maxItems: 50 }),
  /** Statements the model could not support from the supplied context. */
  uncertainties: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 20 }),
  rationale: Type.String({ maxLength: 5_000 }),
});

export type DraftTextOutput = Static<typeof DraftTextOutput>;

export const DraftTitleOutput = Type.Object({
  title: Type.String({ minLength: 8, maxLength: 200 }),
  alternatives: Type.Array(Type.String({ maxLength: 200 }), { maxItems: 4 }),
  rationale: Type.String({ maxLength: 2_000 }),
});

export type DraftTitleOutput = Static<typeof DraftTitleOutput>;

export const CweSuggestionOutput = Type.Object({
  candidates: Type.Array(
    Type.Object({
      cweId: Type.String({ pattern: "^CWE-[0-9]{1,5}$" }),
      name: Type.String({ maxLength: 200 }),
      confidence: Type.Union([
        Type.Literal("LOW"),
        Type.Literal("MEDIUM"),
        Type.Literal("HIGH"),
      ]),
      reasoning: Type.String({ maxLength: 2_000 }),
    }),
    { minItems: 1, maxItems: 5 },
  ),
  rationale: Type.String({ maxLength: 5_000 }),
});

export type CweSuggestionOutput = Static<typeof CweSuggestionOutput>;

/**
 * CVSS suggestion.
 *
 * The model returns metrics and the reasoning for each one. It does not return
 * a score, and the schema gives it nowhere to put one: the number comes from
 * CodeVault's deterministic implementation once a human approves the metrics.
 */
export const CvssSuggestionOutput = Type.Object({
  metrics: Type.Array(
    Type.Object({
      metric: Type.String({ maxLength: 8 }),
      value: Type.String({ maxLength: 8 }),
      confidence: Type.Union([
        Type.Literal("LOW"),
        Type.Literal("MEDIUM"),
        Type.Literal("HIGH"),
      ]),
      reasoning: Type.String({ maxLength: 1_500 }),
      /** Evidence identifiers supporting this specific metric choice. */
      sourceIds: Type.Array(Type.String({ maxLength: 100 }), { maxItems: 10 }),
    }),
    { minItems: 1, maxItems: 40 },
  ),
  /** Metrics the model could not justify from the context it was given. */
  unknownMetrics: Type.Array(Type.String({ maxLength: 8 }), { maxItems: 40 }),
  rationale: Type.String({ maxLength: 8_000 }),
});

export type CvssSuggestionOutput = Static<typeof CvssSuggestionOutput>;

export const FACT_CHECK_VERDICTS = [
  "VERIFIED_BY_EVIDENCE",
  "SUPPORTED_BY_EXTERNAL_SOURCE",
  "CONFLICTING_SOURCES",
  "UNSUPPORTED_CLAIM",
  "STALE_SOURCE",
  "NEEDS_RESEARCHER_VERIFICATION",
] as const;

export const FactCheckOutput = Type.Object({
  statements: Type.Array(
    Type.Object({
      statement: Type.String({ maxLength: 1_000 }),
      verdict: Type.Union(
        FACT_CHECK_VERDICTS.map((verdict) => Type.Literal(verdict)),
      ),
      /** Evidence, claim or reference identifiers backing the verdict. */
      sourceIds: Type.Array(Type.String({ maxLength: 100 }), { maxItems: 10 }),
      explanation: Type.String({ maxLength: 2_000 }),
      /** Section or field the statement was taken from. */
      location: Type.String({ maxLength: 120 }),
    }),
    { maxItems: 60 },
  ),
  rationale: Type.String({ maxLength: 5_000 }),
});

export type FactCheckOutput = Static<typeof FactCheckOutput>;

export const PriorArtSynthesisOutput = Type.Object({
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
      matchId: Type.String({ maxLength: 100 }),
      relationship: Type.Union([
        Type.Literal("SAME"),
        Type.Literal("RELATED"),
        Type.Literal("DIFFERENT"),
      ]),
      reasoning: Type.String({ maxLength: 5_000 }),
    }),
    { maxItems: 50 },
  ),
  /** Sources or queries the model believes were not covered. */
  missingChecks: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 20 }),
});

export type PriorArtSynthesisOutput = Static<typeof PriorArtSynthesisOutput>;

export const AffectedVersionReviewOutput = Type.Object({
  assumptions: Type.Array(
    Type.Object({
      statement: Type.String({ maxLength: 500 }),
      tested: Type.Boolean(),
      risk: Type.Union([
        Type.Literal("LOW"),
        Type.Literal("MEDIUM"),
        Type.Literal("HIGH"),
      ]),
      suggestedCheck: Type.String({ maxLength: 500 }),
    }),
    { maxItems: 30 },
  ),
  rationale: Type.String({ maxLength: 5_000 }),
});

export type AffectedVersionReviewOutput = Static<
  typeof AffectedVersionReviewOutput
>;

export const ConsistencyReviewOutput = Type.Object({
  issues: Type.Array(
    Type.Object({
      severity: Type.Union([
        Type.Literal("INFO"),
        Type.Literal("WARNING"),
        Type.Literal("ERROR"),
      ]),
      sectionKey: Type.String({ maxLength: 80 }),
      description: Type.String({ maxLength: 2_000 }),
      /** What the canonical record says, when the report disagrees with it. */
      canonicalValue: Type.String({ maxLength: 500 }),
      reportedValue: Type.String({ maxLength: 500 }),
    }),
    { maxItems: 60 },
  ),
  rationale: Type.String({ maxLength: 5_000 }),
});

export type ConsistencyReviewOutput = Static<typeof ConsistencyReviewOutput>;

export const LeakReviewOutput = Type.Object({
  concerns: Type.Array(
    Type.Object({
      sectionKey: Type.String({ maxLength: 80 }),
      excerpt: Type.String({ maxLength: 500 }),
      concern: Type.String({ maxLength: 1_000 }),
      severity: Type.Union([
        Type.Literal("INFO"),
        Type.Literal("WARNING"),
        Type.Literal("ERROR"),
      ]),
    }),
    { maxItems: 60 },
  ),
  rationale: Type.String({ maxLength: 5_000 }),
});

export type LeakReviewOutput = Static<typeof LeakReviewOutput>;

export const PolishSectionOutput = Type.Object({
  markdown: Type.String({ minLength: 1, maxLength: 50_000 }),
  /** Human-readable summary of each change, shown beside the diff. */
  changes: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 40 }),
  rationale: Type.String({ maxLength: 5_000 }),
});

export type PolishSectionOutput = Static<typeof PolishSectionOutput>;

const SubmissionSourceRefs = Type.Array(Type.String({ maxLength: 100 }), {
  maxItems: 50,
});

export const SubmissionInitialDraftOutput = Type.Object({
  subject: Type.String({
    minLength: 1,
    maxLength: 300,
    pattern: "^[^\\r\\n]*$",
  }),
  bodyMarkdown: Type.String({ minLength: 1, maxLength: 100_000 }),
  sourceRefs: SubmissionSourceRefs,
  rationale: Type.String({ maxLength: 5_000 }),
});
export type SubmissionInitialDraftOutput = Static<
  typeof SubmissionInitialDraftOutput
>;

export const SubmissionFollowUpDraftOutput = Type.Object({
  bodyMarkdown: Type.String({ minLength: 1, maxLength: 100_000 }),
  questions: Type.Array(Type.String({ maxLength: 1_000 }), { maxItems: 20 }),
  sourceRefs: SubmissionSourceRefs,
  rationale: Type.String({ maxLength: 5_000 }),
});
export type SubmissionFollowUpDraftOutput = Static<
  typeof SubmissionFollowUpDraftOutput
>;

const ReplyClassification = Type.Union(
  [
    "UNREVIEWED",
    "AUTO_REPLY",
    "ACKNOWLEDGEMENT",
    "REQUEST_FOR_INFORMATION",
    "STATUS_UPDATE",
    "FIX_AVAILABLE",
    "REJECTION",
    "OTHER",
  ].map((value) => Type.Literal(value)),
);

export const SubmissionReplyClassificationOutput = Type.Object({
  rankings: Type.Array(
    Type.Object({
      classification: ReplyClassification,
      confidence: Type.Union([
        Type.Literal("LOW"),
        Type.Literal("MEDIUM"),
        Type.Literal("HIGH"),
      ]),
      evidence: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 10 }),
    }),
    { minItems: 1, maxItems: 8 },
  ),
  rationale: Type.String({ maxLength: 5_000 }),
});
export type SubmissionReplyClassificationOutput = Static<
  typeof SubmissionReplyClassificationOutput
>;

export const SubmissionThreadSummaryOutput = Type.Object({
  datedFacts: Type.Array(
    Type.Object({
      date: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
      fact: Type.String({ maxLength: 1_000 }),
      sourceRefs: SubmissionSourceRefs,
    }),
    { maxItems: 100 },
  ),
  openQuestions: Type.Array(Type.String({ maxLength: 1_000 }), {
    maxItems: 50,
  }),
  rationale: Type.String({ maxLength: 5_000 }),
});
export type SubmissionThreadSummaryOutput = Static<
  typeof SubmissionThreadSummaryOutput
>;
