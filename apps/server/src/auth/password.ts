import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing.
 *
 * Argon2id with parameters chosen from the OWASP Password Storage Cheat Sheet's
 * second recommended configuration (19 MiB, two iterations, one lane). Nothing
 * in this module ever accepts, returns or logs a plaintext password beyond the
 * two functions below.
 */

/**
 * Argon2id is `Algorithm.Argon2id` in @node-rs/argon2, whose enum is ambient
 * and therefore unavailable under `verbatimModuleSyntax`. The value is part of
 * the library's public API and is stated here rather than imported.
 */
const ARGON2ID = 2;

const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 512;

export class WeakPasswordError extends Error {
  constructor(message: string) {
    super(message);

    this.name = "WeakPasswordError";
  }
}

/**
 * Validates a candidate password.
 *
 * Length is the only mechanical rule. Composition rules push people toward
 * `Password1!`, so CodeVault asks for length and rejects the handful of
 * passwords that are common enough to be tried first in any attack.
 */
export function assertPasswordAcceptable(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new WeakPasswordError(
      `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`,
    );
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    throw new WeakPasswordError(
      "That password appears in public breach lists. Choose another.",
    );
  }
}

const COMMON_PASSWORDS = new Set([
  "password1234",
  "123456789012",
  "qwertyuiopas",
  "administrator",
  "codevault123",
  "letmein12345",
  "passwordpassword",
  "iloveyou1234",
]);

export async function hashPassword(password: string): Promise<string> {
  assertPasswordAcceptable(password);

  return hash(password, ARGON2_OPTIONS);
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash so a corrupted row
 * cannot be distinguished from a wrong password by timing or by error text.
 */
export async function verifyPassword(
  storedHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}
