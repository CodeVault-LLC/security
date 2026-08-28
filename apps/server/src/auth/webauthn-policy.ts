import { and, count, eq, gt, isNull, sql } from "drizzle-orm";

import { validationError } from "@codevault/core";
import type { Database } from "@codevault/db";
import { schema } from "@codevault/db";

export const REQUIRED_ADMIN_SECURITY_KEYS = 2;

export async function lockPhishingResistantPolicy(
  db: Database,
  organizationId: string,
): Promise<void> {
  await db.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`webauthn-policy:${organizationId}`}, 0))`,
  );
}

export async function organizationRequiresPhishingResistantMfa(
  db: Database,
  organizationId: string,
): Promise<boolean> {
  const [policy] = await db
    .select({
      required:
        schema.organizationSecurityPolicies.phishingResistantMfaRequired,
    })
    .from(schema.organizationSecurityPolicies)
    .where(
      eq(schema.organizationSecurityPolicies.organizationId, organizationId),
    )
    .limit(1);
  return policy?.required ?? false;
}

export async function assertUserHasPrivilegedKeyReadiness(
  db: Database,
  userId: string,
): Promise<void> {
  const [row] = await db
    .select({ total: count(schema.webauthnCredentials.id) })
    .from(schema.webauthnCredentials)
    .where(
      and(
        eq(schema.webauthnCredentials.userId, userId),
        isNull(schema.webauthnCredentials.revokedAt),
      ),
    );
  if ((row?.total ?? 0) < REQUIRED_ADMIN_SECURITY_KEYS) {
    throw validationError(
      `Administrators need at least ${REQUIRED_ADMIN_SECURITY_KEYS} active security keys before phishing-resistant MFA can be required.`,
    );
  }
}

export async function assertOrganizationAdminKeyReadiness(
  db: Database,
  organizationId: string,
): Promise<void> {
  const pendingAdminInvites = await db
    .select({ id: schema.invites.id })
    .from(schema.invites)
    .where(
      and(
        eq(schema.invites.organizationId, organizationId),
        eq(schema.invites.role, "ADMIN"),
        isNull(schema.invites.acceptedAt),
        isNull(schema.invites.revokedAt),
        gt(schema.invites.expiresAt, new Date().toISOString()),
      ),
    )
    .limit(1);
  if (pendingAdminInvites.length > 0) {
    throw validationError(
      "Revoke pending administrator invitations or replace them with member invitations before requiring phishing-resistant MFA.",
    );
  }

  const admins = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .innerJoin(
      schema.organizationMemberships,
      eq(schema.organizationMemberships.userId, schema.users.id),
    )
    .where(
      and(
        eq(schema.organizationMemberships.organizationId, organizationId),
        eq(schema.organizationMemberships.role, "ADMIN"),
        eq(schema.users.disabled, false),
      ),
    );

  for (const admin of admins) {
    await assertUserHasPrivilegedKeyReadiness(db, admin.id);
  }
}
