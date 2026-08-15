/**
 * External identifier schemes.
 *
 * Findings accumulate identifiers from several authorities over their life. We
 * validate each scheme's shape and know how to link to it, but never invent one.
 */

export const EXTERNAL_ID_SCHEMES = [
  "CVE",
  "GHSA",
  "OSV",
  "VENDOR_ADVISORY",
  "BUG_TRACKER",
  "VENDOR_REFERENCE",
  "CUSTOM",
] as const;

export type ExternalIdScheme = (typeof EXTERNAL_ID_SCHEMES)[number];

const PATTERNS: Partial<Record<ExternalIdScheme, RegExp>> = {
  CVE: /^CVE-\d{4}-\d{4,}$/,
  GHSA: /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/i,
  OSV: /^[A-Z]+-\d{4}-\d+$/,
};

/** Characters that must never appear in an identifier we echo back. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/;

export function isValidExternalId(
  scheme: ExternalIdScheme,
  value: string,
): boolean {
  const pattern = PATTERNS[scheme];
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return false;
  }

  if (pattern === undefined) {
    // Vendor references and custom identifiers have no universal shape; the
    // only rules are that they are non-empty, reasonably short, and free of
    // control characters that could corrupt a header, log line or PDF field.
    return trimmed.length <= 128 && !CONTROL_CHARACTERS.test(trimmed);
  }

  return pattern.test(trimmed.toUpperCase());
}

/**
 * Canonical URL for an identifier, when the scheme has one.
 *
 * Returns null rather than guessing: a wrong link in a published advisory is
 * worse than no link.
 */
export function externalIdUrl(
  scheme: ExternalIdScheme,
  value: string,
): string | null {
  const trimmed = value.trim();

  if (scheme === "CVE") {
    return `https://www.cve.org/CVERecord?id=${encodeURIComponent(trimmed.toUpperCase())}`;
  }

  if (scheme === "GHSA") {
    return `https://github.com/advisories/${encodeURIComponent(trimmed.toUpperCase())}`;
  }

  if (scheme === "OSV") {
    return `https://osv.dev/vulnerability/${encodeURIComponent(trimmed.toUpperCase())}`;
  }

  return null;
}

/** Score schemes CodeVault can store. Extensible without a schema change. */
export const SCORE_SCHEMES = [
  "CVSS40",
  "CVSS31",
  "EPSS",
  "KEV",
  "SSVC",
  "CUSTOM",
] as const;

export type ScoreScheme = (typeof SCORE_SCHEMES)[number];

/**
 * Whether a scheme produces a deterministic numeric score from a vector.
 *
 * Only these schemes may have their score computed by CodeVault; EPSS and KEV
 * are retrieved facts with a source and a retrieval timestamp, not something we
 * calculate, and they are never folded into a CVSS number.
 */
export function isCalculableScheme(scheme: ScoreScheme): boolean {
  return scheme === "CVSS40" || scheme === "CVSS31";
}

export function isIntelligenceScheme(scheme: ScoreScheme): boolean {
  return scheme === "EPSS" || scheme === "KEV";
}
