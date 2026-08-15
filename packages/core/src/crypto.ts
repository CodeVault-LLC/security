import { randomBytes, randomUUID } from "node:crypto";

/**
 * Identifier generation.
 *
 * Split from the rest of the identifier module because it needs `node:crypto`.
 * The desktop renderer imports the domain vocabulary and the reference
 * formatters, and must not pull a Node built-in into a browser bundle — nor
 * should it ever be the thing generating a session token or an object key.
 */

const UUID_V7_VARIANT_MASK = 0b0011_1111;
const UUID_V7_VARIANT_BITS = 0b1000_0000;
const UUID_V7_VERSION_MASK = 0b0000_1111;
const UUID_V7_VERSION_BITS = 0b0111_0000;

/**
 * Generates a UUIDv7: 48 bits of Unix milliseconds followed by random bits.
 *
 * Node does not ship a v7 generator, and the algorithm is a dozen lines, so we
 * implement it rather than take a dependency. `uuidv4Fallback` exists for
 * environments where a monotonic clock is unavailable.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  const timestamp = BigInt(now);

  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);

  bytes[6] = ((bytes[6] ?? 0) & UUID_V7_VERSION_MASK) | UUID_V7_VERSION_BITS;
  bytes[8] = ((bytes[8] ?? 0) & UUID_V7_VARIANT_MASK) | UUID_V7_VARIANT_BITS;

  const hex = bytes.toString("hex");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Identifier policy.
 *
 * Primary keys are UUIDv7 so inserts stay index-friendly without leaking a
 * sequence, and every human-facing reference is a separate, readable value.
 * References never imitate a CVE identifier: `FIND-2026-0001` can never be
 * mistaken for an assigned CVE in a screenshot or an email thread.
 */

export function uuidv4Fallback(): string {
  return randomUUID();
}

/**
 * Object-storage keys.
 *
 * The original filename never becomes part of the key: uploaded names are
 * attacker-controlled and would otherwise reach path handling, log lines and
 * bucket listings. The key is opaque, and the filename lives in the database.
 */
export function generateObjectKey(caseId: string, artifactId: string): string {
  const entropy = randomBytes(16).toString("hex");

  return `cases/${caseId}/artifacts/${artifactId}/${entropy}`;
}

/**
 * Generates a raw 32-byte token for sessions and invitations.
 *
 * Returned base64url-encoded so it survives headers and clipboards intact.
 */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}
