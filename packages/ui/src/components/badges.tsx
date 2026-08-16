import { cva, type VariantProps } from "class-variance-authority";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleHelp,
  Info,
  Lock,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Users,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import type {
  DisclosureState,
  PriorArtState,
  RemediationState,
  ReviewState,
  ValidationState,
} from "@codevault/core";
import {
  TLP_DEFINITIONS,
  type SeverityRating,
  type TlpLabel,
} from "@codevault/standards";

import { cn } from "../lib/cn.js";

/**
 * Semantic badges.
 *
 * Every badge shows an icon and a word, not just a colour. A researcher
 * screenshots these into vendor emails and prints them into reports, where
 * colour is the first thing to be lost.
 */

const badgeBase =
  "inline-flex items-center gap-1 rounded-(--cv-radius) border px-1.5 py-0.5 " +
  "text-[11px] font-medium leading-4 whitespace-nowrap";

const severityStyles: Record<SeverityRating, string> = {
  CRITICAL:
    "border-severity-critical/50 bg-severity-critical/12 text-severity-critical",
  HIGH: "border-severity-high/50 bg-severity-high/12 text-severity-high",
  MEDIUM:
    "border-severity-medium/50 bg-severity-medium/12 text-severity-medium",
  LOW: "border-severity-low/50 bg-severity-low/12 text-severity-low",
  NONE: "border-severity-info/50 bg-severity-info/12 text-severity-info",
};

/**
 * The glyph for each severity.
 *
 * Exported because a severity has to look the same wherever it is chosen or
 * shown — the badge in a findings row and the option in the severity picker
 * that sets it are the same statement about the same finding.
 */
export const SEVERITY_ICON_KINDS: Record<
  SeverityRating,
  ComponentType<{ className?: string }>
> = {
  CRITICAL: AlertOctagon,
  HIGH: AlertTriangle,
  MEDIUM: AlertTriangle,
  LOW: Info,
  NONE: Info,
};

const severityIcons: Record<SeverityRating, ReactNode> = {
  CRITICAL: <AlertOctagon aria-hidden className="size-3" />,
  HIGH: <AlertTriangle aria-hidden className="size-3" />,
  MEDIUM: <AlertTriangle aria-hidden className="size-3" />,
  LOW: <Info aria-hidden className="size-3" />,
  NONE: <Info aria-hidden className="size-3" />,
};

export interface SeverityBadgeProps {
  severity: SeverityRating | null;
  /** Numeric score shown beside the rating, when one has been approved. */
  score?: number | null;
  className?: string;
}

export function SeverityBadge({
  severity,
  score,
  className,
}: SeverityBadgeProps): React.JSX.Element {
  if (severity === null) {
    return (
      <span
        className={cn(
          badgeBase,
          "border-border bg-surface-raised text-text-muted",
          className,
        )}
        title="No approved score yet"
      >
        <CircleDashed aria-hidden className="size-3" />
        Unscored
      </span>
    );
  }

  return (
    <span
      className={cn(badgeBase, severityStyles[severity], className)}
      title={
        score === null || score === undefined
          ? severity
          : `${severity} (${score.toFixed(1)})`
      }
    >
      {severityIcons[severity]}
      {severity}
      {score === null || score === undefined ? null : (
        <span className="font-mono tabular-nums">{score.toFixed(1)}</span>
      )}
    </span>
  );
}

const tlpStyles: Record<TlpLabel, string> = {
  "TLP:RED": "border-tlp-red bg-tlp-red/12 text-tlp-red",
  "TLP:AMBER+STRICT": "border-tlp-amber bg-tlp-amber/12 text-tlp-amber",
  "TLP:AMBER": "border-tlp-amber bg-tlp-amber/12 text-tlp-amber",
  "TLP:GREEN": "border-tlp-green bg-tlp-green/12 text-tlp-green",
  "TLP:CLEAR": "border-tlp-clear bg-tlp-clear/12 text-tlp-clear",
};

export function TlpBadge({
  label,
  className,
}: {
  label: TlpLabel;
  className?: string;
}): React.JSX.Element {
  const definition = TLP_DEFINITIONS[label];

  return (
    <span
      className={cn(
        badgeBase,
        // Sans, like every other badge. TLP labels are designations, not code,
        // and a monospace badge beside a sans severity badge reads as a
        // different kind of thing when it is the same kind of thing.
        "uppercase tracking-wide",
        tlpStyles[label],
        className,
      )}
      title={definition.sharingRule}
    >
      <Lock aria-hidden className="size-3" />
      {label}
    </span>
  );
}

const stateBadgeVariants = cva(badgeBase, {
  variants: {
    tone: {
      neutral: "border-border bg-surface-raised text-text-muted",
      progress: "border-info/40 bg-info/10 text-info",
      good: "border-success/40 bg-success/10 text-success",
      warn: "border-warning/45 bg-warning/12 text-warning",
      bad: "border-danger/45 bg-danger/12 text-danger",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export type StateTone = NonNullable<
  VariantProps<typeof stateBadgeVariants>["tone"]
>;

const VALIDATION_TONES: Record<ValidationState, StateTone> = {
  DRAFT: "neutral",
  REPRODUCED: "progress",
  PEER_REVIEWED: "progress",
  CONFIRMED: "good",
  DISPUTED: "warn",
  INVALID: "bad",
};

const REMEDIATION_TONES: Record<RemediationState, StateTone> = {
  UNKNOWN: "neutral",
  UNFIXED: "warn",
  FIX_PROPOSED: "progress",
  FIX_AVAILABLE: "progress",
  FIXED: "good",
  FIX_VERIFIED: "good",
  REGRESSED: "bad",
  NOT_APPLICABLE: "neutral",
};

const DISCLOSURE_TONES: Record<DisclosureState, StateTone> = {
  PRIVATE: "neutral",
  CONTACT_PREPARED: "neutral",
  VENDOR_CONTACTED: "progress",
  ACKNOWLEDGED: "progress",
  COORDINATING: "progress",
  EMBARGOED: "warn",
  PUBLIC: "good",
};

/**
 * Prior-art tones.
 *
 * `HUMAN_CONFIRMED_NOVEL` is styled as a strong positive because a person put
 * their name to it; `NO_PRIOR_ART_FOUND` is deliberately neutral, because it
 * only means the checked sources came back empty on a given day.
 */
const PRIOR_ART_TONES: Record<PriorArtState, StateTone> = {
  UNCHECKED: "neutral",
  NO_PRIOR_ART_FOUND: "progress",
  POSSIBLE_MATCH: "warn",
  LIKELY_KNOWN: "warn",
  CONFIRMED_KNOWN: "bad",
  HUMAN_CONFIRMED_NOVEL: "good",
};

const REVIEW_TONES: Record<ReviewState, StateTone> = {
  NOT_WRITTEN: "neutral",
  AI_DRAFT: "warn",
  RESEARCHER_EDITED: "progress",
  NEEDS_REVIEW: "warn",
  APPROVED: "good",
  LOCKED: "good",
};

export type StateKind =
  "validation" | "remediation" | "disclosure" | "priorArt" | "review";

const TONE_LOOKUP: Record<StateKind, Record<string, StateTone>> = {
  validation: VALIDATION_TONES,
  remediation: REMEDIATION_TONES,
  disclosure: DISCLOSURE_TONES,
  priorArt: PRIOR_ART_TONES,
  review: REVIEW_TONES,
};

export const STATE_TONE_ICON_KINDS: Record<
  StateTone,
  ComponentType<{ className?: string }>
> = {
  neutral: CircleDashed,
  progress: CircleHelp,
  good: CheckCircle2,
  warn: AlertTriangle,
  bad: AlertOctagon,
};

const STATE_ICONS: Record<StateTone, ReactNode> = {
  neutral: <CircleDashed aria-hidden className="size-3" />,
  progress: <CircleHelp aria-hidden className="size-3" />,
  good: <CheckCircle2 aria-hidden className="size-3" />,
  warn: <AlertTriangle aria-hidden className="size-3" />,
  bad: <AlertOctagon aria-hidden className="size-3" />,
};

/**
 * The tone a state carries, for anything that has to colour-match a badge
 * without being one — the option rows in the picker that sets the state, for
 * instance. Unknown states fall back to neutral rather than throwing, because
 * a state added to the vocabulary should degrade to "uncoloured", not to a
 * blank screen.
 */
export function stateTone(kind: StateKind, state: string): StateTone {
  return TONE_LOOKUP[kind][state] ?? "neutral";
}

/**
 * Domain words that are acronyms, and so keep their case.
 *
 * Without this `AI_DRAFT` reads as "Ai draft" and the `API` asset kind as
 * "Api", both of which appear in badges and in the icon labels a screen
 * reader announces. The list grew when the pickers started humanising their
 * options too: "Cve requested" and "Http capture" are the same mistake as
 * "Ai draft", they were just hidden behind raw `SCREAMING_CASE` before.
 */
const ACRONYMS = new Set([
  "ai",
  "api",
  "cert",
  "cna",
  "cve",
  "cwe",
  "cvss",
  "har",
  "http",
  "id",
  "pcap",
  "poc",
  "tlp",
  "url",
]);

const humaniseWord = (word: string): string =>
  ACRONYMS.has(word) ? word.toUpperCase() : word;

/** Turns `PEER_REVIEWED` into `Peer reviewed`, and `AI_DRAFT` into `AI draft`. */
export function humaniseState(state: string): string {
  const words = state.toLowerCase().split("_");
  const [first, ...rest] = words;

  if (first === undefined) {
    return state;
  }

  const head = ACRONYMS.has(first)
    ? first.toUpperCase()
    : first.charAt(0).toUpperCase() + first.slice(1);

  return [head, ...rest.map(humaniseWord)].join(" ");
}

export function StateBadge({
  kind,
  state,
  className,
  title,
}: {
  kind: StateKind;
  state: string;
  className?: string;
  title?: string;
}): React.JSX.Element {
  const tone = TONE_LOOKUP[kind][state] ?? "neutral";

  return (
    <span
      className={cn(stateBadgeVariants({ tone }), className)}
      title={title ?? humaniseState(state)}
    >
      {STATE_ICONS[tone]}
      {humaniseState(state)}
    </span>
  );
}

export const PRIOR_ART_ICON_KINDS: Partial<
  Record<PriorArtState, ComponentType<{ className?: string }>>
> = {
  UNCHECKED: ShieldQuestion,
  NO_PRIOR_ART_FOUND: ShieldCheck,
  CONFIRMED_KNOWN: ShieldAlert,
  HUMAN_CONFIRMED_NOVEL: ShieldCheck,
};

const PRIOR_ART_ICONS: Partial<Record<PriorArtState, ReactNode>> = {
  UNCHECKED: <ShieldQuestion aria-hidden className="size-3" />,
  NO_PRIOR_ART_FOUND: <ShieldCheck aria-hidden className="size-3" />,
  CONFIRMED_KNOWN: <ShieldAlert aria-hidden className="size-3" />,
  HUMAN_CONFIRMED_NOVEL: <ShieldCheck aria-hidden className="size-3" />,
};

/**
 * Prior-art badge.
 *
 * The tooltip states what each conclusion actually means. "No prior art found"
 * is the phrase most easily over-read, so it says so explicitly.
 */
export function PriorArtBadge({
  state,
  className,
}: {
  state: PriorArtState;
  className?: string;
}): React.JSX.Element {
  const tone = PRIOR_ART_TONES[state];
  const explanations: Record<PriorArtState, string> = {
    UNCHECKED: "Nobody has checked whether this is already known.",
    NO_PRIOR_ART_FOUND:
      "The sources that were checked returned no convincing match on the date of the check.",
    POSSIBLE_MATCH: "A candidate exists that may describe the same issue.",
    LIKELY_KNOWN: "This probably matches an already-published vulnerability.",
    CONFIRMED_KNOWN: "This is an already-published vulnerability.",
    HUMAN_CONFIRMED_NOVEL:
      "A researcher reviewed the evidence and recorded this as novel.",
  };

  return (
    <span
      className={cn(stateBadgeVariants({ tone }), className)}
      title={explanations[state]}
    >
      {PRIOR_ART_ICONS[state] ?? STATE_ICONS[tone]}
      {humaniseState(state)}
    </span>
  );
}

export function VisibilityBadge({
  visibility,
  className,
}: {
  visibility: "INTERNAL" | "VENDOR" | "PUBLIC";
  className?: string;
}): React.JSX.Element {
  const tones: Record<string, StateTone> = {
    INTERNAL: "bad",
    VENDOR: "warn",
    PUBLIC: "good",
  };

  const explanations: Record<string, string> = {
    INTERNAL: "Internal only. Never included in a vendor or public report.",
    VENDOR: "May appear in vendor and public reports.",
    PUBLIC: "May appear in any report, including the public advisory.",
  };

  return (
    <span
      className={cn(stateBadgeVariants({ tone: tones[visibility] }), className)}
      title={explanations[visibility]}
    >
      <Users aria-hidden className="size-3" />
      {humaniseState(visibility)}
    </span>
  );
}
