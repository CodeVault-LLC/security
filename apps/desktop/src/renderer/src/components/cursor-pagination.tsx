import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Button, Select } from "@codevault/ui";

const PAGE_SIZE_OPTIONS = [25, 50, 100].map((size) => ({
  value: String(size),
  label: String(size),
}));

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
  itemCount,
  pageSize,
  nextCursor,
  loading,
  onPageSizeChange,
  onPrevious,
  onNext,
}: {
  label: string;
  pageIndex: number;
  itemCount: number;
  pageSize: number;
  nextCursor: string | null;
  loading: boolean;
  onPageSizeChange: (pageSize: number) => void;
  onPrevious: () => void;
  onNext: (cursor: string) => void;
}): React.JSX.Element {
  const firstItem = itemCount === 0 ? 0 : pageIndex * pageSize + 1;
  const lastItem = pageIndex * pageSize + itemCount;

  return (
    <nav
      aria-label={`${label} pagination`}
      className="flex min-h-13 shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-raised/35 px-3 py-2"
    >
      <div className="flex items-center gap-2 text-[11px] text-text-muted">
        <span>Rows per page</span>
        <Select
          aria-label={`${label} rows per page`}
          value={String(pageSize)}
          onValueChange={(value) => onPageSizeChange(Number(value))}
          options={PAGE_SIZE_OPTIONS}
          disabled={loading}
          className="h-8 w-18 tabular-nums"
          contentClassName="min-w-18"
        />
      </div>
      <p className="ml-auto text-[11px] tabular-nums text-text-muted">
        {firstItem.toLocaleString()}–{lastItem.toLocaleString()}
        <span className="mx-1.5 text-border-strong" aria-hidden>
          ·
        </span>
        Page {pageIndex + 1}
      </p>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pageIndex === 0 || loading}
          onClick={onPrevious}
          aria-label="Previous page"
          className="size-8 px-0"
        >
          <ChevronLeft aria-hidden />
        </Button>
        <span
          aria-current="page"
          className="flex size-8 items-center justify-center rounded-(--cv-radius) bg-surface-raised text-[11px] font-medium tabular-nums"
        >
          {pageIndex + 1}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={nextCursor === null || loading}
          aria-label="Next page"
          className="size-8 px-0"
          onClick={() => {
            if (nextCursor !== null) onNext(nextCursor);
          }}
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </nav>
  );
}

export function NumberedPagination({
  label,
  pageIndex,
  pageCount,
  itemCount,
  totalItems,
  pageSize,
  loading,
  onPageSizeChange,
  onPageChange,
}: {
  label: string;
  pageIndex: number;
  pageCount: number;
  itemCount: number;
  totalItems: number;
  pageSize: number;
  loading: boolean;
  onPageSizeChange: (pageSize: number) => void;
  onPageChange: (pageIndex: number) => void;
}): React.JSX.Element {
  const pageItems = paginationItems(pageIndex, pageCount);
  const firstItem = itemCount === 0 ? 0 : pageIndex * pageSize + 1;
  const lastItem = pageIndex * pageSize + itemCount;

  return (
    <nav
      aria-label={`${label} pagination`}
      className="flex min-h-13 shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-raised/35 px-3 py-2"
    >
      <div className="flex items-center gap-2 text-[11px] text-text-muted">
        <span>Rows per page</span>
        <Select
          aria-label={`${label} rows per page`}
          value={String(pageSize)}
          onValueChange={(value) => onPageSizeChange(Number(value))}
          options={PAGE_SIZE_OPTIONS}
          disabled={loading}
          className="h-8 w-18 tabular-nums"
          contentClassName="min-w-18"
        />
      </div>
      <p className="ml-auto text-[11px] tabular-nums text-text-muted">
        {firstItem.toLocaleString()}–{lastItem.toLocaleString()} of{" "}
        {totalItems.toLocaleString()}
        <span className="mx-1.5 text-border-strong" aria-hidden>
          ·
        </span>
        <span>
          Page {pageIndex + 1} of {pageCount}
        </span>
      </p>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pageIndex === 0 || loading}
          onClick={() => onPageChange(pageIndex - 1)}
          aria-label="Previous page"
          className="size-8 px-0"
        >
          <ChevronLeft aria-hidden />
        </Button>
        <div
          role="group"
          className="flex items-center gap-0.5"
          aria-label="Pages"
        >
          {pageItems.map((item) =>
            typeof item === "number" ? (
              <Button
                key={item}
                type="button"
                variant={item === pageIndex ? "primary" : "ghost"}
                size="sm"
                className="min-w-8 px-2 tabular-nums"
                aria-label={`Page ${item + 1}`}
                aria-current={item === pageIndex ? "page" : undefined}
                disabled={loading}
                onClick={() => onPageChange(item)}
              >
                {item + 1}
              </Button>
            ) : (
              <span
                key={item}
                aria-hidden
                className="flex size-8 items-center justify-center text-[12px] text-text-muted"
              >
                …
              </span>
            ),
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pageIndex >= pageCount - 1 || loading}
          onClick={() => onPageChange(pageIndex + 1)}
          aria-label="Next page"
          className="size-8 px-0"
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </nav>
  );
}

function paginationItems(
  pageIndex: number,
  pageCount: number,
): (number | "ellipsis-start" | "ellipsis-end")[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index);
  }

  const visible = new Set([0, pageCount - 1]);
  for (
    let index = Math.max(0, pageIndex - 1);
    index <= Math.min(pageCount - 1, pageIndex + 1);
    index += 1
  ) {
    visible.add(index);
  }

  if (pageIndex <= 2) {
    visible.add(1);
    visible.add(2);
    visible.add(3);
  }
  if (pageIndex >= pageCount - 3) {
    visible.add(pageCount - 2);
    visible.add(pageCount - 3);
    visible.add(pageCount - 4);
  }

  const pages = [...visible].sort((left, right) => left - right);
  const items: (number | "ellipsis-start" | "ellipsis-end")[] = [];

  pages.forEach((page, index) => {
    const previous = pages[index - 1];
    if (previous !== undefined && page - previous > 1) {
      items.push(index === 1 ? "ellipsis-start" : "ellipsis-end");
    }
    items.push(page);
  });

  return items;
}
