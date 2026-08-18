import {
  Type,
  type Static,
  type TLiteral,
  type TSchema,
  type TUnion,
} from "@sinclair/typebox";

import { SEVERITY_RATINGS, TLP_LABELS } from "@codevault/standards";

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
  COORDINATION_STATES,
  CRYPTO_MODES,
  DISCLOSURE_EVENT_TYPES,
  DISCLOSURE_STATES,
  ERROR_CATEGORIES,
  ENCRYPTION_POLICIES,
  EXTERNAL_ID_STATES,
  POC_STATUSES,
  MESSAGE_CLASSIFICATIONS,
  PRIOR_ART_STATES,
  REMEDIATION_STATES,
  REPORT_AUDIENCES,
  REVIEW_STATES,
  USER_ROLES,
  SUBMISSION_STATUSES,
  VALIDATION_STATES,
  VENDOR_ROUTE_TYPES,
} from "@codevault/core";

/**
 * Shared schema primitives.
 *
 * Every request and response the server accepts or returns is described here or
 * in a sibling module, and the desktop client imports the same types. There is
 * exactly one definition of an API shape in the repository.
 */

/**
 * A union of string literals, one per entry of a constant tuple.
 *
 * The explicit return type is what makes the helper work. Inside a generic
 * function `values.map(...)` produces `TLiteral<A | B | C>[]`, which TypeBox
 * resolves to a bare `string` — silently disabling type checking on every field
 * that uses it. Naming the mapped tuple restores the per-index literals.
 */
type LiteralUnion<T extends readonly string[]> = TUnion<{
  -readonly [K in keyof T]: TLiteral<T[K] & string>;
}>;

function enumOf<const T extends readonly [string, ...string[]]>(
  values: T,
): LiteralUnion<T> {
  return Type.Union(
    values.map((value) => Type.Literal(value)),
  ) as LiteralUnion<T>;
}

export const Uuid = Type.String({
  format: "uuid",
  minLength: 36,
  maxLength: 36,
});

export const Timestamp = Type.String({ format: "date-time" });

export const HumanReference = Type.String({ minLength: 3, maxLength: 32 });

export const Sha256 = Type.String({ pattern: "^[0-9a-f]{64}$" });

export const ShortText = Type.String({ minLength: 1, maxLength: 200 });

/** Header-safe mailbox syntax; provider APIs perform final address validation. */
export const EmailAddress = Type.String({
  minLength: 3,
  maxLength: 320,
  pattern: "^[^\\s@\\r\\n]+@[^\\s@\\r\\n]+\\.[^\\s@\\r\\n]+$",
});

export const HttpsUrl = Type.String({
  minLength: 9,
  maxLength: 2_048,
  pattern: "^https://[^\\s\\r\\n]+$",
});

export const MailSubject = Type.String({
  maxLength: 300,
  pattern: "^[^\\r\\n]*$",
});

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
export const VendorRouteTypeSchema = enumOf(VENDOR_ROUTE_TYPES);
export const EncryptionPolicySchema = enumOf(ENCRYPTION_POLICIES);
export const CryptoModeSchema = enumOf(CRYPTO_MODES);
export const SubmissionStatusSchema = enumOf(SUBMISSION_STATUSES);
export const CoordinationStateSchema = enumOf(COORDINATION_STATES);
export const MessageClassificationSchema = enumOf(MESSAGE_CLASSIFICATIONS);

export const TlpLabelSchema = enumOf(TLP_LABELS);

export const SeveritySchema = enumOf(SEVERITY_RATINGS);

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

export { enumOf };

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
