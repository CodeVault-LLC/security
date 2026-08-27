import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Button } from "@codevault/ui";

interface CursorState {
  identity: string;
  cursors: Array<string | null>;
}

export function useCursorPagination(identity: string): {
  cursor: string | null;
  pageIndex: number;
  next: (cursor: string) => void;
  previous: () => void;
  reset: () => void;
} {
  const [state, setState] = useState<CursorState>({
    identity,
    cursors: [null],
  });
  const active =
    state.identity === identity
      ? state
      : { identity, cursors: [null] as Array<string | null> };

  return {
    cursor: active.cursors.at(-1) ?? null,
    pageIndex: active.cursors.length - 1,
    next: (cursor) => {
      setState((current) => {
        const cursors =
          current.identity === identity ? current.cursors : [null];
        return { identity, cursors: [...cursors, cursor] };
      });
    },
    previous: () => {
      setState((current) => ({
        identity,
        cursors: (current.identity === identity
          ? current.cursors
          : [null]
        ).slice(0, -1),
      }));
    },
    reset: () => setState({ identity, cursors: [null] }),
  };
}

export function CursorPagination({
  label,
  pageIndex,
  nextCursor,
  loading,
  onPrevious,
  onNext,
}: {
  label: string;
  pageIndex: number;
  nextCursor: string | null;
  loading: boolean;
  onPrevious: () => void;
  onNext: (cursor: string) => void;
}): React.JSX.Element | null {
  if (pageIndex === 0 && nextCursor === null) return null;

  return (
    <nav
      aria-label={`${label} pagination`}
      className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-t border-border bg-surface px-4 py-2"
    >
      <p className="text-[11px] tabular-nums text-text-muted">
        Page {pageIndex + 1}
      </p>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pageIndex === 0 || loading}
          onClick={onPrevious}
        >
          <ChevronLeft aria-hidden />
          Previous
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={nextCursor === null || loading}
          onClick={() => {
            if (nextCursor !== null) onNext(nextCursor);
          }}
        >
          Next
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
