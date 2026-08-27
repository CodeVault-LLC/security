import { and, eq, isNull, sql } from "drizzle-orm";

import { generateOpaqueToken } from "@codevault/core/crypto";
import type { Database } from "@codevault/db";
import { schema } from "@codevault/db";

import type { AuthenticatedPrincipal } from "./session.js";
import { hashToken } from "./tokens.js";

const MCP_TOKEN_PREFIX = "cv_mcp_";
const NO_RECENT_MFA = "1970-01-01T00:00:00.000Z";
const NON_EXPIRING = "9999-12-31T23:59:59.999Z";

export interface CreatedMcpAccess {
  token: string;
  access: {
    id: string;
    name: string;
    createdAt: string;
    lastUsedAt: string | null;
  };
}

export function isMcpAccessToken(token: string): boolean {
  return token.startsWith(MCP_TOKEN_PREFIX);
}

/** Issues one revocable grant. The raw token is returned once and never stored. */
export async function createMcpAccess(
  db: Database,
  userId: string,
  name: string,
): Promise<CreatedMcpAccess> {
  const token = `${MCP_TOKEN_PREFIX}${generateOpaqueToken()}`;
  const [row] = await db
    .insert(schema.mcpAccessTokens)
    .values({ userId, name: name.trim(), tokenHash: hashToken(token) })
    .returning({
      id: schema.mcpAccessTokens.id,
      name: schema.mcpAccessTokens.name,
      createdAt: schema.mcpAccessTokens.createdAt,
      lastUsedAt: schema.mcpAccessTokens.lastUsedAt,
    });

  if (row === undefined) throw new Error("Failed to create MCP access.");

  return { token, access: row };
}

/**
 * Resolves an MCP grant and applies user, role, and organization policy on every
 * request. Disabling MCP or the user takes effect without rotating credentials.
 */
export async function resolveMcpAccess(
  db: Database,
  token: string,
): Promise<AuthenticatedPrincipal | null> {
  if (!isMcpAccessToken(token)) return null;

  const [row] = await db
    .select({
      accessId: schema.mcpAccessTokens.id,
      accessCreatedAt: schema.mcpAccessTokens.createdAt,
      accessLastUsedAt: schema.mcpAccessTokens.lastUsedAt,
      userId: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      role: schema.organizationMemberships.role,
      disabled: schema.users.disabled,
      userCreatedAt: schema.users.createdAt,
      lastLoginAt: schema.users.lastLoginAt,
      organizationId: schema.organizations.id,
      organizationName: schema.organizations.name,
      inviteTtlHours: schema.organizationSecurityPolicies.inviteTtlHours,
      sessionIdleMinutes:
        schema.organizationSecurityPolicies.sessionIdleMinutes,
      sessionAbsoluteHours:
        schema.organizationSecurityPolicies.sessionAbsoluteHours,
      recentMfaMinutes: schema.organizationSecurityPolicies.recentMfaMinutes,
      mfaRequired: schema.organizationSecurityPolicies.mfaRequired,
      mcpEnabled: schema.organizationSecurityPolicies.mcpEnabled,
      mailHtmlRenderingEnabled:
        schema.organizationSecurityPolicies.mailHtmlRenderingEnabled,
    })
    .from(schema.mcpAccessTokens)
    .innerJoin(schema.users, eq(schema.users.id, schema.mcpAccessTokens.userId))
    .innerJoin(
      schema.organizationMemberships,
      eq(schema.organizationMemberships.userId, schema.users.id),
    )
    .innerJoin(
      schema.organizations,
      eq(
        schema.organizations.id,
        schema.organizationMemberships.organizationId,
      ),
    )
    .innerJoin(
      schema.organizationSecurityPolicies,
      eq(
        schema.organizationSecurityPolicies.organizationId,
        schema.organizations.id,
      ),
    )
    .where(
      and(
        eq(schema.mcpAccessTokens.tokenHash, hashToken(token)),
        isNull(schema.mcpAccessTokens.revokedAt),
        eq(schema.users.disabled, false),
        eq(schema.organizationSecurityPolicies.mcpEnabled, true),
      ),
    )
    .limit(1);

  if (row === undefined) return null;

  return {
    authentication: { kind: "MCP", id: row.accessId },
    user: {
      id: row.userId,
      email: row.email,
      displayName: row.displayName,
      role: row.role,
      disabled: row.disabled,
      createdAt: row.userCreatedAt,
      lastLoginAt: row.lastLoginAt,
    },
    session: {
      id: row.accessId,
      expiresAt: NON_EXPIRING,
      createdAt: row.accessCreatedAt,
      lastSeenAt: row.accessLastUsedAt,
      mfaVerifiedAt: NO_RECENT_MFA,
      mfaMethod: "TOTP",
    },
    organization: {
      id: row.organizationId,
      name: row.organizationName,
      policy: {
        inviteTtlHours: row.inviteTtlHours,
        sessionIdleMinutes: row.sessionIdleMinutes,
        sessionAbsoluteHours: row.sessionAbsoluteHours,
        recentMfaMinutes: row.recentMfaMinutes,
        mfaRequired: row.mfaRequired,
        mcpEnabled: row.mcpEnabled,
        mailHtmlRenderingEnabled: row.mailHtmlRenderingEnabled,
      },
    },
  };
}

export async function touchMcpAccess(
  db: Database,
  accessId: string,
): Promise<void> {
  await db
    .update(schema.mcpAccessTokens)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(schema.mcpAccessTokens.id, accessId),
        isNull(schema.mcpAccessTokens.revokedAt),
        sql`(${schema.mcpAccessTokens.lastUsedAt} IS NULL OR ${schema.mcpAccessTokens.lastUsedAt} < now() - interval '5 minutes')`,
      ),
    );
}

export async function revokeMcpAccess(
  db: Database,
  userId: string,
  accessId: string,
): Promise<void> {
  await db
    .update(schema.mcpAccessTokens)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(schema.mcpAccessTokens.id, accessId),
        eq(schema.mcpAccessTokens.userId, userId),
        isNull(schema.mcpAccessTokens.revokedAt),
      ),
    );
}

export async function revokeAllMcpAccessForUser(
  db: Database,
  userId: string,
): Promise<void> {
  await db
    .update(schema.mcpAccessTokens)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(schema.mcpAccessTokens.userId, userId),
        isNull(schema.mcpAccessTokens.revokedAt),
      ),
    );
}
