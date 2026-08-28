import { keepPreviousData } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  ListFilter,
  Plus,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { FindingSummary } from "@codevault/contracts";
import {
  DISCLOSURE_STATES,
  PRIOR_ART_STATES,
  REMEDIATION_STATES,
  VALIDATION_STATES,
} from "@codevault/core";
import { SEVERITY_RATINGS } from "@codevault/standards";
import {
  Button,
  AssetKindIcon,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Mono,
  PriorArtBadge,
  Select,
  severitySelectOptions,
  SeverityBadge,
  StateBadge,
  stateSelectOptions,
  type SelectOption,
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
import {
  CursorPagination,
  useCursorPagination,
} from "../components/cursor-pagination.js";
import { CreateFindingDialog } from "../features/findings/create-finding-dialog.js";
import {
  applyFindingView,
  FINDING_FILTER_VIEWS,
  matchingFindingView,
  type FindingFilterState,
  type FindingViewId,
} from "../features/findings/finding-filter-views.js";
import { useDebouncedValue } from "../hooks/use-debounced-value.js";
import { errorHeading, queryKeys, useApiQuery } from "../lib/api.js";
import { canWrite, useSession } from "../lib/session.js";

/**
 * The findings list.
 *
 * Filtering and pagination happen on the server so the client never holds the
 * whole collection. Each page still renders as a real semantic table, which
 * keeps headers, row relationships, and keyboard navigation intact.
 */

interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

const DEFAULT_PAGE_SIZE = 50;

/**
 * The sentinel for "no filter".
 *
 * A select cannot hold the empty string as a value — Radix reserves it for the
 * placeholder — and an unfiltered column reads better as an explicit "All
 * severities" than as an empty box anyway.
 */
const ALL = "__all";
const CUSTOM = "__custom";

export function FindingsRoute(): React.JSX.Element {
  const routeSearch = useSearch({ from: "/findings" });
  const navigate = useNavigate();
  const user = useSession((state) => state.user);
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [validationState, setValidationState] =
    useState<FindingFilterState["validationState"]>("");
  const [remediationState, setRemediationState] =
    useState<FindingFilterState["remediationState"]>("");
  const [disclosureState, setDisclosureState] =
    useState<FindingFilterState["disclosureState"]>("");
  const [priorArtState, setPriorArtState] =
    useState<FindingFilterState["priorArtState"]>("");
  const [severity, setSeverity] = useState<FindingFilterState["severity"]>("");
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const debouncedSearch = useDebouncedValue(search, 220);
  const paginationIdentity = [
    debouncedSearch.trim(),
    validationState,
    remediationState,
    disclosureState,
    priorArtState,
    severity,
    routeSearch.assetId ?? "",
    pageSize,
  ].join(":");
  const pagination = useCursorPagination(paginationIdentity);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      limit: String(pageSize),
    });

    if (debouncedSearch.trim().length > 0) {
      params.set("query", debouncedSearch.trim());
    }

    if (validationState.length > 0) {
      params.set("validationState", validationState);
    }

    if (disclosureState.length > 0) {
      params.set("disclosureState", disclosureState);
    }

    if (remediationState.length > 0) {
      params.set("remediationState", remediationState);
    }

    if (priorArtState.length > 0) {
      params.set("priorArtState", priorArtState);
    }

    if (severity.length > 0) {
      params.set("severity", severity);
    }

    if (routeSearch.assetId !== undefined) {
      params.set("assetId", routeSearch.assetId);
    }

    if (pagination.cursor !== null) {
      params.set("cursor", pagination.cursor);
    }

    return params.toString();
  }, [
    debouncedSearch,
    validationState,
    remediationState,
    disclosureState,
    priorArtState,
    severity,
    routeSearch.assetId,
    pagination.cursor,
    pageSize,
  ]);

  const findings = useApiQuery<Paginated<FindingSummary>>(
    queryKeys.findings({ query }),
    `/v1/findings?${query}`,
    { placeholderData: keepPreviousData },
  );

  const items = findings.data?.items ?? [];
  const hasStateFilters =
    validationState.length > 0 ||
    remediationState.length > 0 ||
    disclosureState.length > 0 ||
    priorArtState.length > 0 ||
    severity.length > 0;
  const hasFilters =
    search.trim().length > 0 ||
    hasStateFilters ||
    routeSearch.assetId !== undefined;

  const clearFilters = (): void => {
    setSearch("");
    setValidationState("");
    setRemediationState("");
    setDisclosureState("");
    setPriorArtState("");
    setSeverity("");
    void navigate({ to: "/findings", search: {} });
  };

  const filterState: FindingFilterState = {
    validationState,
    remediationState,
    disclosureState,
    priorArtState,
    severity,
  };
  const activeView = matchingFindingView(filterState);

  const applyView = (value: string): void => {
    const next =
      value === ALL
        ? {
            validationState: "" as const,
            remediationState: "" as const,
            disclosureState: "" as const,
            priorArtState: "" as const,
            severity: "" as const,
          }
        : applyFindingView(value as FindingViewId);
    setValidationState(next.validationState);
    setRemediationState(next.remediationState);
    setDisclosureState(next.disclosureState);
    setPriorArtState(next.priorArtState);
    setSeverity(next.severity);
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Findings"
        description={
          routeSearch.assetId === undefined
            ? "Every finding you can see, across every case."
            : `Findings linked to ${routeSearch.assetName ?? "the selected asset"}.`
        }
        actions={
          canWrite(user) ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden className="size-3.5" />
              New finding
            </Button>
          ) : undefined
        }
      />

      <DataGridFrame aria-label="Findings table">
        <DataGridToolbar>
          <label className="relative min-w-56 flex-1 sm:max-w-sm">
            <span className="sr-only">Filter findings</span>
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter by title or reference…"
              className="pl-9"
            />
          </label>
          <Select
            aria-label="Triage view"
            value={activeView ?? (hasStateFilters ? CUSTOM : ALL)}
            onValueChange={applyView}
            className="w-52"
            options={[
              {
                value: ALL,
                label: "All findings",
                description: "No lifecycle or severity filters.",
                icon: <ListFilter className="size-3.5" />,
              },
              {
                value: CUSTOM,
                label: "Custom view",
                description: "A manually adjusted filter combination.",
                disabled: true,
              },
              ...FINDING_FILTER_VIEWS.map((view) => ({
                value: view.id,
                label: view.label,
                description: view.description,
              })),
            ]}
          />
          <details className="group relative">
            <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-(--cv-radius) border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus">
              <SlidersHorizontal aria-hidden className="size-4" />
              Filters
              {hasStateFilters ? (
                <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] leading-none text-accent-contrast">
                  Active
                </span>
              ) : null}
            </summary>
            <div className="absolute right-0 z-30 mt-2 grid w-[min(38rem,calc(100vw-6rem))] grid-cols-1 gap-2 rounded-(--cv-radius-lg) border border-border-strong bg-surface p-3 shadow-lg sm:grid-cols-2">
              <FilterSelect
                label="Validation"
                value={validationState}
                onChange={(value) =>
                  setValidationState(
                    value as FindingFilterState["validationState"],
                  )
                }
                options={stateSelectOptions("validation", VALIDATION_STATES)}
              />
              <FilterSelect
                label="Remediation"
                value={remediationState}
                onChange={(value) =>
                  setRemediationState(
                    value as FindingFilterState["remediationState"],
                  )
                }
                options={stateSelectOptions("remediation", REMEDIATION_STATES)}
              />
              <FilterSelect
                label="Disclosure"
                value={disclosureState}
                onChange={(value) =>
                  setDisclosureState(
                    value as FindingFilterState["disclosureState"],
                  )
                }
                options={stateSelectOptions("disclosure", DISCLOSURE_STATES)}
              />
              <FilterSelect
                label="Prior art"
                value={priorArtState}
                onChange={(value) =>
                  setPriorArtState(value as FindingFilterState["priorArtState"])
                }
                options={stateSelectOptions("priorArt", PRIOR_ART_STATES)}
              />
              <FilterSelect
                label="Severity"
                value={severity}
                onChange={(value) =>
                  setSeverity(value as FindingFilterState["severity"])
                }
                options={severitySelectOptions(SEVERITY_RATINGS)}
              />
            </div>
          </details>
          {routeSearch.assetId === undefined ? null : (
            <div className="flex h-9 min-w-0 items-center gap-1 rounded-(--cv-radius) border border-border bg-surface px-2 text-[12px]">
              <span className="shrink-0 text-text-muted">Asset</span>
              <Link
                to={`/assets/${routeSearch.assetId}`}
                className="min-w-0 truncate font-medium underline-offset-2 hover:underline"
              >
                {routeSearch.assetName ?? "Linked asset"}
              </Link>
              <button
                type="button"
                aria-label="Clear asset filter"
                title="Clear asset filter"
                onClick={() => void navigate({ to: "/findings", search: {} })}
                className="ml-1 flex size-8 shrink-0 items-center justify-center rounded-(--cv-radius) text-text-muted hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-focus"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </div>
          )}
          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X aria-hidden className="size-4" />
              Clear
            </Button>
          ) : null}
          <span className="ml-auto text-[11px] text-text-muted" role="status">
            {findings.isFetching && findings.data !== undefined
              ? "Updating…"
              : `${items.length} shown`}
          </span>
        </DataGridToolbar>

        {findings.error !== null ? (
          <ErrorState
            title={errorHeading(findings.error)}
            description={findings.error.message}
            action={
              <Button
                variant="secondary"
                size="sm"
                loading={findings.isFetching}
                onClick={() => void findings.refetch()}
              >
                Try again
              </Button>
            }
          />
        ) : findings.isLoading ? (
          <LoadingState label="Loading findings…" />
        ) : items.length === 0 ? (
          <EmptyState
            title={
              routeSearch.assetId !== undefined
                ? `No findings linked to ${routeSearch.assetName ?? "this asset"}`
                : hasFilters
                  ? "No findings match"
                  : "No findings yet"
            }
            description={
              hasFilters
                ? "Clear one or more filters to widen the result set."
                : canWrite(user)
                  ? "Record a finding as soon as the issue is reproducible; the detail can follow."
                  : "No findings are available to you. An editor can record the first finding."
            }
            action={
              hasFilters ? (
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : canWrite(user) ? (
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  <Plus aria-hidden className="size-3.5" />
                  New finding
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <DataGridViewport aria-busy={findings.isFetching || undefined}>
              <DataGridTable className="min-w-[1180px]">
                <thead>
                  <tr>
                    <DataGridHeaderCell>Finding</DataGridHeaderCell>
                    <DataGridHeaderCell className="w-28">
                      Severity
                    </DataGridHeaderCell>
                    <DataGridHeaderCell className="w-44">
                      Lifecycle
                    </DataGridHeaderCell>
                    <DataGridHeaderCell className="w-40">
                      Disclosure
                    </DataGridHeaderCell>
                    <DataGridHeaderCell className="w-40">
                      Prior art
                    </DataGridHeaderCell>
                    <DataGridHeaderCell className="w-32">
                      AI review
                    </DataGridHeaderCell>
                    <DataGridHeaderCell className="w-44">
                      Activity
                    </DataGridHeaderCell>
                  </tr>
                </thead>
                <tbody>
                  {items.map((finding) => (
                    <tr key={finding.id} className={dataGridRowClass}>
                      <DataGridCell className="min-w-[25rem]">
                        <div className="flex items-center gap-3">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-(--cv-radius) border border-accent/25 bg-accent/10 text-accent">
                            {finding.primaryAsset === null ? (
                              <ShieldAlert aria-hidden className="size-4" />
                            ) : (
                              <AssetKindIcon kind={finding.primaryAsset.kind} />
                            )}
                          </span>
                          <Link
                            to={`/findings/${finding.id}`}
                            className={`${dataGridRowLinkClass} min-w-0 flex-1`}
                          >
                            <span
                              className="block truncate text-[12.5px]"
                              title={finding.title}
                            >
                              {finding.title}
                            </span>
                            <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[10.5px] font-normal text-text-muted">
                              <Mono className="text-info">{finding.ref}</Mono>
                              <span aria-hidden>·</span>
                              <span className="text-accent">
                                {finding.caseRef}
                              </span>
                              {finding.primaryAsset === null ? null : (
                                <>
                                  <span aria-hidden>·</span>
                                  <span className="truncate">
                                    {finding.primaryAsset.name}
                                  </span>
                                </>
                              )}
                            </span>
                          </Link>
                        </div>
                      </DataGridCell>
                      <DataGridCell>
                        <SeverityBadge
                          severity={finding.severity}
                          score={finding.score}
                        />
                      </DataGridCell>
                      <DataGridCell>
                        <div className="flex flex-col items-start gap-1">
                          <StateBadge
                            kind="validation"
                            state={finding.validationState}
                          />
                          <StateBadge
                            kind="remediation"
                            state={finding.remediationState}
                          />
                        </div>
                      </DataGridCell>
                      <DataGridCell>
                        <StateBadge
                          kind="disclosure"
                          state={finding.disclosureState}
                        />
                      </DataGridCell>
                      <DataGridCell>
                        <PriorArtBadge state={finding.priorArtState} />
                      </DataGridCell>
                      <DataGridCell>
                        {finding.pendingProposalCount > 0 ? (
                          <span className="inline-flex min-h-5 items-center gap-1 rounded-full border border-accent/35 bg-accent/10 px-1.5 text-[11px] font-medium whitespace-nowrap text-accent">
                            <Sparkles aria-hidden className="size-3" />
                            {finding.pendingProposalCount} pending
                          </span>
                        ) : (
                          <span className="text-[11px] text-text-muted">
                            No proposals
                          </span>
                        )}
                      </DataGridCell>
                      <DataGridCell>
                        <DataGridActivity
                          createdAt={finding.createdAt}
                          updatedAt={finding.updatedAt}
                        />
                      </DataGridCell>
                    </tr>
                  ))}
                </tbody>
              </DataGridTable>
            </DataGridViewport>
            <CursorPagination
              label="Finding"
              pageIndex={pagination.pageIndex}
              itemCount={items.length}
              pageSize={pageSize}
              nextCursor={findings.data?.nextCursor ?? null}
              loading={findings.isFetching}
              onPageSizeChange={setPageSize}
              onPrevious={pagination.previous}
              onNext={pagination.next}
            />
          </>
        )}
      </DataGridFrame>

      <CreateFindingDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        assetId={routeSearch.assetId}
      />
    </div>
  );
}

/**
 * One filter in the findings toolbar.
 *
 * The options are built from the same tables the badges in the rows below use,
 * so the colour and glyph you pick in the filter are the colour and glyph you
 * then scan for in the results.
 */
function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
}): React.JSX.Element {
  return (
    <Select
      aria-label={label}
      value={value.length === 0 ? ALL : value}
      onValueChange={(next) => onChange(next === ALL ? "" : next)}
      className="w-full"
      options={[
        {
          value: ALL,
          label: `All ${label.toLowerCase()}`,
          icon: <ListFilter className="size-3.5" />,
        },
        ...options,
      ]}
    />
  );
}
