import { and, eq, isNull, lt, or } from "drizzle-orm";
import * as OTPAuth from "otpauth";

import { schema, type Database } from "@codevault/db";

const ALGORITHM = "SHA1";
const DIGITS = 6;
const PERIOD_SECONDS = 30;
const WINDOW = 1;

export interface TotpEnrollment {
  secretBytes: Uint8Array;
  manualSecret: string;
  provisioningUri: string;
}

function totp(secretBase32: string, issuer = "CodeVault", label = "account") {
  return new OTPAuth.TOTP({
    issuer,
    label,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD_SECONDS,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

export function createTotpEnrollment(
  issuer: string,
  label: string,
): TotpEnrollment {
  const secret = new OTPAuth.Secret({ size: 20 });
  const authenticator = new OTPAuth.TOTP({
    issuer,
    label,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD_SECONDS,
    secret,
  });

  return {
    secretBytes: new Uint8Array(secret.buffer),
    manualSecret: secret.base32,
    provisioningUri: authenticator.toString(),
  };
}

export function generateTotpAt(
  secretBase32: string,
  timestampMs: number,
): string {
  return totp(secretBase32).generate({ timestamp: timestampMs });
}

/** Returns the absolute matched counter, not merely a replay-unsafe Boolean. */
export function validateTotpAt(
  secretBase32: string,
  token: string,
  timestampMs: number,
): number | null {
  if (!/^\d{6}$/.test(token)) {
    return null;
  }

  const delta = totp(secretBase32).validate({
    token,
    timestamp: timestampMs,
    window: WINDOW,
  });
  if (delta === null) {
    return null;
  }

  return Math.floor(timestampMs / (PERIOD_SECONDS * 1_000)) + delta;
}

/** Atomically advances a credential's replay counter. */
export async function consumeTotpCounter(
  db: Database,
  credentialId: string,
  counter: number,
): Promise<boolean> {
  const rows = await db
    .update(schema.totpCredentials)
    .set({ lastAcceptedCounter: counter })
    .where(
      and(
        eq(schema.totpCredentials.id, credentialId),
        or(
          isNull(schema.totpCredentials.lastAcceptedCounter),
          lt(schema.totpCredentials.lastAcceptedCounter, counter),
        ),
      ),
    )
    .returning({ id: schema.totpCredentials.id });

  return rows.length === 1;
}
