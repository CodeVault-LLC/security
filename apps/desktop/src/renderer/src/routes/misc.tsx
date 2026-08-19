import { Link } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

import type {
  AuditEvent,
  CaseSummary,
  ReportSummary,
} from "@codevault/contracts";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  LoadingState,
  Mono,
  TlpBadge,
} from "@codevault/ui";

import { PageBody, PageHeader } from "../components/app-shell.js";
import { Avatar } from "../components/avatar.js";
import { QueryBoundary, QueryError } from "../components/query-boundary.js";
import { formatDateTime } from "../lib/dates.js";
import { humanise } from "../lib/format.js";
import { errorHeading, queryKeys, useApiQuery } from "../lib/api.js";

/**
 * Reports index and organization-visible activity log.
 *
 * Grouped because each is a single screen with no sub-navigation.
 */

interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

/** Reports across every case the researcher can read. */
export function ReportsRoute(): React.JSX.Element {
  const cases = useApiQuery<Paginated<CaseSummary>>(
    queryKeys.cases(),
    "/v1/cases?limit=100",
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Reports"
        description="Internal, vendor and public projections of each case."
      />

      <PageBody className="space-y-3">
        <QueryBoundary query={cases} loadingLabel="Loading cases…">
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState
                title="No cases yet"
                description="Reports are created from a case, once there is something to report."
              />
            ) : (
              data.items.map((item) => (
                <CaseReports key={item.id} caseSummary={item} />
              ))
            )
          }
        </QueryBoundary>
      </PageBody>
    </div>
  );
}

function CaseReports({
  caseSummary,
}: {
  caseSummary: CaseSummary;
}): React.JSX.Element {
  const reports = useApiQuery<{ items: ReportSummary[] }>(
    queryKeys.reports(caseSummary.id),
    `/v1/reports?caseId=${caseSummary.id}`,
  );

  const items = reports.data?.items ?? [];

  if (reports.error !== null) {
    return <QueryError query={reports} />;
  }

  if (items.length === 0) {
    return <></>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Link to={`/cases/${caseSummary.id}`} className="hover:underline">
            {caseSummary.ref} — {caseSummary.title}
          </Link>
        </CardTitle>
      </CardHeader>
      <ul className="divide-y divide-border">
        {items.map((report) => (
          <li key={report.id}>
            <Link
              to={`/reports/${report.id}`}
              className="flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-surface-hover"
            >
              <Mono className="w-24 shrink-0 text-text-muted">
                {report.ref}
              </Mono>
              <span className="w-20 shrink-0 text-text-muted">
                {report.audience}
              </span>
              <span className="min-w-0 flex-1 truncate">{report.title}</span>
              <TlpBadge label={report.tlp} />
              <span className="w-28 shrink-0 text-right text-text-muted">
                {report.approvedSectionCount}/{report.sectionCount} approved
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Disclosure across cases that have it enabled. */
export function DisclosureIndexRoute(): React.JSX.Element {
  const cases = useApiQuery<Paginated<CaseSummary>>(
    queryKeys.cases(),
    "/v1/cases?limit=100",
  );

  const coordinated = (cases.data?.items ?? []).filter(
    (item) => item.disclosureEnabled,
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Disclosure"
        description="Cases with a coordination workflow, and where each one stands."
      />

      <PageBody>
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
          <LoadingState label="Loading cases…" />
        ) : coordinated.length === 0 ? (
          <EmptyState
            title="No cases are in coordinated disclosure"
            description="Disclosure appears here once a case's profile calls for it, or you enable it on the case."
          />
        ) : (
          <ul className="divide-y divide-border rounded-(--cv-radius) border border-border">
            {coordinated.map((item) => (
              <li key={item.id}>
                <Link
                  to={`/cases/${item.id}`}
                  className="flex items-center gap-2 px-3 py-2 text-[12px] hover:bg-surface-hover"
                >
                  <Mono className="w-32 shrink-0 text-text-muted">
                    {item.ref}
                  </Mono>
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <span className="text-text-muted">
                    {humanise(item.profile)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </div>
  );
}

/**
 * The activity log.
 *
 * A read-only projection of the audit trail. Nothing here can be edited or
 * deleted, in the interface or in the database.
 */
export function ActivityRoute(): React.JSX.Element {
  const activity = useApiQuery<Paginated<AuditEvent>>(
    queryKeys.activity(),
    "/v1/activity?limit=200",
  );

  const items = activity.data?.items ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 30,
    overscan: 15,
  });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Activity"
        description="Append-only history. Every sensitive change is recorded here and cannot be altered."
      />

      {activity.error !== null ? (
        <ErrorState
          title={errorHeading(activity.error)}
          description={activity.error.message}
          action={
            <Button
              variant="secondary"
              size="sm"
              loading={activity.isFetching}
              onClick={() => void activity.refetch()}
            >
              Try again
            </Button>
          }
        />
      ) : activity.isLoading ? (
        <LoadingState label="Loading activity…" />
      ) : items.length === 0 ? (
        <EmptyState title="No activity recorded yet" />
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          <div
            style={{ height: `${virtualizer.getTotalSize()}px` }}
            className="relative w-full"
          >
            {virtualizer.getVirtualItems().map((row) => {
              const event = items[row.index];

              if (event === undefined) {
                return null;
              }

              return (
                <div
                  key={event.id}
                  className="absolute left-0 top-0 flex w-full items-center gap-2 border-b border-border px-4 text-[12px]"
                  style={{
                    height: `${row.size}px`,
                    transform: `translateY(${row.start}px)`,
                  }}
                >
                  <span className="w-40 shrink-0 text-text-muted">
                    {formatDateTime(event.occurredAt)}
                  </span>
                  <Mono className="w-56 shrink-0">{event.action}</Mono>
                  <div className="w-40 shrink-0 truncate text-text-muted">
                    {event.actor ? (
                      <Avatar
                        avatarId={null}
                        userId={event.actor.id}
                        label={event.actor.displayName}
                        size="sm"
                        showLabel
                        className="gap-1.5"
                      />
                    ) : (
                      "system"
                    )}
                  </div>
                  <span className="w-28 shrink-0 text-text-muted">
                    {event.entityType}
                  </span>
                  <Mono className="min-w-0 flex-1 truncate text-text-muted">
                    {event.after === null ? "" : JSON.stringify(event.after)}
                  </Mono>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
