import { Sparkles } from "lucide-react";

import type { FindingSummary } from "@codevault/contracts";

import { cn } from "../lib/cn.js";
import { PriorArtBadge, SeverityBadge, StateBadge } from "./badges.js";
import { AssetKindIcon } from "./security.js";
import { Mono } from "./primitives.js";

/**
 * The finding header.
 *
 * Always shows the same eight facts: reference, title, severity, validation,
 * disclosure, affected asset, prior-art conclusion, and whether AI proposals
 * are waiting. It stays pinned while the researcher moves between tabs so that
 * "what state is this actually in?" is never more than a glance away.
 */

export interface FindingHeaderProps {
  finding: FindingSummary;
  className?: string;
  actions?: React.ReactNode;
}

export function FindingHeader({
  finding,
  className,
  actions,
}: FindingHeaderProps): React.JSX.Element {
  return (
    <header
      className={cn(
        "flex flex-col gap-2 border-b border-border bg-surface px-4 py-3",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Mono className="text-text-muted">{finding.ref}</Mono>
            <Mono className="text-text-muted">·</Mono>
            <Mono className="text-text-muted">{finding.caseRef}</Mono>
          </div>
          <h1 className="mt-0.5 truncate text-[15px] font-semibold leading-tight">
            {finding.title}
          </h1>
        </div>
        {actions}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <SeverityBadge severity={finding.severity} score={finding.score} />
        <StateBadge kind="validation" state={finding.validationState} />
        <StateBadge kind="remediation" state={finding.remediationState} />
        <StateBadge kind="disclosure" state={finding.disclosureState} />
        <PriorArtBadge state={finding.priorArtState} />

        {finding.primaryAsset === null ? (
          <span className="inline-flex items-center gap-1 rounded-(--cv-radius) border border-dashed border-border px-1.5 py-0.5 text-[11px] text-text-muted">
            No primary asset
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-(--cv-radius) border border-border bg-surface-raised px-1.5 py-0.5 text-[11px]">
            <AssetKindIcon kind={finding.primaryAsset.kind} />
            <span className="max-w-56 truncate">
              {finding.primaryAsset.name}
            </span>
            <Mono className="text-text-muted">
              {finding.primaryAsset.assetRef}
            </Mono>
          </span>
        )}

        {finding.pendingProposalCount > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-(--cv-radius) border border-accent/50 bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent">
            <Sparkles aria-hidden className="size-3" />
            {finding.pendingProposalCount} AI proposal
            {finding.pendingProposalCount === 1 ? "" : "s"} pending
          </span>
        ) : null}
      </div>
    </header>
  );
}
