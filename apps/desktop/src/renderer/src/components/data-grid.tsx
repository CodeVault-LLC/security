import type {
  HTMLAttributes,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";
import { forwardRef, useState } from "react";
import { CheckCircle2, Clock3 } from "lucide-react";

import { cn } from "@codevault/ui";

import {
  formatDateTime,
  formatDistanceToNowStrict,
  formatElapsedDuration,
} from "../lib/dates.js";

/**
 * Shared structure for the dense collection views in the desktop app.
 *
 * The route owns its filters and data. This component owns the frame, sticky
 * header, row rhythm, and scroll boundary so findings, cases, assets, and
 * vendors do not drift into four different table systems.
 */
export function DataGridFrame({
  className,
  ...props
}: HTMLAttributes<HTMLElement>): React.JSX.Element {
  return (
    <section
      className={cn(
        "mx-3 mb-3 mt-3 flex min-h-0 flex-1 flex-col overflow-hidden",
        "rounded-(--cv-radius-lg) border border-border-strong/80 bg-surface",
        "shadow-[0_8px_24px_oklch(0_0_0/0.08)]",
        className,
      )}
      {...props}
    />
  );
}

export function DataGridToolbar({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex min-h-13 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface-raised/35 px-3 py-2",
        className,
      )}
      {...props}
    />
  );
}

export const DataGridViewport = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function DataGridViewport({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn("min-h-0 flex-1 overflow-auto", className)}
      {...props}
    />
  );
});

export function DataGridTable({
  className,
  ...props
}: TableHTMLAttributes<HTMLTableElement>): React.JSX.Element {
  return (
    <table
      className={cn(
        "w-full border-separate border-spacing-0 text-left text-[12px]",
        className,
      )}
      {...props}
    />
  );
}

export function DataGridHeaderCell({
  className,
  scope = "col",
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>): React.JSX.Element {
  return (
    <th
      scope={scope}
      className={cn(
        "sticky top-0 z-10 h-10 border-b border-border-strong/70 bg-surface-raised",
        "px-3 text-[10.5px] font-semibold tracking-[0.01em] whitespace-nowrap text-text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function DataGridCell({
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>): React.JSX.Element {
  return (
    <td
      className={cn(
        "h-16 border-b border-border px-3 py-2.5 align-middle",
        "group-last/row:border-b-0",
        className,
      )}
      {...props}
    />
  );
}

export const dataGridRowClass = cn(
  "group/row relative transition-colors duration-100",
  "odd:bg-surface-raised/10 hover:bg-surface-hover focus-within:bg-surface-hover",
);

export const dataGridRowLinkClass = cn(
  "font-medium text-text outline-none",
  "after:absolute after:inset-0 after:content-['']",
  "focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-focus",
);

export function DataGridActivity({
  createdAt,
  updatedAt,
  complete = false,
}: {
  createdAt: string;
  updatedAt: string;
  complete?: boolean;
}): React.JSX.Element {
  const [renderedAt] = useState(Date.now);
  const updated = new Date(updatedAt).getTime();
  const age = Number.isNaN(updated)
    ? Number.POSITIVE_INFINITY
    : renderedAt - updated;
  const activityTone = complete
    ? "text-success"
    : age < 24 * 60 * 60 * 1000
      ? "text-success"
      : age < 7 * 24 * 60 * 60 * 1000
        ? "text-info"
        : age < 30 * 24 * 60 * 60 * 1000
          ? "text-warning"
          : "text-danger";

  return (
    <div
      className="flex min-w-28 flex-col gap-1 whitespace-nowrap"
      title={`Created ${formatDateTime(createdAt)}. Updated ${formatDateTime(updatedAt)}.`}
    >
      <span
        className={cn(
          "flex items-center gap-1.5 text-[11px] font-medium",
          activityTone,
        )}
      >
        {complete ? (
          <CheckCircle2 aria-hidden className="size-3.5" />
        ) : (
          <Clock3 aria-hidden className="size-3.5" />
        )}
        {complete ? "Completed" : "Updated"}{" "}
        {formatDistanceToNowStrict(updatedAt)}
      </span>
      <span className="pl-5 text-[10.5px] tabular-nums text-text-muted">
        {complete ? "Completed in" : "Open for"}{" "}
        {formatElapsedDuration(createdAt, complete ? updatedAt : renderedAt)}
      </span>
    </div>
  );
}
