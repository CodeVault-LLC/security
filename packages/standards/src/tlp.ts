/**
 * Traffic Light Protocol 2.0.
 *
 * TLP answers "who may this be forwarded to?". CodeVault's `ContentVisibility`
 * answers "which projection of the case may contain this?". They are related
 * but not the same, and collapsing them would mean a vendor report could not
 * carry TLP:AMBER+STRICT without changing what data it is allowed to include.
 */

export const TLP_LABELS = [
  "TLP:RED",
  "TLP:AMBER+STRICT",
  "TLP:AMBER",
  "TLP:GREEN",
  "TLP:CLEAR",
] as const;

export type TlpLabel = (typeof TLP_LABELS)[number];

export interface TlpDefinition {
  label: TlpLabel;
  /** Short name for badges. */
  shortName: string;
  /** The sharing rule, phrased as FIRST publishes it. */
  sharingRule: string;
  /** Token used for theme colours; never the only signal in the UI. */
  colorToken: "tlp-red" | "tlp-amber" | "tlp-green" | "tlp-clear";
}

export const TLP_DEFINITIONS: Readonly<Record<TlpLabel, TlpDefinition>> = {
  "TLP:RED": {
    label: "TLP:RED",
    shortName: "RED",
    sharingRule:
      "For the eyes and ears of individual recipients only. Do not share.",
    colorToken: "tlp-red",
  },
  "TLP:AMBER+STRICT": {
    label: "TLP:AMBER+STRICT",
    shortName: "AMBER+STRICT",
    sharingRule: "Limited disclosure, restricted to the recipient organisation.",
    colorToken: "tlp-amber",
  },
  "TLP:AMBER": {
    label: "TLP:AMBER",
    shortName: "AMBER",
    sharingRule:
      "Limited disclosure, restricted to the recipient organisation and its clients.",
    colorToken: "tlp-amber",
  },
  "TLP:GREEN": {
    label: "TLP:GREEN",
    shortName: "GREEN",
    sharingRule: "Limited disclosure, restricted to the community.",
    colorToken: "tlp-green",
  },
  "TLP:CLEAR": {
    label: "TLP:CLEAR",
    shortName: "CLEAR",
    sharingRule: "Recipients may share this without restriction.",
    colorToken: "tlp-clear",
  },
};

/** Restrictiveness order, most restricted first. */
const TLP_RANK: Record<TlpLabel, number> = {
  "TLP:RED": 4,
  "TLP:AMBER+STRICT": 3,
  "TLP:AMBER": 2,
  "TLP:GREEN": 1,
  "TLP:CLEAR": 0,
};

export function isTlpLabel(value: string): value is TlpLabel {
  return (TLP_LABELS as readonly string[]).includes(value);
}

export function isMoreRestrictive(left: TlpLabel, right: TlpLabel): boolean {
  return TLP_RANK[left] > TLP_RANK[right];
}

/**
 * The most restrictive label in a set.
 *
 * A report inherits the strictest marking of anything it contains, so mixing
 * TLP:RED evidence into a TLP:GREEN report is caught by the linter instead of
 * being silently downgraded.
 */
export function mostRestrictive(labels: readonly TlpLabel[]): TlpLabel {
  return labels.reduce<TlpLabel>(
    (strictest, label) =>
      isMoreRestrictive(label, strictest) ? label : strictest,
    "TLP:CLEAR",
  );
}

/** Default marking a report of each audience starts with. */
export function defaultTlpForAudience(
  audience: "INTERNAL" | "VENDOR" | "PUBLIC",
): TlpLabel {
  if (audience === "INTERNAL") {
    return "TLP:RED";
  }

  if (audience === "VENDOR") {
    return "TLP:AMBER";
  }

  return "TLP:CLEAR";
}

/**
 * Labels a given audience may legitimately carry.
 *
 * A public report marked TLP:RED is a contradiction, and the UI refuses the
 * combination rather than exporting a document whose header disagrees with its
 * own distribution.
 */
export function allowedTlpForAudience(
  audience: "INTERNAL" | "VENDOR" | "PUBLIC",
): readonly TlpLabel[] {
  if (audience === "INTERNAL") {
    return ["TLP:RED", "TLP:AMBER+STRICT", "TLP:AMBER"];
  }

  if (audience === "VENDOR") {
    return ["TLP:AMBER+STRICT", "TLP:AMBER", "TLP:GREEN"];
  }

  return ["TLP:GREEN", "TLP:CLEAR"];
}

export function isTlpAllowedForAudience(
  label: TlpLabel,
  audience: "INTERNAL" | "VENDOR" | "PUBLIC",
): boolean {
  return allowedTlpForAudience(audience).includes(label);
}
