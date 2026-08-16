import { Building2, Globe, Lock } from "lucide-react";
import type { ComponentType } from "react";

import type {
  ArtifactKind,
  AssetKind,
  ContentVisibility,
} from "@codevault/core";
import type { SeverityRating } from "@codevault/standards";

import {
  humaniseState,
  PRIOR_ART_ICON_KINDS,
  SEVERITY_ICON_KINDS,
  stateTone,
  STATE_TONE_ICON_KINDS,
  type StateKind,
  type StateTone,
} from "./badges.js";
import type { SelectOption, SelectTone } from "./overlays.js";
import { artifactKindIcon, assetKindIcon } from "./security.js";

/**
 * Option builders for the product's own vocabularies.
 *
 * A picker that sets a finding's validation state and the badge that reports
 * it afterwards are two views of one fact, so they take their words, glyphs
 * and colours from the same place. Building the options here rather than at
 * each call site is what keeps that true: before this, four screens each
 * lowercased or underscored the same enum slightly differently, and one of
 * them showed `PEER_REVIEWED` raw.
 */

const ICON_CLASS = "size-3.5";

const icon = (
  Kind: ComponentType<{ className?: string }>,
): React.JSX.Element => <Kind className={ICON_CLASS} />;

/** Badge tones and select tones name the same five ideas differently. */
const SELECT_TONE_FOR_STATE: Record<StateTone, SelectTone> = {
  neutral: "neutral",
  progress: "info",
  good: "success",
  warn: "warning",
  bad: "danger",
};

/**
 * Options for any of the finding lifecycle vocabularies.
 *
 * Prior-art states keep their shield glyphs, because "nobody checked" and
 * "checked, nothing found" are the pair people most often read as each other
 * and the shields are the only thing that separates them at a glance.
 */
export function stateSelectOptions(
  kind: StateKind,
  values: readonly string[],
): SelectOption[] {
  return values.map((value) => {
    const tone = stateTone(kind, value);
    const Glyph =
      (kind === "priorArt"
        ? PRIOR_ART_ICON_KINDS[value as keyof typeof PRIOR_ART_ICON_KINDS]
        : undefined) ?? STATE_TONE_ICON_KINDS[tone];

    return {
      value,
      label: humaniseState(value),
      tone: SELECT_TONE_FOR_STATE[tone],
      icon: icon(Glyph),
    };
  });
}

const SEVERITY_TONES: Record<SeverityRating, SelectTone> = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  NONE: "neutral",
};

/**
 * Severity options.
 *
 * `NONE` is spelled out as "None (informational)" because on its own in a list
 * of severities it reads as "no severity chosen" rather than as the rating it
 * actually is.
 */
export function severitySelectOptions(
  values: readonly SeverityRating[],
): SelectOption[] {
  return values.map((value) => ({
    value,
    label: value === "NONE" ? "None (informational)" : humaniseState(value),
    tone: SEVERITY_TONES[value],
    icon: icon(SEVERITY_ICON_KINDS[value]),
  }));
}

const VISIBILITY_OPTIONS: Record<
  ContentVisibility,
  {
    label: string;
    description: string;
    tone: SelectTone;
    glyph: ComponentType<{ className?: string }>;
  }
> = {
  INTERNAL: {
    label: "Internal",
    description: "Never appears in a vendor or public report.",
    tone: "danger",
    glyph: Lock,
  },
  VENDOR: {
    label: "Vendor",
    description: "May appear in vendor and public reports.",
    tone: "warning",
    glyph: Building2,
  },
  PUBLIC: {
    label: "Public",
    description: "May appear in any report, including the public advisory.",
    tone: "success",
    glyph: Globe,
  },
};

/**
 * Visibility options.
 *
 * These always carry their description. Choosing the wrong one here is how
 * internal-only material ends up in a published advisory, and that is not a
 * mistake a tooltip somewhere else in the screen can be relied on to prevent.
 */
export function visibilitySelectOptions(
  values: readonly ContentVisibility[],
): SelectOption[] {
  return values.map((value) => {
    const entry = VISIBILITY_OPTIONS[value];

    return {
      value,
      label: entry.label,
      description: entry.description,
      tone: entry.tone,
      icon: icon(entry.glyph),
    };
  });
}

/**
 * Asset and artifact kinds.
 *
 * The glyphs come from the same maps the asset lists and evidence rows draw
 * from, rather than a second set defined here — picking "Firmware" and then
 * seeing a different firmware icon in the list you picked it for is the kind
 * of small wrongness nobody reports and everybody notices.
 */
export function assetKindSelectOptions(
  values: readonly AssetKind[],
): SelectOption[] {
  return values.map((value) => ({
    value,
    label: humaniseState(value),
    icon: assetKindIcon(value),
  }));
}

export function artifactKindSelectOptions(
  values: readonly ArtifactKind[],
): SelectOption[] {
  return values.map((value) => ({
    value,
    label: humaniseState(value),
    icon: artifactKindIcon(value),
  }));
}
