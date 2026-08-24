import {
  boolean,
  integer,
  pgTable,
  smallint,
  text,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, primaryId, updatedAt } from "./columns.js";

/** The single organization that owns every account and research record. */
export const organizations = pgTable("organizations", {
  id: primaryId(),
  singletonKey: smallint("singleton_key").notNull().default(1),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  reportFooter: text("report_footer"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Security policy is deliberately bounded; MFA itself cannot be disabled. */
export const organizationSecurityPolicies = pgTable(
  "organization_security_policies",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    mfaRequired: boolean("mfa_required").notNull().default(true),
    inviteTtlHours: integer("invite_ttl_hours").notNull().default(72),
    sessionIdleMinutes: integer("session_idle_minutes").notNull().default(30),
    sessionAbsoluteHours: integer("session_absolute_hours")
      .notNull()
      .default(12),
    recentMfaMinutes: integer("recent_mfa_minutes").notNull().default(10),
    mcpEnabled: boolean("mcp_enabled").notNull().default(true),
    // The SQL migration owns this FK to avoid an auth <-> organization cycle.
    updatedBy: uuid("updated_by"),
    updatedAt: updatedAt(),
  },
);

export type OrganizationRow = typeof organizations.$inferSelect;
export type OrganizationSecurityPolicyRow =
  typeof organizationSecurityPolicies.$inferSelect;
