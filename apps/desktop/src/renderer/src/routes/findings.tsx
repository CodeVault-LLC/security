import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ListFilter, Plus, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import type { FindingSummary } from "@codevault/contracts";
import {
  DISCLOSURE_STATES,
  PRIOR_ART_STATES,
  VALIDATION_STATES,
} from "@codevault/core";
import { SEVERITY_RATINGS } from "@codevault/standards";
import {
  Button,
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
import { CreateFindingDialog } from "../features/findings/create-finding-dialog.js";
import { useDebouncedValue } from "../hooks/use-debounced-value.js";
import { formatDistanceToNowStrict } from "../lib/dates.js";
import { errorHeading, queryKeys, useApiQuery } from "../lib/api.js";
import { canWrite, useSession } from "../lib/session.js";

/**
 * The findings list.
 *
 * Virtualised, because a productive researcher accumulates thousands of these
 * and a table that stutters at 500 rows is a table people stop scrolling.
 * Filtering happens on the server so the client never holds the whole set.
 */

interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

const ROW_HEIGHT = 72;

/**
 * The sentinel for "no filter".
 *
 * A select cannot hold the empty string as a value — Radix reserves it for the
 * placeholder — and an unfiltered column reads better as an explicit "All
 * severities" than as an empty box anyway.
 */
const ALL = "__all";

export function FindingsRoute(): React.JSX.Element {
  const routeSearch = useSearch({ from: "/findings" });
  const navigate = useNavigate();
  const user = useSession((state) => state.user);
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [validationState, setValidationState] = useState<string>("");
  const [disclosureState, setDisclosureState] = useState<string>("");
  const [priorArtState, setPriorArtState] = useState<string>("");
  const [severity, setSeverity] = useState<string>("");
  const [limit, setLimit] = useState(200);

  const debouncedSearch = useDebouncedValue(search, 220);

  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: String(limit) });

    if (debouncedSearch.trim().length > 0) {
      params.set("query", debouncedSearch.trim());
    }

    if (validationState.length > 0) {
      params.set("validationState", validationState);
    }

    if (disclosureState.length > 0) {
      params.set("disclosureState", disclosureState);
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

    return params.toString();
  }, [
    debouncedSearch,
    validationState,
    disclosureState,
    priorArtState,
    severity,
    routeSearch.assetId,
    limit,
  ]);

  const findings = useApiQuery<Paginated<FindingSummary>>(
    queryKeys.findings({ query }),
    `/v1/findings?${query}`,
  );

  const items = findings.data?.items ?? [];
  const hasFilters =
    search.trim().length > 0 ||
    validationState.length > 0 ||
    disclosureState.length > 0 ||
    priorArtState.length > 0 ||
    severity.length > 0 ||
    routeSearch.assetId !== undefined;
  const scrollRef = useRef<HTMLDivElement>(null);

  const clearFilters = (): void => {
    setSearch("");
    setValidationState("");
    setDisclosureState("");
    setPriorArtState("");
    setSeverity("");
    void navigate({ to: "/findings", search: {} });
  };

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

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

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter by title or reference…"
          className="min-w-56 flex-1 sm:max-w-md"
          aria-label="Filter findings"
        />
        <details className="group relative">
          <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-(--cv-radius) border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus">
            <SlidersHorizontal aria-hidden className="size-4" />
            Filters
            {hasFilters ? <span className="text-accent">Active</span> : null}
          </summary>
          <div className="absolute right-0 z-20 mt-2 grid w-[min(38rem,calc(100vw-6rem))] grid-cols-1 gap-2 rounded-(--cv-radius-lg) border border-border-strong bg-surface p-3 shadow-lg sm:grid-cols-2">
            <FilterSelect
              label="Validation"
              value={validationState}
              onChange={setValidationState}
              options={stateSelectOptions("validation", VALIDATION_STATES)}
            />
            <FilterSelect
              label="Disclosure"
              value={disclosureState}
              onChange={setDisclosureState}
              options={stateSelectOptions("disclosure", DISCLOSURE_STATES)}
            />
            <FilterSelect
              label="Prior art"
              value={priorArtState}
              onChange={setPriorArtState}
              options={stateSelectOptions("priorArt", PRIOR_ART_STATES)}
            />
            <FilterSelect
              label="Severity"
              value={severity}
              onChange={setSeverity}
              options={severitySelectOptions(SEVERITY_RATINGS)}
            />
          </div>
        </details>
        {routeSearch.assetId === undefined ? null : (
          <div className="flex h-10 min-w-0 items-center gap-1 rounded-(--cv-radius) border border-border bg-surface px-2 text-[12px]">
            <span className="shrink-0 text-text-muted">Asset</span>
            <Link
              to={`/assets/${routeSearch.assetId}`}
              className="min-w-0 truncate font-medium hover:underline"
            >
              {routeSearch.assetName ?? "Linked asset"}
            </Link>
            <button
              type="button"
              aria-label="Clear asset filter"
              title="Clear asset filter"
              onClick={() => void navigate({ to: "/findings", search: {} })}
              className="ml-1 flex size-10 shrink-0 items-center justify-center rounded-(--cv-radius) text-text-muted hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-focus"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </div>
        )}
        {hasFilters ? (
          <Button variant="ghost" onClick={clearFilters}>
            <X aria-hidden className="size-4" />
            Clear
          </Button>
        ) : null}
        <span className="ml-auto text-[11px] text-text-muted" role="status">
          {findings.isFetching && findings.data !== undefined
            ? "Updating…"
            : `${items.length} shown`}
        </span>
      </div>

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
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          <div
            style={{ height: `${virtualizer.getTotalSize()}px` }}
            className="relative w-full"
          >
            {virtualizer.getVirtualItems().map((row) => {
              const finding = items[row.index];

              if (finding === undefined) {
                return null;
              }

              return (
                <div
                  key={finding.id}
                  className="absolute left-0 top-0 w-full"
                  style={{
                    height: `${row.size}px`,
                    transform: `translateY(${row.start}px)`,
                  }}
                >
                  <Link
                    to={`/findings/${finding.id}`}
                    className="grid h-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border px-4 text-[12px] hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus lg:grid-cols-[8rem_minmax(12rem,1fr)_auto_6rem]"
                  >
                    <Mono className="text-text-muted max-lg:row-start-2">
                      {finding.ref}
                    </Mono>
                    <span className="min-w-0 truncate font-medium max-lg:col-span-2 max-lg:row-start-1">
                      {finding.title}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 max-lg:col-span-2 max-lg:row-start-3">
                      <SeverityBadge
                        severity={finding.severity}
                        score={finding.score}
                      />
                      <StateBadge
                        kind="validation"
                        state={finding.validationState}
                      />
                      <span className="max-lg:hidden">
                        <StateBadge
                          kind="disclosure"
                          state={finding.disclosureState}
                        />
                      </span>
                      <span className="max-lg:hidden">
                        <PriorArtBadge state={finding.priorArtState} />
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-text-muted">
                      {formatDistanceToNowStrict(finding.updatedAt)}
                    </span>
                  </Link>
                </div>
              );
            })}
          </div>
          {findings.data?.nextCursor === null ? null : (
            <div className="flex justify-center border-t border-border p-3">
              <Button
                variant="secondary"
                loading={findings.isFetching}
                onClick={() => setLimit((current) => current + 200)}
              >
                Load more findings
              </Button>
            </div>
          )}
        </div>
      )}

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
