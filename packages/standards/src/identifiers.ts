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

export function isExternalIdScheme(value: string): value is ExternalIdScheme {
  return (EXTERNAL_ID_SCHEMES as readonly string[]).includes(value);
}

/** Canonical storage form for a valid external identifier. */
export function normalizeExternalId(
  scheme: string,
  value: string,
): string | null {
  if (!isExternalIdScheme(scheme)) {
    return null;
  }

  const trimmed = value.trim();
  const pattern = PATTERNS[scheme];

  if (
    trimmed.length === 0 ||
    trimmed.length > 128 ||
    CONTROL_CHARACTERS.test(trimmed)
  ) {
    return null;
  }

  if (pattern === undefined) {
    return trimmed;
  }

  const canonical = trimmed.toUpperCase();
  return pattern.test(canonical) ? canonical : null;
}

export function isValidExternalId(scheme: string, value: string): boolean {
  return normalizeExternalId(scheme, value) !== null;
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
  const canonical = normalizeExternalId(scheme, value);

  if (canonical === null) {
    return null;
  }

  if (scheme === "CVE") {
    return `https://www.cve.org/CVERecord?id=${encodeURIComponent(canonical)}`;
  }

  if (scheme === "GHSA") {
    return `https://github.com/advisories/${encodeURIComponent(canonical)}`;
  }

  if (scheme === "OSV") {
    return `https://osv.dev/vulnerability/${encodeURIComponent(canonical)}`;
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
