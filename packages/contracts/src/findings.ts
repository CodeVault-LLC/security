import { Type, type Static } from "@sinclair/typebox";

import {
  ActorSummary,
  AffectedRangeKindSchema,
  AffectedStatusSchema,
  AssetKindSchema,
  ClaimSourceTypeSchema,
  ConfidenceLevelSchema,
  ContentVisibilitySchema,
  DisclosureStateSchema,
  ExternalIdStateSchema,
  ExternalIdSchemeSchema,
  HumanReference,
  Markdown,
  PaginationQuery,
  PriorArtStateSchema,
  RemediationStateSchema,
  RevisionField,
  SeveritySchema,
  ShortText,
  Timestamp,
  Uuid,
  ValidationStateSchema,
} from "./common.js";

/**
 * Finding contracts.
 *
 * The five lifecycle states are independent columns rather than one status, and
 * every narrative field is Markdown so it can flow into a report unchanged.
 */

export const FindingAsset = Type.Object({
  assetId: Uuid,
  assetRef: HumanReference,
  name: Type.String(),
  kind: AssetKindSchema,
  /** Exactly one asset per finding may be primary. */
  primary: Type.Boolean(),
});

export type FindingAsset = Static<typeof FindingAsset>;

export const AffectedRange = Type.Object({
  id: Uuid,
  assetId: Uuid,
  kind: AffectedRangeKindSchema,
  /** Exact version, semver range, or a vendor's own range expression. */
  expression: Type.String({ minLength: 1, maxLength: 300 }),
  status: AffectedStatusSchema,
  /** First release known to contain the fix, when one exists. */
  fixedIn: Type.Union([Type.String({ maxLength: 120 }), Type.Null()]),
  /** How the conclusion was reached: tested, inferred, vendor-stated. */
  evidenceNote: Type.Union([Type.String({ maxLength: 2_000 }), Type.Null()]),
  verifiedAt: Type.Union([Timestamp, Type.Null()]),
  createdAt: Timestamp,
});

export type AffectedRange = Static<typeof AffectedRange>;

export const FindingIdentifier = Type.Object({
  id: Uuid,
  scheme: Type.String({ maxLength: 40 }),
  value: Type.String({ maxLength: 200 }),
  url: Type.Union([Type.String(), Type.Null()]),
  createdAt: Timestamp,
});

export type FindingIdentifier = Static<typeof FindingIdentifier>;

export const FindingScore = Type.Object({
  id: Uuid,
  scheme: Type.String({ maxLength: 40 }),
  /** Vector string for calculable schemes; null for retrieved intelligence. */
  vector: Type.Union([Type.String({ maxLength: 400 }), Type.Null()]),
  score: Type.Union([Type.Number(), Type.Null()]),
  severity: Type.Union([SeveritySchema, Type.Null()]),
  metrics: Type.Record(Type.String(), Type.Unknown()),
  source: Type.Union([
    Type.Literal("HUMAN"),
    Type.Literal("AI_PROPOSAL"),
    Type.Literal("EXTERNAL"),
  ]),
  reasoningMarkdown: Type.Union([Markdown, Type.Null()]),
  reviewState: Type.Union([
    Type.Literal("PROPOSED"),
    Type.Literal("APPROVED"),
    Type.Literal("SUPERSEDED"),
  ]),
  reviewedBy: Type.Union([ActorSummary, Type.Null()]),
  reviewedAt: Type.Union([Timestamp, Type.Null()]),
  /** Provenance for retrieved intelligence such as EPSS or KEV. */
  sourceName: Type.Union([Type.String(), Type.Null()]),
  retrievedAt: Type.Union([Timestamp, Type.Null()]),
  createdAt: Timestamp,
});

export type FindingScore = Static<typeof FindingScore>;

export const Claim = Type.Object({
  id: Uuid,
  findingId: Uuid,
  key: Type.String({ maxLength: 120 }),
  statementMarkdown: Markdown,
  value: Type.Unknown(),
  sourceType: ClaimSourceTypeSchema,
  sourceRef: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
  confidence: ConfidenceLevelSchema,
  visibility: ContentVisibilitySchema,
  reviewedBy: Type.Union([ActorSummary, Type.Null()]),
  retrievedAt: Type.Union([Timestamp, Type.Null()]),
  expiresAt: Type.Union([Timestamp, Type.Null()]),
  createdAt: Timestamp,
});

export type Claim = Static<typeof Claim>;

export const ExternalReference = Type.Object({
  id: Uuid,
  ref: HumanReference,
  title: Type.String({ maxLength: 300 }),
  url: Type.String({ maxLength: 2_000 }),
  publisher: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
  publishedAt: Type.Union([Timestamp, Type.Null()]),
  retrievedAt: Type.Union([Timestamp, Type.Null()]),
  visibility: ContentVisibilitySchema,
  note: Type.Union([Type.String({ maxLength: 1_000 }), Type.Null()]),
  createdAt: Timestamp,
});

export type ExternalReference = Static<typeof ExternalReference>;

export const FindingSummary = Type.Object({
  id: Uuid,
  ref: HumanReference,
  caseId: Uuid,
  caseRef: HumanReference,
  title: Type.String(),
  summaryMarkdown: Type.Union([Markdown, Type.Null()]),
  validationState: ValidationStateSchema,
  remediationState: RemediationStateSchema,
  disclosureState: DisclosureStateSchema,
  externalIdState: ExternalIdStateSchema,
  priorArtState: PriorArtStateSchema,
  severity: Type.Union([SeveritySchema, Type.Null()]),
  score: Type.Union([Type.Number(), Type.Null()]),
  primaryAsset: Type.Union([FindingAsset, Type.Null()]),
  pendingProposalCount: Type.Integer({ minimum: 0 }),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  revision: RevisionField,
});

export type FindingSummary = Static<typeof FindingSummary>;

/** The narrative body of a finding; each field maps to a report section. */
export const FindingContent = Type.Object({
  summaryMarkdown: Type.Union([Markdown, Type.Null()]),
  technicalMarkdown: Type.Union([Markdown, Type.Null()]),
  preconditionsMarkdown: Type.Union([Markdown, Type.Null()]),
  attackPathMarkdown: Type.Union([Markdown, Type.Null()]),
  impactMarkdown: Type.Union([Markdown, Type.Null()]),
  reproductionMarkdown: Type.Union([Markdown, Type.Null()]),
  remediationMarkdown: Type.Union([Markdown, Type.Null()]),
  researcherNotesMarkdown: Type.Union([Markdown, Type.Null()]),
});

export type FindingContent = Static<typeof FindingContent>;

export const FindingDetail = Type.Object({
  ...FindingSummary.properties,
  ...FindingContent.properties,
  owner: ActorSummary,
  visibility: ContentVisibilitySchema,
  cweIds: Type.Array(Type.String({ maxLength: 20 })),
  assets: Type.Array(FindingAsset),
  affectedRanges: Type.Array(AffectedRange),
  identifiers: Type.Array(FindingIdentifier),
  scores: Type.Array(FindingScore),
  claims: Type.Array(Claim),
  references: Type.Array(ExternalReference),
});

export type FindingDetail = Static<typeof FindingDetail>;

/** Quick-create: five fields, three of them optional. */
export const CreateFindingRequest = Type.Object({
  caseId: Uuid,
  title: ShortText,
  summaryMarkdown: Type.Optional(Type.String({ maxLength: 5_000 })),
  primaryAssetId: Type.Optional(Uuid),
  /** Optional starting point; a real vector is approved later. */
  initialSeverity: Type.Optional(SeveritySchema),
});

export type CreateFindingRequest = Static<typeof CreateFindingRequest>;

export const UpdateFindingRequest = Type.Object({
  ...Type.Partial(FindingContent).properties,
  title: Type.Optional(ShortText),
  validationState: Type.Optional(ValidationStateSchema),
  remediationState: Type.Optional(RemediationStateSchema),
  disclosureState: Type.Optional(DisclosureStateSchema),
  externalIdState: Type.Optional(ExternalIdStateSchema),
  priorArtState: Type.Optional(PriorArtStateSchema),
  visibility: Type.Optional(ContentVisibilitySchema),
  cweIds: Type.Optional(Type.Array(Type.String({ maxLength: 20 }))),
  expectedRevision: RevisionField,
});

export type UpdateFindingRequest = Static<typeof UpdateFindingRequest>;

export const LinkFindingAssetRequest = Type.Object({
  assetId: Uuid,
  primary: Type.Optional(Type.Boolean()),
});

export type LinkFindingAssetRequest = Static<typeof LinkFindingAssetRequest>;

export const AddAffectedRangeRequest = Type.Object({
  assetId: Uuid,
  kind: AffectedRangeKindSchema,
  expression: Type.String({ minLength: 1, maxLength: 300 }),
  status: AffectedStatusSchema,
  fixedIn: Type.Optional(Type.String({ maxLength: 120 })),
  evidenceNote: Type.Optional(Type.String({ maxLength: 2_000 })),
  verifiedAt: Type.Optional(Timestamp),
});

export type AddAffectedRangeRequest = Static<typeof AddAffectedRangeRequest>;

/**
 * Score submission.
 *
 * The client sends a vector, never a score: the server recomputes the number
 * with the deterministic implementation so an AI proposal cannot invent one.
 */
export const AddFindingScoreRequest = Type.Object({
  scheme: Type.String({ maxLength: 40 }),
  vector: Type.Optional(Type.String({ maxLength: 400 })),
  /** Only accepted for retrieved intelligence schemes such as EPSS. */
  score: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
  metrics: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  reasoningMarkdown: Type.Optional(Markdown),
  sourceName: Type.Optional(Type.String({ maxLength: 200 })),
  approve: Type.Optional(Type.Boolean()),
});

export type AddFindingScoreRequest = Static<typeof AddFindingScoreRequest>;

export const AddFindingIdentifierRequest = Type.Object({
  scheme: ExternalIdSchemeSchema,
  value: Type.String({ minLength: 1, maxLength: 128 }),
});

export type AddFindingIdentifierRequest = Static<
  typeof AddFindingIdentifierRequest
>;

export const CreateClaimRequest = Type.Object({
  key: Type.String({ minLength: 1, maxLength: 120 }),
  statementMarkdown: Markdown,
  value: Type.Optional(Type.Unknown()),
  sourceType: ClaimSourceTypeSchema,
  sourceRef: Type.Optional(Type.String({ maxLength: 500 })),
  confidence: ConfidenceLevelSchema,
  visibility: ContentVisibilitySchema,
  retrievedAt: Type.Optional(Timestamp),
  expiresAt: Type.Optional(Timestamp),
});

export type CreateClaimRequest = Static<typeof CreateClaimRequest>;

export const CreateReferenceRequest = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 300 }),
  url: Type.String({ minLength: 1, maxLength: 2_000 }),
  publisher: Type.Optional(Type.String({ maxLength: 200 })),
  publishedAt: Type.Optional(Timestamp),
  visibility: ContentVisibilitySchema,
  note: Type.Optional(Type.String({ maxLength: 1_000 })),
});

export type CreateReferenceRequest = Static<typeof CreateReferenceRequest>;

export const ListFindingsQuery = Type.Object({
  ...PaginationQuery.properties,
  caseId: Type.Optional(Uuid),
  assetId: Type.Optional(Uuid),
  validationState: Type.Optional(ValidationStateSchema),
  remediationState: Type.Optional(RemediationStateSchema),
  disclosureState: Type.Optional(DisclosureStateSchema),
  priorArtState: Type.Optional(PriorArtStateSchema),
  severity: Type.Optional(SeveritySchema),
  query: Type.Optional(Type.String({ maxLength: 200 })),
});

export type ListFindingsQuery = Static<typeof ListFindingsQuery>;
