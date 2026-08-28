import { Link } from "@tanstack/react-router";
import { Check, History, Minus, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";

import type {
  CaseAccessHistoryEvent,
  CaseAccessHistoryResponse,
  CaseAccessReviewItem,
  CaseAccessReviewPrincipal,
  CaseAccessReviewResponse,
  CaseCapability,
} from "@codevault/contracts";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  LoadingState,
  Mono,
  cn,
} from "@codevault/ui";

import { OrganizationSettingsPage } from "../components/settings-layout.js";
import { QueryError } from "../components/query-boundary.js";
import { queryKeys, useApiQuery } from "../lib/api.js";
import { formatDateTime } from "../lib/dates.js";

const CAPABILITY_COLUMNS: readonly {
  capability: CaseCapability;
  label: string;
}[] = [
  { capability: "READ", label: "Read" },
  { capability: "WRITE", label: "Edit" },
  { capability: "APPROVAL", label: "Approve" },
  { capability: "DISCLOSURE", label: "Disclose" },
];

interface ReviewRow {
  researchCase: CaseAccessReviewItem;
  principal: CaseAccessReviewPrincipal;
}

export function AccessReviewRoute(): React.JSX.Element {
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const reviewPath = `/v1/cases/access-review?limit=50&page=${page}${
    filter.trim().length === 0
      ? ""
      : `&query=${encodeURIComponent(filter.trim())}`
  }`;
  const review = useApiQuery<CaseAccessReviewResponse>(
    [...queryKeys.caseAccessReview, page, filter.trim()],
    reviewPath,
  );
  const history = useApiQuery<CaseAccessHistoryResponse>(
    [
      ...queryKeys.caseAccessHistory(selectedCaseId ?? "unselected"),
      historyPage,
    ],
    `/v1/cases/${selectedCaseId ?? "unselected"}/access-history?limit=100&page=${historyPage}`,
    { enabled: selectedCaseId !== null },
  );
  const rows = useMemo(
    () => filterReviewRows(review.data?.items ?? [], filter),
    [filter, review.data?.items],
  );
  const selectedCase = review.data?.items.find(
    (item) => item.id === selectedCaseId,
  );
  const explicitGrantCount =
    review.data?.items.reduce(
      (count, item) =>
        count +
        item.principals.filter((principal) => principal.source === "GRANT")
          .length,
      0,
    ) ?? 0;
  const pageCount = Math.max(1, Math.ceil((review.data?.total ?? 0) / 50));

  return (
    <OrganizationSettingsPage
      title="Case access review"
      description="Review the effective read, edit, approval, and disclosure authority for every case you are cleared to see."
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <SummaryCard
            label="Visible cases"
            value={review.data?.total ?? null}
          />
          <SummaryCard
            label="Explicit grants on page"
            value={review.data === undefined ? null : explicitGrantCount}
          />
        </div>

        <Card>
          <CardHeader className="items-start">
            <div>
              <CardTitle>Effective access</CardTitle>
              <p className="mt-0.5 text-[11px] text-text-muted">
                Stored grants are reduced by disabled accounts and the global
                Viewer role ceiling.
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              loading={review.isFetching}
              onClick={() => void review.refetch()}
            >
              <RefreshCw aria-hidden className="size-3.5" />
              Refresh
            </Button>
          </CardHeader>
          <CardBody className="border-b border-border py-2">
            <label className="relative block max-w-md">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-muted"
              />
              <span className="sr-only">Filter access review</span>
              <Input
                aria-label="Filter access review"
                value={filter}
                placeholder="Filter by case, person, or email"
                className="pl-8"
                onChange={(event) => {
                  setFilter(event.target.value);
                  setPage(1);
                }}
              />
            </label>
          </CardBody>

          {review.error !== null ? (
            <QueryError query={review} className="m-3" />
          ) : review.isLoading ? (
            <LoadingState label="Loading case access…" />
          ) : review.data?.items.length === 0 ? (
            <EmptyState
              title="No cases are available for review"
              description="Cases appear here when you own them or receive an explicit read grant."
            />
          ) : rows.length === 0 ? (
            <EmptyState title="No access rows match this filter" />
          ) : (
            <AccessTable
              rows={rows}
              selectedCaseId={selectedCaseId}
              onSelectCase={(caseId) => {
                setSelectedCaseId(caseId);
                setHistoryPage(1);
              }}
            />
          )}

          {review.data === undefined || review.data.total <= 50 ? null : (
            <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
              <span className="text-[11px] tabular-nums text-text-muted">
                Page {page.toLocaleString()} of {pageCount.toLocaleString()}
              </span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={page >= pageCount}
                  onClick={() =>
                    setPage((current) => Math.min(pageCount, current + 1))
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>

        <AccessHistoryPanel
          researchCase={selectedCase}
          history={history}
          page={historyPage}
          onPageChange={setHistoryPage}
        />
      </div>
    </OrganizationSettingsPage>
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: number | null;
}): React.JSX.Element {
  return (
    <Card>
      <CardBody className="py-3">
        <p className="text-[11px] text-text-muted">{label}</p>
        <p className="mt-0.5 text-[20px] font-semibold tabular-nums">
          {value === null ? "—" : value.toLocaleString()}
        </p>
      </CardBody>
    </Card>
  );
}

function AccessTable({
  rows,
  selectedCaseId,
  onSelectCase,
}: {
  rows: readonly ReviewRow[];
  selectedCaseId: string | null;
  onSelectCase: (caseId: string) => void;
}): React.JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[68rem] text-left text-[12px]">
        <thead className="border-b border-border text-[10px] uppercase tracking-wide text-text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Case</th>
            <th className="px-3 py-2 font-medium">Person</th>
            <th className="px-3 py-2 font-medium">Grant</th>
            {CAPABILITY_COLUMNS.map((column) => (
              <th
                key={column.capability}
                className="px-2 py-2 text-center font-medium"
              >
                {column.label}
              </th>
            ))}
            <th className="px-3 py-2 font-medium">Account</th>
            <th className="px-3 py-2 text-right font-medium">History</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(({ researchCase, principal }, index) => {
            const roleCeiling =
              principal.grantedCapabilities.length !==
              principal.effectiveCapabilities.length;
            const firstRowForCase =
              index === 0 ||
              rows[index - 1]?.researchCase.id !== researchCase.id;

            return (
              <tr
                key={`${researchCase.id}:${principal.user.id}:${principal.source}`}
                className={cn(
                  "align-middle",
                  selectedCaseId === researchCase.id && "bg-surface-hover",
                )}
              >
                <td className="px-3 py-2">
                  <Link
                    to="/cases/$caseId"
                    params={{ caseId: researchCase.id }}
                    className="block max-w-64 rounded-(--cv-radius) font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    <Mono className="mr-2 text-[10px] text-text-muted">
                      {researchCase.ref}
                    </Mono>
                    <span>{researchCase.title}</span>
                  </Link>
                  {researchCase.restricted ? (
                    <span className="mt-0.5 block text-[10px] text-danger">
                      Restricted
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <span className="block font-medium">
                    {principal.user.displayName}
                  </span>
                  <span className="block text-[10px] text-text-muted">
                    {principal.user.email}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="block capitalize text-text-muted">
                    {principal.source.toLowerCase()} ·{" "}
                    {principal.role.toLowerCase()}
                  </span>
                  {roleCeiling ? (
                    <span className="mt-0.5 block text-[10px] text-warning">
                      Role ceiling
                    </span>
                  ) : null}
                </td>
                {CAPABILITY_COLUMNS.map((column) => (
                  <td key={column.capability} className="px-2 py-2 text-center">
                    <CapabilityMark
                      label={column.label}
                      allowed={principal.effectiveCapabilities.includes(
                        column.capability,
                      )}
                    />
                  </td>
                ))}
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-1.5 py-0.5 text-[10px]",
                      principal.disabled
                        ? "border-danger/40 bg-danger/10 text-danger"
                        : "border-success/40 bg-success/10 text-success",
                    )}
                  >
                    {principal.disabled ? "Disabled" : "Active"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  {firstRowForCase ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Review access history"
                      onClick={() => onSelectCase(researchCase.id)}
                    >
                      <History aria-hidden className="size-3.5" />
                      Review
                    </Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CapabilityMark({
  label,
  allowed,
}: {
  label: string;
  allowed: boolean;
}): React.JSX.Element {
  return allowed ? (
    <Check
      aria-label={`${label} allowed`}
      className="mx-auto size-4 text-success"
    />
  ) : (
    <Minus
      aria-label={`${label} not allowed`}
      className="mx-auto size-4 text-text-muted"
    />
  );
}

function AccessHistoryPanel({
  researchCase,
  history,
  page,
  onPageChange,
}: {
  researchCase: CaseAccessReviewItem | undefined;
  history: ReturnType<typeof useApiQuery<CaseAccessHistoryResponse>>;
  page: number;
  onPageChange: (page: number) => void;
}): React.JSX.Element {
  const pageCount = Math.max(1, Math.ceil((history.data?.total ?? 0) / 100));

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Access audit history</CardTitle>
          <p className="mt-0.5 text-[11px] text-text-muted">
            {researchCase === undefined
              ? "Choose a case above to inspect its append-only access changes."
              : `${researchCase.ref} · ${researchCase.title}`}
          </p>
        </div>
      </CardHeader>
      {researchCase === undefined ? (
        <CardBody className="text-[12px] text-text-muted">
          No case selected.
        </CardBody>
      ) : history.error !== null ? (
        <QueryError query={history} className="m-3" />
      ) : history.isLoading ? (
        <LoadingState label="Loading access history…" />
      ) : history.data?.items.length === 0 ? (
        <EmptyState title="No access changes recorded" />
      ) : (
        <>
          <ul className="divide-y divide-border">
            {history.data?.items.map((event) => (
              <AccessHistoryRow key={event.id} event={event} />
            ))}
          </ul>
          {history.data === undefined || history.data.total <= 100 ? null : (
            <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
              <span className="text-[11px] tabular-nums text-text-muted">
                Page {page.toLocaleString()} of {pageCount.toLocaleString()}
              </span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={page <= 1}
                  onClick={() => onPageChange(Math.max(1, page - 1))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={page >= pageCount}
                  onClick={() => onPageChange(Math.min(pageCount, page + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function AccessHistoryRow({
  event,
}: {
  event: CaseAccessHistoryEvent;
}): React.JSX.Element {
  return (
    <li className="grid gap-1 px-3 py-2.5 text-[12px] sm:grid-cols-[11rem_minmax(0,1fr)]">
      <span className="text-[11px] text-text-muted">
        {formatDateTime(event.occurredAt)}
      </span>
      <div>
        <p className="font-medium">{historyTitle(event.kind)}</p>
        <p className="mt-0.5 text-text-muted">{historyDescription(event)}</p>
        {event.kind === "OWNER_TRANSFERRED" ? null : (
          <p className="mt-1 font-mono text-[10px] text-text-muted">
            {formatCapabilities(event.beforeCapabilities)} →{" "}
            {formatCapabilities(event.afterCapabilities)}
          </p>
        )}
      </div>
    </li>
  );
}

function historyTitle(kind: CaseAccessHistoryEvent["kind"]): string {
  if (kind === "GRANTED") return "Access granted";
  if (kind === "UPDATED") return "Access changed";
  if (kind === "REVOKED") return "Access revoked";
  if (kind === "LEGACY_CHANGE") return "Legacy access change";
  return "Ownership transferred";
}

function historyDescription(event: CaseAccessHistoryEvent): string {
  const actor = event.actor?.displayName ?? "System";
  const subject = event.subject?.displayName ?? "Unknown member";
  if (event.kind === "OWNER_TRANSFERRED") {
    return `${actor} transferred ownership from ${event.previousSubject?.displayName ?? "Unknown owner"} to ${subject}.`;
  }
  if (event.kind === "REVOKED") {
    return `${actor} revoked ${subject}'s case access.`;
  }
  if (event.kind === "GRANTED") {
    return `${actor} granted case access to ${subject}.`;
  }
  if (event.kind === "LEGACY_CHANGE") {
    return `${actor} changed ${subject}'s access before exact before/after snapshots were recorded.`;
  }
  return `${actor} changed ${subject}'s case access.`;
}

function formatCapabilities(
  capabilities: readonly CaseCapability[] | null,
): string {
  if (capabilities === null) return "unknown";
  if (capabilities.length === 0) return "none";
  return capabilities.map((capability) => capability.toLowerCase()).join(" · ");
}

function filterReviewRows(
  cases: readonly CaseAccessReviewItem[],
  filter: string,
): ReviewRow[] {
  const query = filter.trim().toLowerCase();

  return cases.flatMap((researchCase) => {
    const caseMatches =
      query.length === 0 ||
      researchCase.ref.toLowerCase().includes(query) ||
      researchCase.title.toLowerCase().includes(query);
    return researchCase.principals
      .filter(
        (principal) =>
          caseMatches ||
          principal.user.displayName.toLowerCase().includes(query) ||
          principal.user.email.toLowerCase().includes(query),
      )
      .map((principal) => ({ researchCase, principal }));
  });
}
