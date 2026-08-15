import { and, eq, gt, isNull, sql } from "drizzle-orm";

import { generateOpaqueToken, type UserRole } from "@codevault/core";
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
): Promise<CreatedSession> {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  const [row] = await db
    .insert(schema.sessions)
    .values({
      userId,
      tokenHash: hashToken(token),
      expiresAt: expiresAt.toISOString(),
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
      userId: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      role: schema.users.role,
      disabled: schema.users.disabled,
      userCreatedAt: schema.users.createdAt,
      lastLoginAt: schema.users.lastLoginAt,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
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
    .where(eq(schema.sessions.id, sessionId));
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
