import { Type, type Static } from "@sinclair/typebox";

import {
  ActorSummary,
  EmailAddress,
  HttpsUrl,
  HumanReference,
  PaginationQuery,
  RevisionField,
  ShortText,
  Timestamp,
  Uuid,
} from "./common.js";

export const SUBMISSION_FIELD_KEYS = [
  "vulnerability_type",
  "affected_product",
  "affected_version",
  "environment",
  "configuration",
  "reproduction",
  "evidence",
  "impact",
  "remediation",
  "researcher_contact",
  "disclosure_expectations",
] as const;

const SubmissionFieldKeySchema = Type.Union(
  SUBMISSION_FIELD_KEYS.map((value) => Type.Literal(value)),
);

export type SubmissionFieldKey = (typeof SUBMISSION_FIELD_KEYS)[number];

const RouteProvenanceProperties = {
  sourceUrl: Type.Optional(Type.Union([HttpsUrl, Type.Null()])),
  sourceReviewedAt: Type.Optional(Type.Union([Timestamp, Type.Null()])),
};

const EmailRouteProperties = {
  name: ShortText,
  type: Type.Literal("EMAIL"),
  to: Type.Array(EmailAddress, {
    minItems: 1,
    maxItems: 10,
    uniqueItems: true,
  }),
  cc: Type.Array(EmailAddress, { maxItems: 10, uniqueItems: true }),
  subjectTemplate: Type.String({
    minLength: 1,
    maxLength: 300,
    pattern: "^[^\\r\\n]*$",
  }),
  maximumAttachmentBytes: Type.Integer({
    minimum: 0,
    maximum: 25 * 1024 * 1024,
  }),
  acknowledgementBusinessDays: Type.Integer({ minimum: 1, maximum: 90 }),
  updateCadenceDays: Type.Union([
    Type.Integer({ minimum: 1, maximum: 365 }),
    Type.Null(),
  ]),
  requiredFields: Type.Array(SubmissionFieldKeySchema, {
    maxItems: SUBMISSION_FIELD_KEYS.length,
    uniqueItems: true,
  }),
  ...RouteProvenanceProperties,
};

const RequiredEncryptionEmailRoute = Type.Object(
  {
    ...EmailRouteProperties,
    encryptionPolicy: Type.Literal("REQUIRED"),
    publicKeyId: Uuid,
  },
  { additionalProperties: false },
);

const NonRequiredEncryptionEmailRoute = Type.Object(
  {
    ...EmailRouteProperties,
    encryptionPolicy: Type.Union([
      Type.Literal("FORBIDDEN"),
      Type.Literal("OPTIONAL"),
    ]),
    publicKeyId: Type.Union([Uuid, Type.Null()]),
  },
  { additionalProperties: false },
);

/** Required encryption cannot be represented without a selected key version. */
export const EmailRouteRequirements = Type.Union([
  RequiredEncryptionEmailRoute,
  NonRequiredEncryptionEmailRoute,
]);

export type EmailRouteRequirements = Static<typeof EmailRouteRequirements>;

export const MANUAL_FIELD_FORMATS = [
  "TEXT",
  "MULTILINE_TEXT",
  "EMAIL",
  "URL",
  "DATE",
] as const;

const ManualFieldFormatSchema = Type.Union(
  MANUAL_FIELD_FORMATS.map((value) => Type.Literal(value)),
);

export const ManualFieldMapping = Type.Object(
  {
    key: Type.String({
      minLength: 1,
      maxLength: 80,
      pattern: "^[a-z][a-z0-9_]*$",
    }),
    label: Type.String({ minLength: 1, maxLength: 200 }),
    required: Type.Boolean(),
    format: ManualFieldFormatSchema,
    submissionField: Type.Union([SubmissionFieldKeySchema, Type.Null()]),
    helpText: Type.Union([Type.String({ maxLength: 1_000 }), Type.Null()]),
  },
  { additionalProperties: false },
);

export type ManualFieldMapping = Static<typeof ManualFieldMapping>;

export const ManualRouteRequirements = Type.Object(
  {
    name: ShortText,
    type: Type.Literal("MANUAL"),
    destinationUrl: HttpsUrl,
    fieldMappings: Type.Array(ManualFieldMapping, {
      minItems: 1,
      maxItems: 100,
    }),
    acceptedExtensions: Type.Array(
      Type.String({ pattern: "^\\.[a-z0-9]{1,16}$" }),
      { maxItems: 50, uniqueItems: true },
    ),
    maximumFileBytes: Type.Integer({
      minimum: 0,
      maximum: 250 * 1024 * 1024,
    }),
    maximumFileCount: Type.Integer({ minimum: 0, maximum: 100 }),
    acknowledgementBusinessDays: Type.Integer({ minimum: 1, maximum: 90 }),
    updateCadenceDays: Type.Union([
      Type.Integer({ minimum: 1, maximum: 365 }),
      Type.Null(),
    ]),
    instructions: Type.Union([Type.String({ maxLength: 20_000 }), Type.Null()]),
    ...RouteProvenanceProperties,
  },
  { additionalProperties: false },
);

export type ManualRouteRequirements = Static<typeof ManualRouteRequirements>;

export const CreateVendorRouteRequest = Type.Union([
  EmailRouteRequirements,
  ManualRouteRequirements,
]);

export type CreateVendorRouteRequest = Static<typeof CreateVendorRouteRequest>;

export const VendorSummary = Type.Object(
  {
    id: Uuid,
    ref: HumanReference,
    slug: Type.String({ pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }),
    name: Type.String(),
    websiteUrl: Type.Union([HttpsUrl, Type.Null()]),
    builtIn: Type.Boolean(),
    sourceUrl: Type.Union([HttpsUrl, Type.Null()]),
    sourceReviewedAt: Type.Union([Timestamp, Type.Null()]),
    archivedAt: Type.Union([Timestamp, Type.Null()]),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    revision: RevisionField,
  },
  { additionalProperties: false },
);

export type VendorSummary = Static<typeof VendorSummary>;

export const VendorPublicKey = Type.Object(
  {
    id: Uuid,
    vendorId: Uuid,
    armoredKey: Type.String({ minLength: 1, maxLength: 2_000_000 }),
    fingerprint: Type.String({ pattern: "^(?:[0-9A-F]{40}|[0-9A-F]{64})$" }),
    userIds: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 100 }),
    algorithm: Type.String({ maxLength: 100 }),
    createdAt: Timestamp,
    expiresAt: Type.Union([Timestamp, Type.Null()]),
    revokedAt: Type.Union([Timestamp, Type.Null()]),
    verifiedBy: Type.Union([ActorSummary, Type.Null()]),
    verifiedAt: Type.Union([Timestamp, Type.Null()]),
    sourceUrl: HttpsUrl,
    supersededById: Type.Union([Uuid, Type.Null()]),
    revision: RevisionField,
  },
  { additionalProperties: false },
);

export type VendorPublicKey = Static<typeof VendorPublicKey>;

const VendorRouteRecordProperties = {
  id: Uuid,
  vendorId: Uuid,
  active: Type.Boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  revision: RevisionField,
};

/**
 * Keep each route variant flat. Intersecting a strict object with a union makes
 * the union's `additionalProperties: false` reject the record metadata in
 * JSON-schema serializers even though TypeScript can represent the type.
 */
export const VendorRoute = Type.Union([
  Type.Object(
    {
      ...VendorRouteRecordProperties,
      ...RequiredEncryptionEmailRoute.properties,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...VendorRouteRecordProperties,
      ...NonRequiredEncryptionEmailRoute.properties,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...VendorRouteRecordProperties,
      ...ManualRouteRequirements.properties,
    },
    { additionalProperties: false },
  ),
]);

export type VendorRoute = Static<typeof VendorRoute>;

export const VendorDetail = Type.Object({
  ...VendorSummary.properties,
  routes: Type.Array(VendorRoute),
  publicKeys: Type.Array(VendorPublicKey),
  assetCount: Type.Integer({ minimum: 0 }),
});

export type VendorDetail = Static<typeof VendorDetail>;

export const CreateVendorRequest = Type.Object(
  {
    name: ShortText,
    websiteUrl: Type.Optional(Type.Union([HttpsUrl, Type.Null()])),
    sourceUrl: Type.Optional(Type.Union([HttpsUrl, Type.Null()])),
    sourceReviewedAt: Type.Optional(Type.Union([Timestamp, Type.Null()])),
  },
  { additionalProperties: false },
);

export type CreateVendorRequest = Static<typeof CreateVendorRequest>;

export const UpdateVendorRequest = Type.Object(
  {
    name: Type.Optional(ShortText),
    websiteUrl: Type.Optional(Type.Union([HttpsUrl, Type.Null()])),
    sourceUrl: Type.Optional(Type.Union([HttpsUrl, Type.Null()])),
    sourceReviewedAt: Type.Optional(Type.Union([Timestamp, Type.Null()])),
    archived: Type.Optional(Type.Boolean()),
    expectedRevision: RevisionField,
  },
  { additionalProperties: false },
);

export type UpdateVendorRequest = Static<typeof UpdateVendorRequest>;

export const UpdateVendorRouteRequest = Type.Object(
  {
    name: Type.Optional(ShortText),
    active: Type.Optional(Type.Boolean()),
    to: Type.Optional(Type.Array(EmailAddress, { minItems: 1, maxItems: 10 })),
    cc: Type.Optional(Type.Array(EmailAddress, { maxItems: 10 })),
    subjectTemplate: Type.Optional(
      Type.String({ maxLength: 300, pattern: "^[^\\r\\n]*$" }),
    ),
    encryptionPolicy: Type.Optional(
      Type.Union([
        Type.Literal("FORBIDDEN"),
        Type.Literal("OPTIONAL"),
        Type.Literal("REQUIRED"),
      ]),
    ),
    publicKeyId: Type.Optional(Type.Union([Uuid, Type.Null()])),
    maximumAttachmentBytes: Type.Optional(
      Type.Integer({ minimum: 0, maximum: 25 * 1024 * 1024 }),
    ),
    destinationUrl: Type.Optional(HttpsUrl),
    fieldMappings: Type.Optional(Type.Array(ManualFieldMapping)),
    acceptedExtensions: Type.Optional(
      Type.Array(Type.String({ pattern: "^\\.[a-z0-9]{1,16}$" })),
    ),
    maximumFileBytes: Type.Optional(Type.Integer({ minimum: 0 })),
    maximumFileCount: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
    acknowledgementBusinessDays: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 90 }),
    ),
    updateCadenceDays: Type.Optional(
      Type.Union([Type.Integer({ minimum: 1, maximum: 365 }), Type.Null()]),
    ),
    requiredFields: Type.Optional(Type.Array(SubmissionFieldKeySchema)),
    instructions: Type.Optional(
      Type.Union([Type.String({ maxLength: 20_000 }), Type.Null()]),
    ),
    sourceUrl: Type.Optional(Type.Union([HttpsUrl, Type.Null()])),
    sourceReviewedAt: Type.Optional(Type.Union([Timestamp, Type.Null()])),
    expectedRevision: RevisionField,
  },
  { additionalProperties: false },
);

export type UpdateVendorRouteRequest = Static<typeof UpdateVendorRouteRequest>;

export const CreateVendorPublicKeyRequest = Type.Object(
  {
    armoredKey: Type.String({ minLength: 1, maxLength: 2_000_000 }),
    sourceUrl: HttpsUrl,
    expectedFingerprint: Type.String({
      pattern: "^(?:[0-9A-Fa-f]{40}|[0-9A-Fa-f]{64})$",
    }),
    supersedesKeyId: Type.Optional(Uuid),
  },
  { additionalProperties: false },
);

export type CreateVendorPublicKeyRequest = Static<
  typeof CreateVendorPublicKeyRequest
>;

export const VerifyVendorPublicKeyRequest = Type.Object(
  {
    expectedFingerprint: Type.String({
      pattern: "^(?:[0-9A-Fa-f]{40}|[0-9A-Fa-f]{64})$",
    }),
    sourceUrl: HttpsUrl,
    expectedRevision: RevisionField,
  },
  { additionalProperties: false },
);

export type VerifyVendorPublicKeyRequest = Static<
  typeof VerifyVendorPublicKeyRequest
>;

export const ListVendorsQuery = Type.Object({
  ...PaginationQuery.properties,
  query: Type.Optional(Type.String({ maxLength: 200 })),
  includeArchived: Type.Optional(Type.Boolean()),
});

export type ListVendorsQuery = Static<typeof ListVendorsQuery>;
