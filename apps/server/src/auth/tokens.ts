import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Opaque token handling.
 *
 * Session and invite tokens are 32 random bytes. The server stores only
 * SHA-256(token): a database dump yields nothing that can be presented as a
 * credential. There are no JWTs anywhere in CodeVault — revocation has to be
 * immediate, and a stateless token cannot be revoked.
 */

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time comparison for two hex digests of equal length. */
export function tokensMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");

  if (leftBuffer.length !== rightBuffer.length || leftBuffer.length === 0) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * Extracts a bearer token from an Authorization header.
 *
 * Returns null for anything malformed; callers treat that identically to an
 * absent header so a malformed value never produces a distinct error.
 */
export function bearerTokenFrom(header: string | undefined): string | null {
  if (header === undefined) {
    return null;
  }

  const [scheme, value] = header.split(" ");

  if (scheme?.toLowerCase() !== "bearer") {
    return null;
  }

  if (value === undefined || value.length < 32) {
    return null;
  }

  return value;
}
