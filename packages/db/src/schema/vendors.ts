import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { VendorRouteType } from "@codevault/core";

import { users } from "./auth.js";
import {
  createdAt,
  primaryId,
  revision,
  timestampColumn,
  updatedAt,
} from "./columns.js";

/** Internal vendor directory. Vendors are records, never external accounts. */
export const vendors = pgTable(
  "vendors",
  {
    id: primaryId(),
    ref: text("ref").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    websiteUrl: text("website_url"),
    builtIn: boolean("built_in").notNull().default(false),
    builtInModifiedAt: timestampColumn("built_in_modified_at"),
    sourceUrl: text("source_url"),
    sourceReviewedAt: timestampColumn("source_reviewed_at"),
    archivedAt: timestampColumn("archived_at"),
    /** Null only for deterministic migration/seed records. */
    createdBy: uuid("created_by").references(() => users.id),
    revision: revision(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("vendors_ref_key").on(table.ref),
    uniqueIndex("vendors_slug_key").on(table.slug),
    uniqueIndex("vendors_normalized_name_key").on(table.normalizedName),
    index("vendors_active_name_idx").on(table.archivedAt, table.name),
  ],
);

/** Append-only key versions. Replacement creates a new row. */
export const vendorPublicKeys = pgTable(
  "vendor_public_keys",
  {
    id: primaryId(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    armoredKey: text("armored_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    userIds: jsonb("user_ids").$type<string[]>().notNull().default([]),
    algorithm: text("algorithm").notNull(),
    keyCreatedAt: timestampColumn("key_created_at").notNull(),
    expiresAt: timestampColumn("expires_at"),
    revokedAt: timestampColumn("revoked_at"),
    sourceUrl: text("source_url").notNull(),
    verifiedBy: uuid("verified_by").references(() => users.id),
    verifiedAt: timestampColumn("verified_at"),
    supersededById: uuid("superseded_by_id"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    revision: revision(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("vendor_public_keys_fingerprint_key").on(
      table.vendorId,
      table.fingerprint,
    ),
    index("vendor_public_keys_vendor_idx").on(table.vendorId, table.createdAt),
  ],
);

/** Validated, non-executable route requirements are stored as JSONB. */
export const vendorRoutes = pgTable(
  "vendor_routes",
  {
    id: primaryId(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    name: text("name").notNull(),
    type: text("type").$type<VendorRouteType>().notNull(),
    requirements: jsonb("requirements")
      .$type<Record<string, unknown>>()
      .notNull(),
    active: boolean("active").notNull().default(true),
    builtIn: boolean("built_in").notNull().default(false),
    builtInModifiedAt: timestampColumn("built_in_modified_at"),
    sourceUrl: text("source_url"),
    sourceReviewedAt: timestampColumn("source_reviewed_at"),
    createdBy: uuid("created_by").references(() => users.id),
    revision: revision(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("vendor_routes_name_key").on(table.vendorId, table.name),
    index("vendor_routes_vendor_idx").on(table.vendorId, table.active),
  ],
);

export const vendorsRelations = relations(vendors, ({ many }) => ({
  routes: many(vendorRoutes),
  publicKeys: many(vendorPublicKeys),
}));

export const vendorRoutesRelations = relations(vendorRoutes, ({ one }) => ({
  vendor: one(vendors, {
    fields: [vendorRoutes.vendorId],
    references: [vendors.id],
  }),
}));

export const vendorPublicKeysRelations = relations(
  vendorPublicKeys,
  ({ one }) => ({
    vendor: one(vendors, {
      fields: [vendorPublicKeys.vendorId],
      references: [vendors.id],
    }),
  }),
);

export type VendorRow = typeof vendors.$inferSelect;
export type NewVendorRow = typeof vendors.$inferInsert;
export type VendorRouteRow = typeof vendorRoutes.$inferSelect;
export type VendorPublicKeyRow = typeof vendorPublicKeys.$inferSelect;
