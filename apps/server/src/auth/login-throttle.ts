import { and, eq, gte, sql } from "drizzle-orm";

import type { Database } from "@codevault/db";
import { schema } from "@codevault/db";
import type { LoginAttemptStage } from "@codevault/db/schema";

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

/**
 * Atomically reserves one failed-attempt slot before expensive verification.
 * Account and source advisory locks make the limit exact across API replicas;
 * a successful verification clears the pessimistic reservation afterward.
 */
export async function reserveLoginAttempt(
  db: Database,
  email: string,
  sourceKey: string,
  stage: LoginAttemptStage,
  config: ThrottleConfig,
): Promise<ThrottleDecision> {
  return db.transaction(async (tx) => {
    const normalizedEmail = email.trim().toLowerCase();
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`auth-account:${stage}:${normalizedEmail}`}, 0))`,
    );
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`auth-source:${stage}:${sourceKey}`}, 0))`,
    );
    const since = windowStart(config.windowMinutes);
    const [byEmail] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.loginAttempts)
      .where(
        and(
          sql`lower(${schema.loginAttempts.email}) = ${normalizedEmail}`,
          eq(schema.loginAttempts.stage, stage),
          eq(schema.loginAttempts.successful, false),
          gte(schema.loginAttempts.attemptedAt, since),
        ),
      );
    const [bySource] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.loginAttempts)
      .where(
        and(
          eq(schema.loginAttempts.sourceKey, sourceKey),
          eq(schema.loginAttempts.stage, stage),
          eq(schema.loginAttempts.successful, false),
          gte(schema.loginAttempts.attemptedAt, since),
        ),
      );
    const blocked =
      (byEmail?.count ?? 0) >= config.maxAttempts ||
      (bySource?.count ?? 0) >= config.maxAttempts * 5;
    if (blocked) {
      return {
        allowed: false,
        retryAfterSeconds: config.windowMinutes * 60,
      };
    }
    await tx.insert(schema.loginAttempts).values({
      email: normalizedEmail,
      sourceKey,
      stage,
      successful: false,
    });
    return { allowed: true, retryAfterSeconds: 0 };
  });
}

/** Clears the failure history for an account after a successful login. */
export async function clearFailedAttempts(
  db: Database,
  email: string,
  stage: LoginAttemptStage,
): Promise<void> {
  await db
    .delete(schema.loginAttempts)
    .where(
      and(
        sql`lower(${schema.loginAttempts.email}) = lower(${email})`,
        eq(schema.loginAttempts.stage, stage),
        eq(schema.loginAttempts.successful, false),
      ),
    );
}
