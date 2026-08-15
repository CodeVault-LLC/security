import { Link } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Plus } from "lucide-react";
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
  Input,
  Mono,
  PriorArtBadge,
  Select,
  SeverityBadge,
  StateBadge,
} from "@codevault/ui";

import { PageHeader } from "../components/app-shell.js";
import { CreateFindingDialog } from "../features/findings/create-finding-dialog.js";
import { useDebouncedValue } from "../hooks/use-debounced-value.js";
import { formatDistanceToNowStrict } from "../lib/dates.js";
import { queryKeys, useApiQuery } from "../lib/api.js";
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

const ROW_HEIGHT = 34;

export function FindingsRoute(): React.JSX.Element {
  const user = useSession((state) => state.user);
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [validationState, setValidationState] = useState<string>("");
  const [disclosureState, setDisclosureState] = useState<string>("");
  const [priorArtState, setPriorArtState] = useState<string>("");
  const [severity, setSeverity] = useState<string>("");

  const debouncedSearch = useDebouncedValue(search, 220);

  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: "200" });

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

    return params.toString();
  }, [debouncedSearch, validationState, disclosureState, priorArtState, severity]);

  const findings = useApiQuery<Paginated<FindingSummary>>(
    queryKeys.findings({ query }),
    `/v1/findings?${query}`,
  );

  const items = findings.data?.items ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);

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
        description="Every finding you can see, across every case."
        actions={
          canWrite(user) ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden className="size-3.5" />
              New finding
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter by title or reference…"
          className="w-72"
          aria-label="Filter findings"
        />
        <FilterSelect
          label="Validation"
          value={validationState}
          onChange={setValidationState}
          values={VALIDATION_STATES}
        />
        <FilterSelect
          label="Disclosure"
          value={disclosureState}
          onChange={setDisclosureState}
          values={DISCLOSURE_STATES}
        />
        <FilterSelect
          label="Prior art"
          value={priorArtState}
          onChange={setPriorArtState}
          values={PRIOR_ART_STATES}
        />
        <FilterSelect
          label="Severity"
          value={severity}
          onChange={setSeverity}
          values={SEVERITY_RATINGS}
        />
        <span className="ml-auto text-[11px] text-text-muted">
          {items.length} shown
        </span>
      </div>

      {findings.isLoading ? (
        <p className="p-4 text-[12px] text-text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState
          title="No findings match"
          description="Adjust the filters, or record a new finding."
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
                    className="flex h-full items-center gap-2 border-b border-border px-4 text-[12px] hover:bg-surface-hover"
                  >
                    <Mono className="w-32 shrink-0 text-text-muted">
                      {finding.ref}
                    </Mono>
                    <span className="min-w-0 flex-1 truncate">
                      {finding.title}
                    </span>
                    <span className="hidden shrink-0 items-center gap-1.5 lg:flex">
                      <SeverityBadge
                        severity={finding.severity}
                        score={finding.score}
                      />
                      <StateBadge
                        kind="validation"
                        state={finding.validationState}
                      />
                      <StateBadge
                        kind="disclosure"
                        state={finding.disclosureState}
                      />
                      <PriorArtBadge state={finding.priorArtState} />
                    </span>
                    <span className="w-20 shrink-0 text-right text-text-muted">
                      {formatDistanceToNowStrict(finding.updatedAt)}
                    </span>
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <CreateFindingDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  values,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  values: readonly string[];
}): React.JSX.Element {
  return (
    <Select
      aria-label={label}
      value={value.length === 0 ? undefined : value}
      onValueChange={(next) => onChange(next === "__all" ? "" : next)}
      placeholder={label}
      className="w-40"
      options={[
        { value: "__all", label: `All ${label.toLowerCase()}` },
        ...values.map((item) => ({ value: item, label: item })),
      ]}
    />
  );
}
