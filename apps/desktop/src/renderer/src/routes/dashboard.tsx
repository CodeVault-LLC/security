import { Link } from "@tanstack/react-router";
import { formatDistanceToNowStrict } from "../lib/dates.js";

import type { AttentionItem, DashboardResponse } from "@codevault/contracts";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Mono,
  SeverityBadge,
} from "@codevault/ui";

import { PageBody, PageHeader } from "../components/app-shell.js";
import { queryKeys, useApiQuery } from "../lib/api.js";

/**
 * The dashboard.
 *
 * Two questions: what needs me, and what moved. A count of open criticals is
 * not something a researcher can act on at nine in the morning; "the vendor
 * response on CASE-2026-0004 was due yesterday" is.
 */

const ATTENTION_LABELS: Record<AttentionItem["kind"], string> = {
  VENDOR_RESPONSE_DUE: "Vendor response due",
  DISCLOSURE_DATE_APPROACHING: "Disclosure date approaching",
  CRITICAL_PRIVATE_FINDING: "Severe and undisclosed",
  AWAITING_PEER_REVIEW: "Awaiting peer review",
  REPORT_AWAITING_APPROVAL: "Report awaiting approval",
  STALE_AFFECTED_VERSIONS: "Unverified affected versions",
  PRIOR_ART_NOT_RUN: "Prior art not checked",
  FAILED_BACKGROUND_JOB: "Background job failed",
  PENDING_AI_PROPOSALS: "AI proposals pending",
};

const ROUTE_FOR_ENTITY: Record<string, (id: string) => string> = {
  finding: (id) => `/findings/${id}`,
  case: (id) => `/cases/${id}`,
  report: (id) => `/reports/${id}`,
  prior_art_check: (id) => `/findings/${id}`,
};

export function DashboardRoute(): React.JSX.Element {
  const dashboard = useApiQuery<DashboardResponse>(
    queryKeys.dashboard,
    "/v1/dashboard",
  );

  const data = dashboard.data;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Home"
        description="What needs attention, and what changed."
      />

      <PageBody className="space-y-4">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Needs attention</CardTitle>
              <span className="text-[11px] text-text-muted">
                {data?.needsAttention.length ?? 0} item
                {data?.needsAttention.length === 1 ? "" : "s"}
              </span>
            </CardHeader>

            {data === undefined ? (
              <CardBody className="text-[12px] text-text-muted">
                Loading…
              </CardBody>
            ) : data.needsAttention.length === 0 ? (
              <EmptyState
                title="Nothing is waiting on you"
                description="No overdue vendor responses, unreviewed findings or blocked reports."
              />
            ) : (
              <ul className="divide-y divide-border">
                {data.needsAttention.map((item, index) => (
                  <li key={`${item.kind}-${item.entityId}-${index}`}>
                    <AttentionRow item={item} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>What changed</CardTitle>
              <span className="text-[11px] text-text-muted">last 14 days</span>
            </CardHeader>

            {data === undefined ? (
              <CardBody className="text-[12px] text-text-muted">
                Loading…
              </CardBody>
            ) : data.whatChanged.length === 0 ? (
              <EmptyState
                title="No recent activity"
                description="Changes to findings, reports and disclosure appear here."
              />
            ) : (
              <ul className="divide-y divide-border">
                {data.whatChanged.slice(0, 12).map((item, index) => (
                  <li
                    key={`${item.kind}-${item.entityId}-${index}`}
                    className="flex items-start gap-2 px-3 py-2 text-[12px]"
                  >
                    <Mono className="shrink-0 text-text-muted">{item.ref}</Mono>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.title}</span>
                      <span className="text-text-muted">
                        {item.detail}
                        {item.actor === null ? "" : ` · ${item.actor.displayName}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-text-muted">
                      {formatDistanceToNowStrict(item.occurredAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Severity totals</CardTitle>
            <span className="text-[11px] text-text-muted">
              {data?.openCaseCount ?? 0} open case
              {data?.openCaseCount === 1 ? "" : "s"}
            </span>
          </CardHeader>
          <CardBody className="flex flex-wrap items-center gap-4">
            {data === undefined ? (
              <span className="text-[12px] text-text-muted">Loading…</span>
            ) : (
              <>
                <Total label="Critical" value={data.severityTotals.critical} />
                <Total label="High" value={data.severityTotals.high} />
                <Total label="Medium" value={data.severityTotals.medium} />
                <Total label="Low" value={data.severityTotals.low} />
                <Total label="None" value={data.severityTotals.none} />
                <Total label="Unscored" value={data.severityTotals.unscored} />
              </>
            )}
          </CardBody>
        </Card>
      </PageBody>
    </div>
  );
}

function AttentionRow({ item }: { item: AttentionItem }): React.JSX.Element {
  const route = ROUTE_FOR_ENTITY[item.entityType];
  const body = (
    <div className="flex items-start gap-2 px-3 py-2 text-[12px] hover:bg-surface-hover">
      <span className="w-40 shrink-0 text-[11px] uppercase tracking-wide text-text-muted">
        {ATTENTION_LABELS[item.kind]}
      </span>
      <Mono className="shrink-0 text-text-muted">{item.ref}</Mono>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{item.title}</span>
        {item.detail === null ? null : (
          <span className="text-text-muted">{item.detail}</span>
        )}
      </span>
      {item.severity === null ? null : (
        <SeverityBadge severity={item.severity} />
      )}
      {item.dueAt === null ? null : (
        <span className="shrink-0 text-text-muted">
          {formatDistanceToNowStrict(item.dueAt)}
        </span>
      )}
    </div>
  );

  if (route === undefined) {
    return body;
  }

  return (
    <Link to={route(item.entityId)} className="block">
      {body}
    </Link>
  );
}

function Total({
  label,
  value,
}: {
  label: string;
  value: number;
}): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-mono text-[16px] tabular-nums">{value}</span>
      <span className="text-[11px] uppercase tracking-wide text-text-muted">
        {label}
      </span>
    </div>
  );
}
