import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  AssetIdentifierScheme,
  AssetKind,
  AssetRelationship,
} from "@codevault/core";

import { users } from "./auth.js";
import {
  createdAt,
  metadata,
  primaryId,
  revision,
  searchVector,
  timestampColumn,
  updatedAt,
} from "./columns.js";

/**
 * Asset tables.
 *
 * `kind` is drawn from a fixed, ecosystem-neutral vocabulary. Everything that
 * would tempt a schema toward `WORDPRESS_PLUGIN` lives in `asset_identifiers`
 * (a PURL) or `metadata` (an architecture, a model number) instead.
 */

export const assets = pgTable(
  "assets",
  {
    id: primaryId(),
    ref: text("ref").notNull(),
    name: text("name").notNull(),
    kind: text("kind").$type<AssetKind>().notNull(),
    vendor: text("vendor"),
    /** Headline version or model; the full list lives in `asset_versions`. */
    version: text("version"),
    notes: text("notes"),
    /**
     * Normalized identity used by prior-art matching, refreshed whenever the
     * name, vendor or identifiers change.
     */
    normalizedVendor: text("normalized_vendor"),
    normalizedProduct: text("normalized_product"),
    metadata: metadata(),
    searchVector: searchVector(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    revision: revision(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("assets_ref_key").on(table.ref),
    index("assets_kind_idx").on(table.kind),
    index("assets_normalized_product_idx").on(table.normalizedProduct),
  ],
);

export const assetIdentifiers = pgTable(
  "asset_identifiers",
  {
    id: primaryId(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    scheme: text("scheme").$type<AssetIdentifierScheme>().notNull(),
    value: text("value").notNull(),
    /** The identifier a researcher treats as authoritative for this asset. */
    primary: boolean("primary").notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("asset_identifiers_unique").on(
      table.assetId,
      table.scheme,
      table.value,
    ),
    index("asset_identifiers_value_idx").on(table.scheme, table.value),
  ],
);

export const assetVersions = pgTable(
  "asset_versions",
  {
    id: primaryId(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    releasedAt: timestampColumn("released_at"),
    metadata: metadata(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("asset_versions_unique").on(table.assetId, table.version),
  ],
);

/**
 * Directed relationships between assets.
 *
 * A device relates to its firmware, firmware contains components, a service
 * runs on a host. Self-relationships and exact duplicates are rejected by a
 * check constraint and a unique index rather than by application code alone.
 */
export const assetRelationships = pgTable(
  "asset_relationships",
  {
    id: primaryId(),
    fromAssetId: uuid("from_asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    toAssetId: uuid("to_asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    relationship: text("relationship").$type<AssetRelationship>().notNull(),
    note: text("note"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("asset_relationships_unique").on(
      table.fromAssetId,
      table.toAssetId,
      table.relationship,
    ),
    index("asset_relationships_to_idx").on(table.toAssetId),
  ],
);

export const assetsRelations = relations(assets, ({ many }) => ({
  identifiers: many(assetIdentifiers),
  versions: many(assetVersions),
}));

export const assetIdentifiersRelations = relations(
  assetIdentifiers,
  ({ one }) => ({
    asset: one(assets, {
      fields: [assetIdentifiers.assetId],
      references: [assets.id],
    }),
  }),
);

export const assetVersionsRelations = relations(assetVersions, ({ one }) => ({
  asset: one(assets, {
    fields: [assetVersions.assetId],
    references: [assets.id],
  }),
}));

export type AssetRow = typeof assets.$inferSelect;
export type NewAssetRow = typeof assets.$inferInsert;
export type AssetIdentifierRow = typeof assetIdentifiers.$inferSelect;
export type AssetVersionRow = typeof assetVersions.$inferSelect;
