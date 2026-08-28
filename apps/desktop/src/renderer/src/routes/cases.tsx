import { keepPreviousData } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Archive,
  CheckCircle2,
  CircleDot,
  Layers3,
  Lock,
  Megaphone,
  PauseCircle,
  Plus,
  Search,
  ShieldAlert,
} from "lucide-react";
import { useRef, useState } from "react";

import type {
  CaseListResponse,
  CaseSummary,
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
  cn,
} from "@codevault/ui";

import { PageHeader } from "../components/app-shell.js";
import {
  DataGridCell,
  DataGridActivity,
  DataGridFrame,
  DataGridHeaderCell,
  DataGridTable,
  DataGridToolbar,
  DataGridViewport,
  dataGridRowClass,
  dataGridRowLinkClass,
} from "../components/data-grid.js";
import { NumberedPagination } from "../components/cursor-pagination.js";
import { Avatar } from "../components/avatar.js";
import { CreateCaseDialog } from "../features/cases/create-case-dialog.js";
import { ImportCaseArchiveButton } from "../features/cases/case-archive-actions.js";
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

const DEFAULT_PAGE_SIZE = 50;

export function CasesRoute(): React.JSX.Element {
  const user = useSession((state) => state.user);
  const editable = canWrite(user);
  const [createOpen, setCreateOpen] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [ownerId, setOwnerId] = useState("ALL");
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const listRef = useRef<HTMLDivElement>(null);
  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  const users = useApiQuery<OrganizationUserList>(
    ["organization", "users"],
    "/v1/organization/users",
  );
  const params = new URLSearchParams({ limit: String(pageSize) });
  params.set("page", String(pageIndex + 1));
  if (debouncedSearch.length > 0) params.set("query", debouncedSearch);
  if (status !== "ALL") params.set("status", status);
  if (ownerId !== "ALL") params.set("ownerId", ownerId);

  const cases = useApiQuery<CaseListResponse>(
    queryKeys.cases({
      limit: pageSize,
      page: pageIndex + 1,
      query: debouncedSearch,
      status,
      ownerId,
    }),
    `/v1/cases?${params.toString()}`,
    { placeholderData: keepPreviousData },
  );

  const items = cases.data?.items ?? [];
  const total = cases.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

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

      <DataGridFrame aria-label="Cases table">
        <DataGridToolbar>
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
        </DataGridToolbar>

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
          <>
            <DataGridViewport
              ref={listRef}
              aria-busy={cases.isFetching || undefined}
            >
              <DataGridTable className="min-w-[1060px]">
                <thead>
                  <tr>
                    <DataGridHeaderCell>Case</DataGridHeaderCell>
                    <DataGridHeaderCell className="w-32">
                      Status
                    </DataGridHeaderCell>
                    <DataGridHeaderCell className="w-52">
                      Profile
                    </DataGridHeaderCell>
                    <DataGridHeaderCell className="w-48">
                      Scope
                    </DataGridHeaderCell>
                    <DataGridHeaderCell className="w-48">
                      Owner
                    </DataGridHeaderCell>
                    <DataGridHeaderCell className="w-44">
                      Activity
                    </DataGridHeaderCell>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className={dataGridRowClass}>
                      <DataGridCell className="min-w-[24rem]">
                        <div className="flex items-center gap-3">
                          <CaseProfileMark profile={item.profile} />
                          <Link
                            to={`/cases/${item.id}`}
                            className={`${dataGridRowLinkClass} min-w-0 flex-1`}
                          >
                            <span
                              className="block truncate text-[12.5px]"
                              title={item.title}
                            >
                              {item.title}
                            </span>
                            <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[10.5px] font-normal text-text-muted">
                              <Mono className="text-info">{item.ref}</Mono>
                              {item.summary === null ? null : (
                                <>
                                  <span aria-hidden>·</span>
                                  <span className="truncate">
                                    {item.summary}
                                  </span>
                                </>
                              )}
                            </span>
                          </Link>
                        </div>
                      </DataGridCell>
                      <DataGridCell>
                        <CaseStatusBadge status={item.status} />
                      </DataGridCell>
                      <DataGridCell>
                        <CaseProfileBadge profile={item.profile} />
                      </DataGridCell>
                      <DataGridCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex min-h-5 items-center gap-1 rounded-full border border-info/35 bg-info/10 px-1.5 text-[11px] font-medium text-info">
                            <ShieldAlert aria-hidden className="size-3" />
                            {item.findingCount.toLocaleString()} finding
                            {item.findingCount === 1 ? "" : "s"}
                          </span>
                          {item.disclosureEnabled ? (
                            <span
                              className="inline-flex min-h-5 items-center gap-1 rounded-full border border-accent/35 bg-accent/10 px-1.5 text-[11px] font-medium text-accent"
                              title="Coordinated disclosure is enabled"
                            >
                              <Megaphone aria-hidden className="size-3" />
                              Disclosure
                            </span>
                          ) : null}
                          {item.restricted ? (
                            <span
                              className="inline-flex min-h-5 items-center gap-1 rounded-full border border-danger/35 bg-danger/10 px-1.5 text-[11px] font-medium text-danger"
                              title="Visible only to named members"
                            >
                              <Lock aria-hidden className="size-3" />
                              Restricted
                            </span>
                          ) : null}
                        </div>
                      </DataGridCell>
                      <DataGridCell>
                        <Avatar
                          avatarId={null}
                          userId={item.owner.id}
                          label={item.owner.displayName}
                          size="sm"
                          showLabel
                          className="gap-1.5"
                        />
                      </DataGridCell>
                      <DataGridCell>
                        <DataGridActivity
                          createdAt={item.createdAt}
                          updatedAt={item.updatedAt}
                          complete={
                            item.status === "CLOSED" ||
                            item.status === "ARCHIVED"
                          }
                        />
                      </DataGridCell>
                    </tr>
                  ))}
                </tbody>
              </DataGridTable>
            </DataGridViewport>
            <NumberedPagination
              label="Case"
              pageIndex={pageIndex}
              pageCount={pageCount}
              itemCount={items.length}
              totalItems={total}
              pageSize={pageSize}
              loading={cases.isFetching}
              onPageSizeChange={(nextPageSize) => {
                setPageSize(nextPageSize);
                resetPagination();
              }}
              onPageChange={goToPage}
            />
          </>
        )}
      </DataGridFrame>

      <CreateCaseDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

const CASE_STATUS_STYLES: Record<CaseSummary["status"], string> = {
  OPEN: "border-info/40 bg-info/10 text-info",
  PAUSED: "border-warning/45 bg-warning/12 text-warning",
  CLOSED: "border-success/40 bg-success/10 text-success",
  ARCHIVED: "border-border bg-surface-raised text-text-muted",
};

const CASE_STATUS_ICONS = {
  OPEN: CircleDot,
  PAUSED: PauseCircle,
  CLOSED: CheckCircle2,
  ARCHIVED: Archive,
} satisfies Record<CaseSummary["status"], typeof CircleDot>;

function CaseStatusBadge({
  status,
}: {
  status: CaseSummary["status"];
}): React.JSX.Element {
  const Icon = CASE_STATUS_ICONS[status];

  return (
    <span
      className={cn(
        "inline-flex min-h-5 items-center gap-1 rounded-full border px-1.5 text-[11px] font-medium whitespace-nowrap",
        CASE_STATUS_STYLES[status],
      )}
    >
      <Icon aria-hidden className="size-3" />
      {humanise(status)}
    </span>
  );
}

const CASE_PROFILE_STYLES: Record<CaseSummary["profile"], string> = {
  STANDARD: "border-info/35 bg-info/10 text-info",
  COORDINATED_DISCLOSURE: "border-accent/35 bg-accent/10 text-accent",
  CRITICAL_ZERO_DAY: "border-danger/40 bg-danger/12 text-danger",
  PROGRAM: "border-warning/40 bg-warning/10 text-warning",
};

function CaseProfileBadge({
  profile,
}: {
  profile: CaseSummary["profile"];
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex min-h-5 items-center gap-1 rounded-full border px-1.5 text-[11px] font-medium whitespace-nowrap",
        CASE_PROFILE_STYLES[profile],
      )}
    >
      <Layers3 aria-hidden className="size-3" />
      {humanise(profile)}
    </span>
  );
}

function CaseProfileMark({
  profile,
}: {
  profile: CaseSummary["profile"];
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-(--cv-radius) border",
        CASE_PROFILE_STYLES[profile],
      )}
      title={humanise(profile)}
    >
      <Layers3 aria-hidden className="size-4" />
    </span>
  );
}
