import { Type, type Static } from "@sinclair/typebox";

import {
  AssetKindSchema,
  DisclosureStateSchema,
  enumOf,
  ExternalIdStateSchema,
  HumanReference,
  PriorArtStateSchema,
  RemediationStateSchema,
  Timestamp,
  Uuid,
  ValidationStateSchema,
} from "./common.js";

/**
 * Metrics contracts.
 *
 * Quantity, kept honest. Every figure here is a count or a duration over rows
 * the caller can already read — nothing is combined into a derived risk number,
 * because multiplying a severity by an exploitability by a guess is how a
 * platform ends up asserting something none of its inputs said.
 *
 * Distributions report current totals; only trends and durations are windowed.
 * "How many findings are critical" is not a question about the last ninety days.
 */

export const METRIC_WINDOWS = ["30d", "90d", "365d", "all"] as const;

export type MetricWindow = (typeof METRIC_WINDOWS)[number];

export const MetricWindowSchema = enumOf(METRIC_WINDOWS);

/**
 * Trend granularity.
 *
 * Derived from the window rather than chosen by the caller, so a trend never
 * renders more points than a dashboard-sized card can draw legibly.
 */
export const METRIC_BUCKETS = ["day", "week", "month"] as const;

export type MetricBucket = (typeof METRIC_BUCKETS)[number];

export const MetricBucketSchema = enumOf(METRIC_BUCKETS);

export const MetricsQuery = Type.Object({
  window: Type.Optional(MetricWindowSchema),
});

export type MetricsQuery = Static<typeof MetricsQuery>;

/**
 * Severity counts.
 *
 * `unscored` is a first-class member rather than folded into `none`: a finding
 * nobody has scored and a finding scored as no-impact are different facts, and
 * collapsing them would overstate how much triage has actually happened.
 */
export const SeverityTotals = Type.Object({
  critical: Type.Integer({ minimum: 0 }),
  high: Type.Integer({ minimum: 0 }),
  medium: Type.Integer({ minimum: 0 }),
  low: Type.Integer({ minimum: 0 }),
  none: Type.Integer({ minimum: 0 }),
  unscored: Type.Integer({ minimum: 0 }),
});

export type SeverityTotals = Static<typeof SeverityTotals>;

/** One slice of a distribution: a state, and how many findings are in it. */
export const StateCount = Type.Object({
  state: Type.String({ maxLength: 40 }),
  count: Type.Integer({ minimum: 0 }),
});

export type StateCount = Static<typeof StateCount>;

export const ValidationCount = Type.Object({
  state: ValidationStateSchema,
  count: Type.Integer({ minimum: 0 }),
});

export const DisclosureCount = Type.Object({
  state: DisclosureStateSchema,
  count: Type.Integer({ minimum: 0 }),
});

export const PriorArtCount = Type.Object({
  state: PriorArtStateSchema,
  count: Type.Integer({ minimum: 0 }),
});

export const RemediationCount = Type.Object({
  state: RemediationStateSchema,
  count: Type.Integer({ minimum: 0 }),
});

export const ExternalIdCount = Type.Object({
  state: ExternalIdStateSchema,
  count: Type.Integer({ minimum: 0 }),
});

/**
 * One bucket of the intake trend.
 *
 * Buckets with no activity are present with zeroes rather than omitted. A
 * missing bucket makes a line chart lie by drawing straight across the gap.
 */
export const TrendPoint = Type.Object({
  bucketStart: Timestamp,
  opened: Type.Integer({ minimum: 0 }),
  published: Type.Integer({ minimum: 0 }),
});

export type TrendPoint = Static<typeof TrendPoint>;

export const DISCLOSURE_STAGES = [
  "DISCOVERY_TO_CONTACT",
  "CONTACT_TO_ACKNOWLEDGEMENT",
  "ACKNOWLEDGEMENT_TO_FIX",
] as const;

export type DisclosureStage = (typeof DISCLOSURE_STAGES)[number];

export const DisclosureStageSchema = enumOf(DISCLOSURE_STAGES);

/**
 * How long one stage of coordinated disclosure actually takes.
 *
 * `sampleSize` travels with the numbers and is never optional. A median over
 * two cases is a median over two cases, and a chart that hides that invites a
 * researcher to quote it in a report as though it were a rate.
 */
export const StageDuration = Type.Object({
  stage: DisclosureStageSchema,
  p50Days: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  p90Days: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  sampleSize: Type.Integer({ minimum: 0 }),
});

export type StageDuration = Static<typeof StageDuration>;

/**
 * A weakness class and its frequency.
 *
 * `cweId` is the raw identifier as recorded on the finding. The tail beyond the
 * top ten arrives as a single `Other` row rather than as more colours.
 */
export const CweCount = Type.Object({
  cweId: Type.String({ maxLength: 40 }),
  count: Type.Integer({ minimum: 0 }),
});

export type CweCount = Static<typeof CweCount>;

/** An asset with the findings recorded against it, broken down by severity. */
export const AssetFindingCount = Type.Object({
  assetId: Uuid,
  ref: HumanReference,
  name: Type.String(),
  kind: AssetKindSchema,
  total: Type.Integer({ minimum: 0 }),
  severity: SeverityTotals,
});

export type AssetFindingCount = Static<typeof AssetFindingCount>;

/**
 * Dashboard and Metrics headline figures.
 *
 * `medianAcknowledgementDays` is null when fewer than three cases carry both
 * ends of the contact/acknowledgement pair — the dashboard tile has no room to
 * print a sample size, so below that threshold it prints nothing at all.
 */
export const MetricTotals = Type.Object({
  findings: Type.Integer({ minimum: 0 }),
  confirmed: Type.Integer({ minimum: 0 }),
  published: Type.Integer({ minimum: 0 }),
  openCases: Type.Integer({ minimum: 0 }),
  criticalsUnfixed: Type.Integer({ minimum: 0 }),
  awaitingReview: Type.Integer({ minimum: 0 }),
  overdueVendorResponses: Type.Integer({ minimum: 0 }),
  medianAcknowledgementDays: Type.Union([
    Type.Number({ minimum: 0 }),
    Type.Null(),
  ]),
});

export type MetricTotals = Static<typeof MetricTotals>;

/** Counts of findings that carry the records needed for later research work. */
export const FindingCoverage = Type.Object({
  total: Type.Integer({ minimum: 0 }),
  scored: Type.Integer({ minimum: 0 }),
  weaknessClassified: Type.Integer({ minimum: 0 }),
  assetLinked: Type.Integer({ minimum: 0 }),
  evidenceLinked: Type.Integer({ minimum: 0 }),
  affectedRangeRecorded: Type.Integer({ minimum: 0 }),
  priorArtChecked: Type.Integer({ minimum: 0 }),
});

export type FindingCoverage = Static<typeof FindingCoverage>;

/** Age of unresolved, non-invalid findings, measured from creation time. */
export const FindingAge = Type.Object({
  under30Days: Type.Integer({ minimum: 0 }),
  from30To89Days: Type.Integer({ minimum: 0 }),
  from90To179Days: Type.Integer({ minimum: 0 }),
  atLeast180Days: Type.Integer({ minimum: 0 }),
});

export type FindingAge = Static<typeof FindingAge>;

export const MetricsResponse = Type.Object({
  window: MetricWindowSchema,
  bucket: MetricBucketSchema,
  totals: MetricTotals,
  severity: SeverityTotals,
  validation: Type.Array(ValidationCount),
  remediation: Type.Array(RemediationCount),
  disclosure: Type.Array(DisclosureCount),
  externalId: Type.Array(ExternalIdCount),
  priorArt: Type.Array(PriorArtCount),
  coverage: FindingCoverage,
  age: FindingAge,
  trend: Type.Array(TrendPoint),
  stages: Type.Array(StageDuration),
  cwe: Type.Array(CweCount),
  topAssets: Type.Array(AssetFindingCount),
  generatedAt: Timestamp,
});

export type MetricsResponse = Static<typeof MetricsResponse>;

/** Assets of one kind, and the findings recorded against them. */
export const AssetKindCount = Type.Object({
  kind: AssetKindSchema,
  assetCount: Type.Integer({ minimum: 0 }),
  findingCount: Type.Integer({ minimum: 0 }),
});

export type AssetKindCount = Static<typeof AssetKindCount>;

/**
 * Identifier coverage.
 *
 * Prior-art matching is far more accurate against a PURL or CPE than against a
 * product name, so "how many assets carry one" is a piece of work rather than a
 * vanity figure.
 */
export const IdentifierCoverage = Type.Object({
  total: Type.Integer({ minimum: 0 }),
  withIdentifier: Type.Integer({ minimum: 0 }),
  withPrimary: Type.Integer({ minimum: 0 }),
});

export type IdentifierCoverage = Static<typeof IdentifierCoverage>;

export const AssetMetricsResponse = Type.Object({
  byKind: Type.Array(AssetKindCount),
  topAssets: Type.Array(AssetFindingCount),
  identifierCoverage: IdentifierCoverage,
  generatedAt: Timestamp,
});

export type AssetMetricsResponse = Static<typeof AssetMetricsResponse>;

/**
 * Affected-version verification.
 *
 * Pairs with the dashboard's `STALE_AFFECTED_VERSIONS` attention item, so the
 * alert and the asset page agree about what is unverified.
 */
export const AffectedRangeTotals = Type.Object({
  total: Type.Integer({ minimum: 0 }),
  verified: Type.Integer({ minimum: 0 }),
  inferredUnverified: Type.Integer({ minimum: 0 }),
});

export type AffectedRangeTotals = Static<typeof AffectedRangeTotals>;

export const AssetDetailMetricsResponse = Type.Object({
  bucket: MetricBucketSchema,
  total: Type.Integer({ minimum: 0 }),
  severity: SeverityTotals,
  trend: Type.Array(TrendPoint),
  affectedRanges: AffectedRangeTotals,
  generatedAt: Timestamp,
});

export type AssetDetailMetricsResponse = Static<
  typeof AssetDetailMetricsResponse
>;
