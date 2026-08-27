import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { useRef, useState } from "react";

import type {
  CaseListResponse,
  OrganizationUserList,
} from "@codevault/contracts";
import { CASE_STATUSES } from "@codevault/core";
import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Mono,
  Select,
  StateBadge,
} from "@codevault/ui";

import { PageHeader } from "../components/app-shell.js";
import { Avatar } from "../components/avatar.js";
import { CreateCaseDialog } from "../features/cases/create-case-dialog.js";
import { ImportCaseArchiveButton } from "../features/cases/case-archive-actions.js";
import { formatDistanceToNowStrict } from "../lib/dates.js";
import { humanise } from "../lib/format.js";
import { errorHeading, queryKeys, useApiQuery } from "../lib/api.js";
import { canWrite, useSession } from "../lib/session.js";
import { useDebouncedValue } from "../hooks/use-debounced-value.js";

/**
 * The case list.
 *
 * Restricted cases the researcher is not on simply do not appear — the server
 * filters them out rather than showing a locked row, because the existence of
 * an embargoed case is itself information.
 */

const PAGE_SIZE = 50;

export function CasesRoute(): React.JSX.Element {
  const user = useSession((state) => state.user);
  const editable = canWrite(user);
  const [createOpen, setCreateOpen] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [ownerId, setOwnerId] = useState("ALL");
  const listRef = useRef<HTMLDivElement>(null);
  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  const users = useApiQuery<OrganizationUserList>(
    ["organization", "users"],
    "/v1/organization/users",
  );
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  params.set("page", String(pageIndex + 1));
  if (debouncedSearch.length > 0) params.set("query", debouncedSearch);
  if (status !== "ALL") params.set("status", status);
  if (ownerId !== "ALL") params.set("ownerId", ownerId);

  const cases = useApiQuery<CaseListResponse>(
    queryKeys.cases({
      limit: PAGE_SIZE,
      page: pageIndex + 1,
      query: debouncedSearch,
      status,
      ownerId,
    }),
    `/v1/cases?${params.toString()}`,
  );

  const items = cases.data?.items ?? [];
  const total = cases.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const resetPagination = (): void => {
    setPageIndex(0);
  };

  const goToPage = (nextPageIndex: number): void => {
    if (
      cases.isFetching ||
      nextPageIndex === pageIndex ||
      nextPageIndex < 0 ||
      nextPageIndex >= pageCount
    )
      return;

    setPageIndex(nextPageIndex);
    if (listRef.current !== null) listRef.current.scrollTop = 0;
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Cases"
        description="Research efforts, each with its own assets, findings and reports."
        actions={
          editable ? (
            <div className="flex items-start gap-2">
              <ImportCaseArchiveButton />
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus aria-hidden className="size-3.5" />
                New case
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-raised px-4 py-2">
        <label className="relative min-w-52 flex-1 sm:max-w-80">
          <span className="sr-only">Search cases</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted"
          />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              resetPagination();
            }}
            placeholder="Search by title or case reference"
            className="pl-9"
          />
        </label>
        <Select
          aria-label="Filter cases by status"
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            resetPagination();
          }}
          className="w-40"
          options={[
            { value: "ALL", label: "All statuses" },
            ...CASE_STATUSES.map((value) => ({
              value,
              label: humanise(value),
            })),
          ]}
        />
        <Select
          aria-label="Filter cases by owner"
          value={ownerId}
          onValueChange={(value) => {
            setOwnerId(value);
            resetPagination();
          }}
          className="w-48"
          options={[
            { value: "ALL", label: "All owners" },
            ...(users.data?.items ?? []).map((owner) => ({
              value: owner.id,
              label: owner.displayName,
            })),
          ]}
        />
        {cases.data === undefined ? null : (
          <p
            className="ml-auto shrink-0 px-1 text-[11px] tabular-nums text-text-muted"
            aria-live="polite"
          >
            {total.toLocaleString()} {total === 1 ? "case" : "cases"}
          </p>
        )}
      </div>

      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto"
        aria-busy={cases.isFetching || undefined}
      >
        {cases.error !== null ? (
          <ErrorState
            title={errorHeading(cases.error)}
            description={cases.error.message}
            action={
              <Button
                variant="secondary"
                size="sm"
                loading={cases.isFetching}
                onClick={() => void cases.refetch()}
              >
                Try again
              </Button>
            }
          />
        ) : cases.isLoading ? (
          <LoadingState label={`Loading page ${pageIndex + 1}…`} />
        ) : items.length === 0 ? (
          <EmptyState
            title={
              debouncedSearch.length > 0 ||
              status !== "ALL" ||
              ownerId !== "ALL"
                ? "No cases match these filters"
                : "No cases yet"
            }
            description={
              debouncedSearch.length > 0 ||
              status !== "ALL" ||
              ownerId !== "ALL"
                ? "Change or clear a filter to see more cases."
                : editable
                  ? "Start a case for one research effort. Findings, evidence, and audience-specific reports stay attached to it."
                  : "No cases are available to you. Restricted case names are hidden unless you are a member."
            }
            action={
              editable ? (
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  <Plus aria-hidden className="size-3.5" />
                  New case
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  to={`/cases/${item.id}`}
                  className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus lg:grid-cols-[8rem_minmax(14rem,1fr)_9rem_8rem_6rem_10rem_7rem] lg:items-center"
                >
                  <Mono className="text-text-muted max-lg:row-start-2">
                    {item.ref}
                  </Mono>
                  <span className="min-w-0 font-medium max-lg:col-span-2 max-lg:row-start-1 lg:col-start-2 lg:row-start-1">
                    <span className="break-words">{item.title}</span>
                    {item.restricted ? (
                      <span
                        className="ml-2 text-[11px] text-danger"
                        title="Visible only to named members."
                      >
                        Restricted
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[11px] text-text-muted max-lg:hidden">
                    {humanise(item.profile)}
                  </span>
                  <span className="max-lg:row-start-2">
                    <StateBadge kind="validation" state={item.status} />
                  </span>
                  <span className="text-[11px] text-text-muted max-lg:row-start-3 lg:text-right">
                    {item.findingCount} finding
                    {item.findingCount === 1 ? "" : "s"}
                  </span>
                  <Avatar
                    avatarId={null}
                    userId={item.owner.id}
                    label={item.owner.displayName}
                    size="sm"
                    showLabel
                    className="gap-1.5 max-lg:hidden"
                  />
                  <span className="text-right text-[11px] text-text-muted max-lg:row-start-3">
                    {formatDistanceToNowStrict(item.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {cases.data !== undefined && total > 0 ? (
        <CasePagination
          pageIndex={pageIndex}
          pageCount={pageCount}
          loading={cases.isFetching}
          onPageChange={goToPage}
        />
      ) : null}

      <CreateCaseDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function CasePagination({
  pageIndex,
  pageCount,
  loading,
  onPageChange,
}: {
  pageIndex: number;
  pageCount: number;
  loading: boolean;
  onPageChange: (pageIndex: number) => void;
}): React.JSX.Element {
  const pageItems = paginationItems(pageIndex, pageCount);

  return (
    <nav
      aria-label="Case pagination"
      className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-4 py-2"
    >
      <p className="text-[11px] tabular-nums text-text-muted">
        Page {pageIndex + 1} of {pageCount}
      </p>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pageIndex === 0 || loading}
          onClick={() => onPageChange(pageIndex - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft aria-hidden />
          <span className="hidden sm:inline">Previous</span>
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
        >
          <span className="hidden sm:inline">Next</span>
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
