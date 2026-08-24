import { Type, type Static } from "@sinclair/typebox";

import { enumOf, HttpsUrl } from "./common.js";

export const ASSET_REGISTRY_SOURCES = [
  "WORDPRESS_PLUGIN",
  "WORDPRESS_THEME",
  "NPM",
  "CRATES_IO",
  "PACKAGIST",
  "RUBYGEMS",
  "NUGET",
  "MAVEN_CENTRAL",
] as const;

export type AssetRegistrySource = (typeof ASSET_REGISTRY_SOURCES)[number];

export const AssetRegistrySourceSchema = enumOf(ASSET_REGISTRY_SOURCES);

export const AssetRegistrySearchQuery = Type.Object(
  {
    query: Type.String({ minLength: 2, maxLength: 200 }),
    source: Type.Optional(AssetRegistrySourceSchema),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  },
  { additionalProperties: false },
);

export type AssetRegistrySearchQuery = Static<typeof AssetRegistrySearchQuery>;

export const RegistryMetadataValue = Type.Union([
  Type.String({ maxLength: 2_000 }),
  Type.Number(),
  Type.Boolean(),
  Type.Null(),
]);

/** External catalog data proposed for review in the asset form. */
export const AssetRegistryResult = Type.Object(
  {
    source: AssetRegistrySourceSchema,
    sourceLabel: Type.String({ minLength: 1, maxLength: 80 }),
    externalId: Type.String({ minLength: 1, maxLength: 500 }),
    name: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.Union([Type.String({ maxLength: 2_000 }), Type.Null()]),
    latestVersion: Type.Union([Type.String({ maxLength: 120 }), Type.Null()]),
    purl: Type.String({ minLength: 5, maxLength: 500 }),
    vendorName: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    homepageUrl: Type.Union([HttpsUrl, Type.Null()]),
    sourceUrl: HttpsUrl,
    lastUpdatedAt: Type.Union([
      Type.String({ format: "date-time" }),
      Type.Null(),
    ]),
    metadata: Type.Record(Type.String(), RegistryMetadataValue),
  },
  { additionalProperties: false },
);

export type AssetRegistryResult = Static<typeof AssetRegistryResult>;

export const AssetRegistryFailure = Type.Object(
  {
    source: AssetRegistrySourceSchema,
    sourceLabel: Type.String({ minLength: 1, maxLength: 80 }),
    message: Type.String({ minLength: 1, maxLength: 300 }),
  },
  { additionalProperties: false },
);

export type AssetRegistryFailure = Static<typeof AssetRegistryFailure>;

export const AssetRegistrySearchResponse = Type.Object(
  {
    items: Type.Array(AssetRegistryResult, { maxItems: 50 }),
    failures: Type.Array(AssetRegistryFailure, {
      maxItems: ASSET_REGISTRY_SOURCES.length,
    }),
    searchedSources: Type.Array(AssetRegistrySourceSchema, {
      minItems: 1,
      maxItems: ASSET_REGISTRY_SOURCES.length,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);

export type AssetRegistrySearchResponse = Static<
  typeof AssetRegistrySearchResponse
>;
