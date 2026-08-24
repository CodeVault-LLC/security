import {
  externalIdUrl,
  isExternalIdScheme,
  normalizeExternalId,
  type ExternalIdScheme,
} from "@codevault/standards";

export interface PreparedExternalIdentifier {
  scheme: ExternalIdScheme;
  value: string;
  url: string | null;
}

/** Validate and canonicalize an identifier before it reaches persistence. */
export function prepareExternalIdentifier(
  scheme: string,
  value: string,
): PreparedExternalIdentifier | null {
  if (!isExternalIdScheme(scheme)) {
    return null;
  }

  const canonical = normalizeExternalId(scheme, value);

  if (canonical === null) {
    return null;
  }

  return {
    scheme,
    value: canonical,
    url: externalIdUrl(scheme, canonical),
  };
}
