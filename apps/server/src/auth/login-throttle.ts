import { and, eq, gte, sql } from "drizzle-orm";

import type { Database } from "@codevault/db";
import { schema } from "@codevault/db";

/**
 * Login throttling.
 *
 * Counted per account and per source address. Both matter: per-account stops
 * someone grinding one researcher's password, per-source stops a spray across
 * every account at once.
 */

export interface ThrottleConfig {
  maxAttempts: number;
  windowMinutes: number;
}

export interface ThrottleDecision {
  allowed: boolean;
  /** Seconds until the caller may try again; zero when allowed. */
  retryAfterSeconds: number;
}

function windowStart(windowMinutes: number): string {
  return new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
}

export async function checkLoginThrottle(
  db: Database,
  email: string,
  sourceKey: string,
  config: ThrottleConfig,
): Promise<ThrottleDecision> {
  const since = windowStart(config.windowMinutes);

  const [byEmail] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.loginAttempts)
    .where(
      and(
        sql`lower(${schema.loginAttempts.email}) = lower(${email})`,
        eq(schema.loginAttempts.successful, false),
        gte(schema.loginAttempts.attemptedAt, since),
      ),
    );

  const [bySource] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.loginAttempts)
    .where(
      and(
        eq(schema.loginAttempts.sourceKey, sourceKey),
        eq(schema.loginAttempts.successful, false),
        gte(schema.loginAttempts.attemptedAt, since),
      ),
    );

  const emailAttempts = byEmail?.count ?? 0;
  // A single source is allowed more total failures than one account, because a
  // shared office address legitimately produces several people's typos.
  const sourceAttempts = bySource?.count ?? 0;
  const blocked =
    emailAttempts >= config.maxAttempts ||
    sourceAttempts >= config.maxAttempts * 5;

  if (!blocked) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return { allowed: false, retryAfterSeconds: config.windowMinutes * 60 };
}

export async function recordLoginAttempt(
  db: Database,
  email: string,
  sourceKey: string,
  successful: boolean,
): Promise<void> {
  await db
    .insert(schema.loginAttempts)
    .values({ email, sourceKey, successful });
}

/** Clears the failure history for an account after a successful login. */
export async function clearFailedAttempts(
  db: Database,
  email: string,
): Promise<void> {
  await db
    .delete(schema.loginAttempts)
    .where(
      and(
        sql`lower(${schema.loginAttempts.email}) = lower(${email})`,
        eq(schema.loginAttempts.successful, false),
      ),
    );
}
