/**
 * Product identity normalization for prior-art matching.
 *
 * Vendors write their own names inconsistently ("Hummingbird Performance",
 * "wp-smushit", "Smush Pro"), so before comparing anything we reduce identity
 * to a comparable form and, where possible, to a structured package identity.
 */

export interface NormalizedIdentity {
  /** Lower-cased, punctuation-collapsed vendor name, empty when unknown. */
  vendor: string;
  /** Lower-cased, punctuation-collapsed product name. */
  product: string;
  /** Ecosystem from a PURL, when one was supplied. */
  ecosystem: string | null;
  /** Package name from a PURL, when one was supplied. */
  packageName: string | null;
}

const SEPARATORS = /[\s._/\\-]+/g;
const NOISE_WORDS = new Set([
  "the",
  "inc",
  "llc",
  "ltd",
  "gmbh",
  "corp",
  "corporation",
  "software",
  "plugin",
  "extension",
  "module",
  "for",
  "wordpress",
]);

/**
 * Collapses a free-text name to comparable tokens.
 *
 * Noise words are dropped because "Foo Plugin for WordPress" and "Foo" are the
 * same product for matching purposes, while genuinely distinct products still
 * differ in their remaining tokens.
 */
export function normalizeName(value: string): string {
  const tokens = value
    .toLowerCase()
    .replace(SEPARATORS, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .split(" ")
    .filter((token) => token.length > 0)
    .filter((token) => !NOISE_WORDS.has(token));

  return tokens.join(" ");
}

export interface ParsedPurl {
  type: string;
  namespace: string | null;
  name: string;
  version: string | null;
}

/**
 * Parses a Package URL such as `pkg:npm/@scope/name@1.2.3`.
 *
 * A dependency for this would be one more thing to audit for a format that is
 * a scheme, a path and an optional version.
 */
export function parsePurl(value: string): ParsedPurl | null {
  const trimmed = value.trim();

  if (!trimmed.toLowerCase().startsWith("pkg:")) {
    return null;
  }

  const withoutScheme = trimmed.slice("pkg:".length);
  const [pathAndVersion] = withoutScheme.split("?");

  if (pathAndVersion === undefined || pathAndVersion.length === 0) {
    return null;
  }

  const atIndex = pathAndVersion.lastIndexOf("@");
  const hasVersion = atIndex > 0;
  const path = hasVersion ? pathAndVersion.slice(0, atIndex) : pathAndVersion;
  const version = hasVersion ? pathAndVersion.slice(atIndex + 1) : null;
  const segments = path.split("/").filter((segment) => segment.length > 0);

  if (segments.length < 2) {
    return null;
  }

  const type = segments[0];
  const name = segments[segments.length - 1];

  if (type === undefined || name === undefined) {
    return null;
  }

  const namespaceSegments = segments.slice(1, -1);

  return {
    type: type.toLowerCase(),
    namespace:
      namespaceSegments.length > 0 ? namespaceSegments.join("/") : null,
    name: decodeURIComponent(name),
    version: version === null ? null : decodeURIComponent(version),
  };
}

export interface ParsedCpe23 {
  part: string;
  vendor: string;
  product: string;
  version: string;
}

/** Parses the well-formed CPE 2.3 formatted string binding. */
export function parseCpe23(value: string): ParsedCpe23 | null {
  const parts = value.trim().split(":");

  if (parts.length < 6 || parts[0] !== "cpe" || parts[1] !== "2.3") {
    return null;
  }

  const [, , part, vendor, product, version] = parts;

  if (
    part === undefined ||
    vendor === undefined ||
    product === undefined ||
    version === undefined
  ) {
    return null;
  }

  return { part, vendor, product, version };
}

export interface IdentityInput {
  name: string;
  vendor?: string | null;
  identifiers?: readonly { scheme: string; value: string }[];
}

/**
 * Builds the normalized identity used by both internal and external searches.
 *
 * Structured identifiers win over free text when both are present, because a
 * PURL or CPE is what the external advisory databases actually index on.
 */
export function normalizeIdentity(input: IdentityInput): NormalizedIdentity {
  const identifiers = input.identifiers ?? [];
  const purlEntry = identifiers.find(
    (identifier) => identifier.scheme === "PURL",
  );
  const cpeEntry = identifiers.find(
    (identifier) => identifier.scheme === "CPE23",
  );
  const purl = purlEntry ? parsePurl(purlEntry.value) : null;
  const cpe = cpeEntry ? parseCpe23(cpeEntry.value) : null;

  const vendorSource = input.vendor ?? cpe?.vendor ?? purl?.namespace ?? "";
  const productSource = purl?.name ?? cpe?.product ?? input.name;

  return {
    vendor: normalizeName(vendorSource),
    product: normalizeName(productSource),
    ecosystem: purl?.type ?? null,
    packageName:
      purl === null
        ? null
        : purl.namespace === null
          ? purl.name
          : `${purl.namespace}/${purl.name}`,
  };
}

/**
 * Token-overlap similarity in [0, 1], used to rank candidate matches.
 *
 * Deliberately simple and explainable: a researcher reading the prior-art tab
 * can see why two titles were considered close without a black-box score.
 */
export function titleSimilarity(left: string, right: string): number {
  const leftTokens = new Set(normalizeName(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeName(right).split(" ").filter(Boolean));

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let shared = 0;

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      shared += 1;
    }
  }

  const union = new Set([...leftTokens, ...rightTokens]).size;

  return shared / union;
}
