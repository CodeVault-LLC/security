import { Type, type Static, type TSchema } from "@sinclair/typebox";

import {
  AFFECTED_RANGE_KINDS,
  AFFECTED_STATUSES,
  ARTIFACT_KINDS,
  ASSET_IDENTIFIER_SCHEMES,
  ASSET_KINDS,
  ASSET_RELATIONSHIPS,
  CASE_PROFILES,
  CASE_STATUSES,
  CLAIM_SOURCE_TYPES,
  CONFIDENCE_LEVELS,
  CONTENT_VISIBILITIES,
  DISCLOSURE_EVENT_TYPES,
  DISCLOSURE_STATES,
  ERROR_CATEGORIES,
  EXTERNAL_ID_STATES,
  POC_STATUSES,
  PRIOR_ART_STATES,
  REMEDIATION_STATES,
  REPORT_AUDIENCES,
  REVIEW_STATES,
  USER_ROLES,
  VALIDATION_STATES,
} from "@codevault/core";

/**
 * Shared schema primitives.
 *
 * Every request and response the server accepts or returns is described here or
 * in a sibling module, and the desktop client imports the same types. There is
 * exactly one definition of an API shape in the repository.
 */

/** Turns a domain constant tuple into a TypeBox union without losing literals. */
function enumOf<T extends string>(values: readonly T[]) {
  return Type.Union(values.map((value) => Type.Literal(value)));
}

export const Uuid = Type.String({ format: "uuid", minLength: 36, maxLength: 36 });

export const Timestamp = Type.String({ format: "date-time" });

export const HumanReference = Type.String({ minLength: 3, maxLength: 32 });

export const Sha256 = Type.String({ pattern: "^[0-9a-f]{64}$" });

export const ShortText = Type.String({ minLength: 1, maxLength: 200 });

export const Markdown = Type.String({ maxLength: 200_000 });

export const UserRoleSchema = enumOf(USER_ROLES);
export const CaseProfileSchema = enumOf(CASE_PROFILES);
export const CaseStatusSchema = enumOf(CASE_STATUSES);
export const AssetKindSchema = enumOf(ASSET_KINDS);
export const AssetIdentifierSchemeSchema = enumOf(ASSET_IDENTIFIER_SCHEMES);
export const AssetRelationshipSchema = enumOf(ASSET_RELATIONSHIPS);
export const ValidationStateSchema = enumOf(VALIDATION_STATES);
export const RemediationStateSchema = enumOf(REMEDIATION_STATES);
export const DisclosureStateSchema = enumOf(DISCLOSURE_STATES);
export const ExternalIdStateSchema = enumOf(EXTERNAL_ID_STATES);
export const PriorArtStateSchema = enumOf(PRIOR_ART_STATES);
export const ContentVisibilitySchema = enumOf(CONTENT_VISIBILITIES);
export const ReportAudienceSchema = enumOf(REPORT_AUDIENCES);
export const ReviewStateSchema = enumOf(REVIEW_STATES);
export const ArtifactKindSchema = enumOf(ARTIFACT_KINDS);
export const PocStatusSchema = enumOf(POC_STATUSES);
export const ClaimSourceTypeSchema = enumOf(CLAIM_SOURCE_TYPES);
export const ConfidenceLevelSchema = enumOf(CONFIDENCE_LEVELS);
export const DisclosureEventTypeSchema = enumOf(DISCLOSURE_EVENT_TYPES);
export const AffectedRangeKindSchema = enumOf(AFFECTED_RANGE_KINDS);
export const AffectedStatusSchema = enumOf(AFFECTED_STATUSES);
export const ErrorCategorySchema = enumOf(ERROR_CATEGORIES);

export const TlpLabelSchema = Type.Union([
  Type.Literal("TLP:RED"),
  Type.Literal("TLP:AMBER+STRICT"),
  Type.Literal("TLP:AMBER"),
  Type.Literal("TLP:GREEN"),
  Type.Literal("TLP:CLEAR"),
]);

export const SeveritySchema = Type.Union([
  Type.Literal("NONE"),
  Type.Literal("LOW"),
  Type.Literal("MEDIUM"),
  Type.Literal("HIGH"),
  Type.Literal("CRITICAL"),
]);

/**
 * Error envelope.
 *
 * The API never returns a stack trace or a raw driver message; the client maps
 * `category` onto one of its user-facing error headings.
 */
export const ErrorResponse = Type.Object({
  error: Type.Object({
    category: ErrorCategorySchema,
    message: Type.String(),
    details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    requestId: Type.String(),
  }),
});

export type ErrorResponse = Static<typeof ErrorResponse>;

/** Cursor pagination, used everywhere a list can grow without bound. */
export const PaginationQuery = Type.Object({
  cursor: Type.Optional(Type.String({ maxLength: 200 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
});

export type PaginationQuery = Static<typeof PaginationQuery>;

export function PaginatedResponse<T extends TSchema>(item: T) {
  return Type.Object({
    items: Type.Array(item),
    nextCursor: Type.Union([Type.String(), Type.Null()]),
  });
}

export const IdParam = Type.Object({ id: Uuid });

export type IdParam = Static<typeof IdParam>;

export const OkResponse = Type.Object({ ok: Type.Literal(true) });

export type OkResponse = Static<typeof OkResponse>;

/** Optimistic-concurrency token carried by every mutable entity. */
export const RevisionField = Type.Integer({ minimum: 1 });

export const ActorSummary = Type.Object({
  id: Uuid,
  displayName: Type.String(),
  email: Type.String({ format: "email" }),
});

export type ActorSummary = Static<typeof ActorSummary>;
