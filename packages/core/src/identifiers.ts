import { randomUUID, randomBytes } from "node:crypto";

/**
 * Identifier policy.
 *
 * Primary keys are UUIDv7 so inserts stay index-friendly without leaking a
 * sequence, and every human-facing reference is a separate, readable value.
 * References never imitate a CVE identifier: `FIND-2026-0001` can never be
 * mistaken for an assigned CVE in a screenshot or an email thread.
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

export function uuidv4Fallback(): string {
  return randomUUID();
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Human-facing reference prefixes. Order matters only for documentation. */
export const REFERENCE_PREFIXES = {
  case: "CASE",
  finding: "FIND",
  asset: "AST",
  evidence: "EVID",
  poc: "POC",
  reference: "REF",
  report: "RPT",
} as const;

export type ReferenceKind = keyof typeof REFERENCE_PREFIXES;

/** Kinds whose reference embeds the year the record was created. */
const YEAR_SCOPED_KINDS: ReadonlySet<ReferenceKind> = new Set([
  "case",
  "finding",
]);

const YEAR_SCOPED_SEQUENCE_WIDTH = 4;
const FLAT_SEQUENCE_WIDTH = 6;

export function isYearScopedReference(kind: ReferenceKind): boolean {
  return YEAR_SCOPED_KINDS.has(kind);
}

/**
 * Formats a human reference from a sequence number.
 *
 * Year-scoped kinds produce `CASE-2026-0001`; flat kinds produce `AST-000001`.
 * The sequence is allocated by the database so concurrent writers cannot
 * collide, and this function only formats it.
 */
export function formatReference(
  kind: ReferenceKind,
  sequence: number,
  year?: number,
): string {
  const prefix = REFERENCE_PREFIXES[kind];

  if (isYearScopedReference(kind)) {
    if (year === undefined) {
      throw new Error(`Reference kind "${kind}" requires a year`);
    }

    const padded = String(sequence).padStart(YEAR_SCOPED_SEQUENCE_WIDTH, "0");

    return `${prefix}-${year}-${padded}`;
  }

  const padded = String(sequence).padStart(FLAT_SEQUENCE_WIDTH, "0");

  return `${prefix}-${padded}`;
}

export interface ParsedReference {
  kind: ReferenceKind;
  year: number | null;
  sequence: number;
}

const PREFIX_TO_KIND = new Map<string, ReferenceKind>(
  Object.entries(REFERENCE_PREFIXES).map(([kind, prefix]) => [
    prefix,
    kind as ReferenceKind,
  ]),
);

/** Parses a reference such as `FIND-2026-0012`, returning null if malformed. */
export function parseReference(value: string): ParsedReference | null {
  const parts = value.trim().toUpperCase().split("-");
  const prefix = parts[0];

  if (prefix === undefined) {
    return null;
  }

  const kind = PREFIX_TO_KIND.get(prefix);

  if (kind === undefined) {
    return null;
  }

  if (isYearScopedReference(kind)) {
    if (parts.length !== 3) {
      return null;
    }

    const year = Number(parts[1]);
    const sequence = Number(parts[2]);

    if (!Number.isInteger(year) || !Number.isInteger(sequence)) {
      return null;
    }

    return { kind, year, sequence };
  }

  if (parts.length !== 2) {
    return null;
  }

  const sequence = Number(parts[1]);

  if (!Number.isInteger(sequence)) {
    return null;
  }

  return { kind, year: null, sequence };
}

/**
 * Guards against internal references that could be mistaken for a CVE.
 *
 * Used by validation on any user-supplied reference-like input.
 */
export function looksLikeCveIdentifier(value: string): boolean {
  return /^CVE-\d{4}-\d{4,}$/i.test(value.trim());
}

const CVE_PATTERN = /^CVE-\d{4}-\d{4,}$/;

export function isValidCveId(value: string): boolean {
  return CVE_PATTERN.test(value.trim().toUpperCase());
}

const CWE_PATTERN = /^CWE-\d{1,5}$/;

export function isValidCweId(value: string): boolean {
  return CWE_PATTERN.test(value.trim().toUpperCase());
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export function isSha256(value: string): boolean {
  return SHA256_PATTERN.test(value.trim());
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
