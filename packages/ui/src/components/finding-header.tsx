import { Sparkles } from "lucide-react";

import type { FindingSummary } from "@codevault/contracts";

import { cn } from "../lib/cn.js";
import { SeverityBadge, StateBadge } from "./badges.js";
import { AssetKindIcon } from "./security.js";
import { Mono } from "./primitives.js";

/**
 * The finding header.
 *
 * The header keeps identity and the two highest-signal states visible. The
 * complete workflow state remains in the overview, where it can be changed
 * without turning the title area into a badge inventory.
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Mono className="text-text-muted">{finding.ref}</Mono>
            <Mono className="text-text-muted">·</Mono>
            <Mono className="text-text-muted">{finding.caseRef}</Mono>
          </div>
          <h1 className="mt-1 text-[18px] font-semibold leading-tight tracking-[-0.015em] text-balance">
            {finding.title}
          </h1>
        </div>
        {actions}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-text-muted">
        <SeverityBadge severity={finding.severity} score={finding.score} />
        <StateBadge kind="validation" state={finding.validationState} />

        {finding.primaryAsset === null ? (
          <span>No primary asset</span>
        ) : (
          <span className="inline-flex min-w-0 items-center gap-1">
            <AssetKindIcon kind={finding.primaryAsset.kind} />
            <span className="max-w-64 truncate text-text">
              {finding.primaryAsset.name}
            </span>
            <Mono className="text-text-muted">
              {finding.primaryAsset.assetRef}
            </Mono>
          </span>
        )}

        {finding.pendingProposalCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-accent">
            <Sparkles aria-hidden className="size-3" />
            {finding.pendingProposalCount} AI proposal
            {finding.pendingProposalCount === 1 ? "" : "s"} pending
          </span>
        ) : null}
      </div>
    </header>
  );
}
