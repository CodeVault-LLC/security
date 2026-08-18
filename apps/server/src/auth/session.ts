import { and, eq, gt, isNull, sql } from "drizzle-orm";

import { type UserRole } from "@codevault/core";
import { generateOpaqueToken } from "@codevault/core/crypto";
import type { Database } from "@codevault/db";
import { schema } from "@codevault/db";

import { hashToken } from "./tokens.js";

/**
 * Session lifecycle.
 *
 * A session is a row, not a signed blob, so revoking one takes effect on the
 * next request rather than at the next expiry.
 */

export interface AuthenticatedPrincipal {
  user: {
    id: string;
    email: string;
    displayName: string;
    role: UserRole;
    disabled: boolean;
    createdAt: string;
    lastLoginAt: string | null;
  };
  session: {
    id: string;
    expiresAt: string;
    createdAt: string;
    lastSeenAt: string | null;
    mfaVerifiedAt: string;
    mfaMethod: "TOTP";
  };
  organization: {
    id: string;
    name: string;
    policy: {
      inviteTtlHours: number;
      sessionIdleMinutes: number;
      sessionAbsoluteHours: number;
      recentMfaMinutes: number;
      mfaRequired: true;
    };
  };
}

export interface CreatedSession {
  /** Raw token; returned exactly once and never stored server-side. */
  token: string;
  sessionId: string;
  expiresAt: string;
}

export async function createSession(
  db: Database,
  userId: string,
  ttlHours: number,
  userAgent: string | null,
  mfaVerifiedAt: Date,
): Promise<CreatedSession> {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  const [row] = await db
    .insert(schema.sessions)
    .values({
      userId,
      tokenHash: hashToken(token),
      expiresAt: expiresAt.toISOString(),
      mfaVerifiedAt: mfaVerifiedAt.toISOString(),
      mfaMethod: "TOTP",
      ...(userAgent === null ? {} : { userAgent }),
    })
    .returning({
      id: schema.sessions.id,
      expiresAt: schema.sessions.expiresAt,
    });

  if (row === undefined) {
    throw new Error("Failed to create a session.");
  }

  return { token, sessionId: row.id, expiresAt: row.expiresAt };
}

/**
 * Resolves a raw bearer token to a principal.
 *
 * Returns null for an unknown, expired, revoked or disabled-user session; the
 * caller answers all four cases with the same 401 so probing tells an attacker
 * nothing about which condition applied.
 */
export async function resolveSession(
  db: Database,
  token: string,
): Promise<AuthenticatedPrincipal | null> {
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();

  const rows = await db
    .select({
      sessionId: schema.sessions.id,
      sessionExpiresAt: schema.sessions.expiresAt,
      sessionCreatedAt: schema.sessions.createdAt,
      sessionLastSeenAt: schema.sessions.lastSeenAt,
      mfaVerifiedAt: schema.sessions.mfaVerifiedAt,
      mfaMethod: schema.sessions.mfaMethod,
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
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
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
        eq(schema.sessions.tokenHash, tokenHash),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.expiresAt, now),
        eq(schema.users.disabled, false),
      ),
    )
    .limit(1);

  const row = rows[0];

  if (row === undefined) {
    return null;
  }

  const idleAnchor = Date.parse(row.sessionLastSeenAt ?? row.sessionCreatedAt);
  const createdAt = Date.parse(row.sessionCreatedAt);

  if (
    !Number.isFinite(idleAnchor) ||
    !Number.isFinite(createdAt) ||
    Date.now() - createdAt > row.sessionAbsoluteHours * 60 * 60_000 ||
    Date.now() - idleAnchor > row.sessionIdleMinutes * 60_000
  ) {
    return null;
  }

  return {
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
      id: row.sessionId,
      expiresAt: row.sessionExpiresAt,
      createdAt: row.sessionCreatedAt,
      lastSeenAt: row.sessionLastSeenAt,
      mfaVerifiedAt: row.mfaVerifiedAt,
      mfaMethod: row.mfaMethod,
    },
    organization: {
      id: row.organizationId,
      name: row.organizationName,
      policy: {
        inviteTtlHours: row.inviteTtlHours,
        sessionIdleMinutes: row.sessionIdleMinutes,
        sessionAbsoluteHours: row.sessionAbsoluteHours,
        recentMfaMinutes: row.recentMfaMinutes,
        mfaRequired: row.mfaRequired as true,
      },
    },
  };
}

/** Records activity without rewriting the row on every single request. */
export async function touchSession(
  db: Database,
  sessionId: string,
): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ lastSeenAt: sql`now()` })
    .where(
      and(
        eq(schema.sessions.id, sessionId),
        sql`(${schema.sessions.lastSeenAt} IS NULL OR ${schema.sessions.lastSeenAt} < now() - interval '5 minutes')`,
      ),
    );
}

export async function revokeSession(
  db: Database,
  sessionId: string,
): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ revokedAt: sql`now()` })
    .where(
      and(eq(schema.sessions.id, sessionId), isNull(schema.sessions.revokedAt)),
    );
}

/** Used when a user is disabled or their role is reduced. */
export async function revokeAllSessionsForUser(
  db: Database,
  userId: string,
): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(schema.sessions.userId, userId),
        isNull(schema.sessions.revokedAt),
      ),
    );
}
