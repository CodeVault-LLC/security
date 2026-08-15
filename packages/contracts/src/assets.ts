import { Type, type Static } from "@sinclair/typebox";

import {
  AssetIdentifierSchemeSchema,
  AssetKindSchema,
  AssetRelationshipSchema,
  HumanReference,
  PaginationQuery,
  RevisionField,
  ShortText,
  Timestamp,
  Uuid,
} from "./common.js";

/**
 * Asset contracts.
 *
 * The kind vocabulary is fixed and ecosystem-neutral. A WordPress plugin is a
 * SOFTWARE_COMPONENT carrying a `pkg:wordpress/...` identifier, and a camera is
 * a DEVICE related to a FIRMWARE asset — the taxonomy never grows a branch per
 * technology.
 */

export const AssetIdentifier = Type.Object({
  id: Uuid,
  scheme: AssetIdentifierSchemeSchema,
  value: Type.String({ minLength: 1, maxLength: 500 }),
  /** True for the identifier a researcher considers authoritative. */
  primary: Type.Boolean(),
  createdAt: Timestamp,
});

export type AssetIdentifier = Static<typeof AssetIdentifier>;

export const AssetVersion = Type.Object({
  id: Uuid,
  version: Type.String({ minLength: 1, maxLength: 120 }),
  releasedAt: Type.Union([Timestamp, Type.Null()]),
  /** Build, model revision, firmware hash and similar per-release detail. */
  metadata: Type.Record(Type.String(), Type.Unknown()),
  createdAt: Timestamp,
});

export type AssetVersion = Static<typeof AssetVersion>;

export const AssetRelationshipRecord = Type.Object({
  id: Uuid,
  relationship: AssetRelationshipSchema,
  fromAssetId: Uuid,
  toAssetId: Uuid,
  toAssetName: Type.String(),
  toAssetKind: AssetKindSchema,
  note: Type.Union([Type.String(), Type.Null()]),
  createdAt: Timestamp,
});

export type AssetRelationshipRecord = Static<typeof AssetRelationshipRecord>;

export const AssetSummary = Type.Object({
  id: Uuid,
  ref: HumanReference,
  name: Type.String(),
  kind: AssetKindSchema,
  vendor: Type.Union([Type.String(), Type.Null()]),
  version: Type.Union([Type.String(), Type.Null()]),
  primaryIdentifier: Type.Union([Type.String(), Type.Null()]),
  findingCount: Type.Integer({ minimum: 0 }),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  revision: RevisionField,
});

export type AssetSummary = Static<typeof AssetSummary>;

export const AssetDetail = Type.Object({
  ...AssetSummary.properties,
  notes: Type.Union([Type.String(), Type.Null()]),
  /** Target-specific attributes: architecture, endpoint, region, model. */
  metadata: Type.Record(Type.String(), Type.Unknown()),
  identifiers: Type.Array(AssetIdentifier),
  versions: Type.Array(AssetVersion),
  relationships: Type.Array(AssetRelationshipRecord),
});

export type AssetDetail = Static<typeof AssetDetail>;

/** The simple create dialog: six fields, five of them optional. */
export const CreateAssetRequest = Type.Object({
  name: ShortText,
  kind: AssetKindSchema,
  vendor: Type.Optional(Type.String({ maxLength: 200 })),
  version: Type.Optional(Type.String({ maxLength: 120 })),
  identifier: Type.Optional(
    Type.Object({
      scheme: AssetIdentifierSchemeSchema,
      value: Type.String({ minLength: 1, maxLength: 500 }),
    }),
  ),
  notes: Type.Optional(Type.String({ maxLength: 5_000 })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  /** Associates the new asset with a case straight away. */
  caseId: Type.Optional(Uuid),
});

export type CreateAssetRequest = Static<typeof CreateAssetRequest>;

export const UpdateAssetRequest = Type.Object({
  name: Type.Optional(ShortText),
  kind: Type.Optional(AssetKindSchema),
  vendor: Type.Optional(
    Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
  ),
  version: Type.Optional(
    Type.Union([Type.String({ maxLength: 120 }), Type.Null()]),
  ),
  notes: Type.Optional(
    Type.Union([Type.String({ maxLength: 5_000 }), Type.Null()]),
  ),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  expectedRevision: RevisionField,
});

export type UpdateAssetRequest = Static<typeof UpdateAssetRequest>;

export const AddAssetIdentifierRequest = Type.Object({
  scheme: AssetIdentifierSchemeSchema,
  value: Type.String({ minLength: 1, maxLength: 500 }),
  primary: Type.Optional(Type.Boolean()),
});

export type AddAssetIdentifierRequest = Static<
  typeof AddAssetIdentifierRequest
>;

export const AddAssetVersionRequest = Type.Object({
  version: Type.String({ minLength: 1, maxLength: 120 }),
  releasedAt: Type.Optional(Timestamp),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export type AddAssetVersionRequest = Static<typeof AddAssetVersionRequest>;

export const AddAssetRelationshipRequest = Type.Object({
  relationship: AssetRelationshipSchema,
  toAssetId: Uuid,
  note: Type.Optional(Type.String({ maxLength: 500 })),
});

export type AddAssetRelationshipRequest = Static<
  typeof AddAssetRelationshipRequest
>;

export const ListAssetsQuery = Type.Object({
  ...PaginationQuery.properties,
  kind: Type.Optional(AssetKindSchema),
  caseId: Type.Optional(Uuid),
  query: Type.Optional(Type.String({ maxLength: 200 })),
});

export type ListAssetsQuery = Static<typeof ListAssetsQuery>;
