import {
  Archive,
  ArrowLeftRight,
  Binary,
  Box,
  Boxes,
  Check,
  Cloud,
  Copy,
  Cpu,
  ExternalLink,
  FileCode2,
  FileText,
  GitBranch,
  Globe,
  HardDrive,
  Image as ImageIcon,
  Monitor,
  Network,
  Package,
  ScrollText,
  Server,
  Sparkles,
  Terminal,
  Video,
  Wrench,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import type {
  AiProposal,
  Artifact,
  SeverityTotals,
} from "@codevault/contracts";
import type { ArtifactKind, AssetKind, ReviewState } from "@codevault/core";
import { markdownToPlainText } from "@codevault/markdown/text";

import { cn } from "../lib/cn.js";
import { humaniseState, StateBadge, VisibilityBadge } from "./badges.js";
import type { ChartDatum } from "./charts.js";
import { Button, Card, Mono } from "./primitives.js";

/**
 * Security-domain components.
 *
 * These are the pieces feature code composes with. A finding page never styles
 * a hash or picks an icon for an asset kind itself, which is what keeps the
 * same value looking the same everywhere it appears.
 */

const ASSET_KIND_ICONS: Record<AssetKind, ReactNode> = {
  SOFTWARE_COMPONENT: <Package aria-hidden className="size-3.5" />,
  APPLICATION: <Monitor aria-hidden className="size-3.5" />,
  SERVICE: <Server aria-hidden className="size-3.5" />,
  API: <Globe aria-hidden className="size-3.5" />,
  DEVICE: <Cpu aria-hidden className="size-3.5" />,
  FIRMWARE: <Binary aria-hidden className="size-3.5" />,
  HARDWARE: <HardDrive aria-hidden className="size-3.5" />,
  HOST_SYSTEM: <Server aria-hidden className="size-3.5" />,
  CLOUD_RESOURCE: <Cloud aria-hidden className="size-3.5" />,
  NETWORK_SERVICE: <Network aria-hidden className="size-3.5" />,
  REPOSITORY: <GitBranch aria-hidden className="size-3.5" />,
  CONTAINER_IMAGE: <Boxes aria-hidden className="size-3.5" />,
};

/**
 * The bare glyph for an asset kind.
 *
 * Exported so the picker that sets a kind and the lists that show it afterwards
 * draw the same thing. Callers that want it announced should use
 * `AssetKindIcon`, which wraps this in a labelled element.
 */
export function assetKindIcon(kind: AssetKind): ReactNode {
  return ASSET_KIND_ICONS[kind] ?? <Box aria-hidden className="size-3.5" />;
}

export function AssetKindIcon({
  kind,
  className,
}: {
  kind: AssetKind;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      className={cn("inline-flex text-text-muted", className)}
      title={humaniseState(kind)}
      aria-label={humaniseState(kind)}
      role="img"
    >
      {assetKindIcon(kind)}
    </span>
  );
}

/**
 * Severity as chart segments, in descending order.
 *
 * Lives here rather than in `charts.tsx` because it is a domain decision: the
 * chart layer takes numbers and colour tokens and knows nothing about what
 * critical means. Defined once so the dashboard, the metrics page and both
 * asset views cannot drift into three different orderings of the same six
 * numbers.
 *
 * A caution for whoever edits the severity tokens next. Critical and high are
 * both reds, measured ΔE 8.4 apart in light and 8.8 in dark — under the 15
 * floor at which adjacent fills stay comfortably distinguishable. They are fine
 * in badges, which are separated and captioned, but in a stacked bar they
 * touch. That is why `StackedBar` will not render a multi-segment bar without
 * either a legend or an explicit description.
 */
export function severityChartSegments(
  totals: SeverityTotals,
): readonly ChartDatum[] {
  return [
    {
      key: "critical",
      label: "Critical",
      value: totals.critical,
      color: "--cv-severity-critical",
    },
    {
      key: "high",
      label: "High",
      value: totals.high,
      color: "--cv-severity-high",
    },
    {
      key: "medium",
      label: "Medium",
      value: totals.medium,
      color: "--cv-severity-medium",
    },
    { key: "low", label: "Low", value: totals.low, color: "--cv-severity-low" },
    {
      key: "none",
      label: "None",
      value: totals.none,
      color: "--cv-severity-info",
    },
    {
      key: "unscored",
      label: "Unscored",
      value: totals.unscored,
      color: "--cv-border-strong",
    },
  ];
}

const ARTIFACT_KIND_ICONS: Record<ArtifactKind, ReactNode> = {
  SCREENSHOT: <ImageIcon aria-hidden className="size-3.5" />,
  IMAGE: <ImageIcon aria-hidden className="size-3.5" />,
  HTTP_CAPTURE: <ArrowLeftRight aria-hidden className="size-3.5" />,
  HAR: <ArrowLeftRight aria-hidden className="size-3.5" />,
  PCAP: <Network aria-hidden className="size-3.5" />,
  SOURCE_CODE: <FileCode2 aria-hidden className="size-3.5" />,
  BINARY: <Binary aria-hidden className="size-3.5" />,
  FIRMWARE: <Binary aria-hidden className="size-3.5" />,
  DOCUMENT: <FileText aria-hidden className="size-3.5" />,
  POC: <Wrench aria-hidden className="size-3.5" />,
  ARCHIVE: <Archive aria-hidden className="size-3.5" />,
  LOG: <ScrollText aria-hidden className="size-3.5" />,
  TERMINAL_OUTPUT: <Terminal aria-hidden className="size-3.5" />,
  VIDEO: <Video aria-hidden className="size-3.5" />,
  OTHER: <FileText aria-hidden className="size-3.5" />,
};

/**
 * The glyph for an evidence artifact.
 *
 * The map is total rather than partial: an evidence list and the kind picker
 * both walk the whole vocabulary, and a kind that silently fell through to a
 * generic document icon in both places was indistinguishable from one nobody
 * had thought about.
 */
export function artifactKindIcon(kind: ArtifactKind): ReactNode {
  return ARTIFACT_KIND_ICONS[kind];
}

/**
 * A file digest.
 *
 * Truncated for reading, complete on copy: the point of showing a hash is that
 * someone can compare it with what they received, so the full value has to be
 * one click away.
 */
export function HashValue({
  value,
  algorithm = "sha256",
  className,
}: {
  value: string;
  algorithm?: string;
  className?: string;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span className="text-[11px] uppercase text-text-muted">{algorithm}</span>
      <Mono className="text-text-muted" title={value}>
        {value.slice(0, 12)}…{value.slice(-6)}
      </Mono>
      <Button
        variant="ghost"
        size="icon"
        className="size-5"
        onClick={() => void copy()}
        aria-label={`Copy the full ${algorithm} digest`}
      >
        {copied ? (
          <Check aria-hidden className="size-3 text-success" />
        ) : (
          <Copy aria-hidden className="size-3" />
        )}
      </Button>
    </span>
  );
}

export function ReferenceLink({
  title,
  url,
  publisher,
  onOpen,
  className,
}: {
  title: string;
  url: string;
  publisher?: string | null;
  /** Opening happens through the desktop bridge, never a bare anchor. */
  onOpen: (url: string) => void;
  className?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onOpen(url)}
      className={cn(
        "group flex w-full items-start gap-2 rounded-(--cv-radius) px-2 py-1.5 text-left",
        "hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus",
        className,
      )}
    >
      <ExternalLink
        aria-hidden
        className="mt-0.5 size-3.5 shrink-0 text-text-muted"
      />
      <span className="min-w-0">
        <span className="block truncate text-[13px] text-text group-hover:underline">
          {title}
        </span>
        <span className="block truncate text-[11px] text-text-muted">
          {publisher === null || publisher === undefined
            ? url
            : `${publisher} · ${url}`}
        </span>
      </span>
    </button>
  );
}

export interface EvidenceCardProps {
  reference: string;
  title: string;
  description?: string | null;
  visibility: "INTERNAL" | "VENDOR" | "PUBLIC";
  artifacts: readonly Artifact[];
  capturedAt?: string | null;
  onOpenArtifact?: (artifactId: string) => void;
  className?: string;
}

export function EvidenceCard({
  reference,
  title,
  description,
  visibility,
  artifacts,
  capturedAt,
  onOpenArtifact,
  className,
}: EvidenceCardProps): React.JSX.Element {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="flex items-start justify-between gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Mono className="text-text-muted">{reference}</Mono>
            <span className="truncate text-[13px] font-medium">{title}</span>
          </div>
          {description === null || description === undefined ? null : (
            // Stripped rather than rendered: this is a two-line summary, and a
            // description that opens with a table or a diagram would other-
            // wise arrive as a wall of pipes.
            <p className="mt-0.5 line-clamp-2 text-[12px] text-text-muted">
              {markdownToPlainText(description)}
            </p>
          )}
        </div>
        <VisibilityBadge visibility={visibility} />
      </div>

      <ul className="divide-y divide-border">
        {artifacts.map((artifact) => (
          <li
            key={artifact.id}
            className="flex items-center gap-2 px-3 py-1.5 text-[12px]"
          >
            <span className="text-text-muted">
              {artifactKindIcon(artifact.artifactKind)}
            </span>
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left hover:underline"
              onClick={() => onOpenArtifact?.(artifact.id)}
              disabled={onOpenArtifact === undefined}
            >
              {artifact.filename}
            </button>
            <span className="shrink-0 text-text-muted">
              {formatBytes(artifact.sizeBytes)}
            </span>
            <HashValue value={artifact.sha256} className="shrink-0" />
          </li>
        ))}
      </ul>

      {capturedAt === null || capturedAt === undefined ? null : (
        <div className="border-t border-border px-3 py-1.5 text-[11px] text-text-muted">
          Captured {capturedAt.slice(0, 19).replace("T", " ")} UTC
        </div>
      )}
    </Card>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function ApprovalState({
  state,
  approvedBy,
  approvedAt,
  className,
}: {
  state: ReviewState;
  approvedBy?: string | null;
  approvedAt?: string | null;
  className?: string;
}): React.JSX.Element {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <StateBadge kind="review" state={state} />
      {state === "APPROVED" &&
      approvedBy !== null &&
      approvedBy !== undefined ? (
        <span className="text-[11px] text-text-muted">
          by {approvedBy}
          {approvedAt === null || approvedAt === undefined
            ? ""
            : ` on ${approvedAt.slice(0, 10)}`}
        </span>
      ) : null}
    </span>
  );
}

export function ReportSectionStatus({
  title,
  state,
  required,
  hasContent,
  active,
  onSelect,
}: {
  title: string;
  state: ReviewState;
  required: boolean;
  hasContent: boolean;
  active: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-(--cv-radius) px-2 py-1 text-left text-[12px]",
        active
          ? "bg-surface-hover text-text"
          : "text-text-muted hover:bg-surface-hover",
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            state === "APPROVED" || state === "LOCKED"
              ? "bg-success"
              : state === "NEEDS_REVIEW" || state === "AI_DRAFT"
                ? "bg-warning"
                : hasContent
                  ? "bg-info"
                  : "bg-border-strong",
          )}
        />
        <span className="truncate">{title}</span>
      </span>
      {required && !hasContent ? (
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-danger">
          Required
        </span>
      ) : null}
    </button>
  );
}

export interface AiProposalPanelProps {
  proposal: AiProposal;
  /** Current value of each field the patch would change. */
  currentValues: Record<string, unknown>;
  onAccept: () => void;
  onReject: () => void;
  onEdit?: () => void;
  busy?: boolean;
  className?: string;
}

/**
 * An AI proposal awaiting review.
 *
 * Shows what would change, field by field, alongside the model's reasoning.
 * Accept, Edit and Reject are equally weighted on purpose: accepting is not the
 * default action, it is one of three.
 */
export function AiProposalPanel({
  proposal,
  currentValues,
  onAccept,
  onReject,
  onEdit,
  busy = false,
  className,
}: AiProposalPanelProps): React.JSX.Element {
  const fields = Object.entries(proposal.patch);

  return (
    <Card className={cn("border-accent/40", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="flex items-center gap-1.5 text-[12px] font-medium">
          <Sparkles aria-hidden className="size-3.5 text-accent" />
          AI proposal
          <Mono className="text-text-muted">{proposal.action}</Mono>
        </span>
        <span className="text-[11px] text-text-muted">
          against revision {proposal.baseRevision}
        </span>
      </div>

      <div className="divide-y divide-border">
        {fields.map(([field, proposed]) => (
          <div key={field} className="grid grid-cols-2 gap-3 p-3 text-[12px]">
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-text-muted">
                Current · {field}
              </p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-(--cv-radius) bg-surface-raised p-2 font-sans text-text-muted">
                {formatValue(currentValues[field])}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-accent">
                Proposed · {field}
              </p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-(--cv-radius) bg-accent/8 p-2 font-sans">
                {formatValue(proposed)}
              </pre>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-border p-3">
        <p className="mb-1 text-[11px] uppercase tracking-wide text-text-muted">
          Reasoning
        </p>
        <div className="max-h-56 overflow-auto whitespace-pre-wrap text-[12px] text-text-muted">
          {proposal.rationaleMarkdown}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
        <Button variant="danger" size="sm" onClick={onReject} disabled={busy}>
          <X aria-hidden className="size-3" />
          Reject
        </Button>
        {onEdit === undefined ? null : (
          <Button
            variant="secondary"
            size="sm"
            onClick={onEdit}
            disabled={busy}
          >
            Edit proposal
          </Button>
        )}
        <Button variant="primary" size="sm" onClick={onAccept} disabled={busy}>
          <Check aria-hidden className="size-3" />
          Accept
        </Button>
      </div>
    </Card>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}
