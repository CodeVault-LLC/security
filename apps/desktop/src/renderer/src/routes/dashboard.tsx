import { Link } from "@tanstack/react-router";
import { formatDistanceToNowStrict } from "../lib/dates.js";

import type {
  AttentionItem,
  DashboardResponse,
  MetricsResponse,
} from "@codevault/contracts";
import {
  BarList,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  LoadingState,
  Mono,
  severityChartSegments,
  SeverityBadge,
  StackedBar,
  TrendChart,
} from "@codevault/ui";

import { PageBody, PageHeader } from "../components/app-shell.js";
import { Avatar } from "../components/avatar.js";
import { errorHeading, queryKeys, useApiQuery } from "../lib/api.js";
import { humanise } from "../lib/format.js";
import { formatBucket } from "./metrics.js";

/**
 * The dashboard.
 *
 * Three questions now: how does the corpus look, what needs me, and what moved.
 *
 * The quantitative strip leads, which is a deliberate reversal of the original
 * rule that severity totals must never be the headline. That rule was guarding
 * against a wall of donuts standing in for an operational view; it is not
 * violated by a dense strip that a researcher reads in a second and then scrolls
 * past. Needs Attention and What Changed are unchanged and still carry the
 * actionable work — "the vendor response on CASE-2026-0004 was due yesterday"
 * is a thing to do, and no chart replaces it.
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
  SUBMISSION_NEEDS_REVIEW: "Submission needs review",
  VENDOR_REPLY_NEEDS_REVIEW: "Review vendor reply",
  VENDOR_INFORMATION_REQUEST_PENDING: "Draft requested information",
  VENDOR_ACKNOWLEDGEMENT_OVERDUE: "Draft acknowledgement follow-up",
  VENDOR_UPDATE_OVERDUE: "Draft vendor follow-up",
  GMAIL_RECONNECT_REQUIRED: "Reconnect Gmail",
  SUBMISSION_SEND_FAILED: "Resolve delivery status",
};

const ROUTE_FOR_ENTITY: Record<string, (id: string) => string> = {
  finding: (id) => `/findings/${id}`,
  case: (id) => `/cases/${id}`,
  report: (id) => `/reports/${id}`,
  submission: (id) => `/submissions/${id}`,
  prior_art_check: (id) => `/findings/${id}`,
};

export function DashboardRoute(): React.JSX.Element {
  const dashboard = useApiQuery<DashboardResponse>(
    queryKeys.dashboard,
    "/v1/dashboard",
  );

  const metrics = useApiQuery<MetricsResponse>(
    queryKeys.metrics({ window: "90d" }),
    "/v1/metrics?window=90d",
  );

  const data = dashboard.data;
  const stats = metrics.data;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Home"
        description="Where the work stands, what needs attention, and what changed."
      />

      <PageBody className="space-y-6">
        {dashboard.error !== null ? (
          <ErrorState
            title={errorHeading(dashboard.error)}
            description={dashboard.error.message}
            action={
              <Button
                variant="secondary"
                size="sm"
                loading={dashboard.isFetching}
                onClick={() => void dashboard.refetch()}
              >
                Try again
              </Button>
            }
          />
        ) : data === undefined ? (
          <LoadingState label="Loading your workspace…" />
        ) : (
          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Needs attention</CardTitle>
                <span className="text-[11px] text-text-muted">
                  {data?.needsAttention.length ?? 0} item
                  {data?.needsAttention.length === 1 ? "" : "s"}
                </span>
              </CardHeader>

              {data.needsAttention.length === 0 ? (
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
                <span className="text-[11px] text-text-muted">
                  last 14 days
                </span>
              </CardHeader>

              {data.whatChanged.length === 0 ? (
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
                      <Mono className="shrink-0 text-text-muted">
                        {item.ref}
                      </Mono>
                      <div className="min-w-0 flex-1">
                        <span className="block truncate">{item.title}</span>
                        <span className="text-text-muted">{item.detail}</span>
                        {item.actor === null ? null : (
                          <div className="mt-0.5 flex items-center gap-1 text-text-muted">
                            <span>·</span>
                            <Avatar
                              avatarId={null}
                              userId={item.actor.id}
                              label={item.actor.displayName}
                              size="sm"
                              showLabel
                              className="gap-1"
                            />
                          </div>
                        )}
                      </div>
                      <span className="shrink-0 text-text-muted">
                        {formatDistanceToNowStrict(item.occurredAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}

        <details className="group border-t border-border pt-4">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-(--cv-radius) px-1 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            <span>Workspace overview</span>
            <span className="text-[11px] font-normal text-text-muted group-open:hidden">
              Severity, intake, and disclosure metrics
            </span>
            <span className="hidden text-[11px] font-normal text-text-muted group-open:inline">
              Hide metrics
            </span>
          </summary>

          <div className="mt-3 space-y-4">
            {metrics.error !== null ? (
              <ErrorState
                title={errorHeading(metrics.error)}
                description={metrics.error.message}
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={metrics.isFetching}
                    onClick={() => void metrics.refetch()}
                  >
                    Try again
                  </Button>
                }
              />
            ) : stats === undefined ? (
              <LoadingState label="Loading workspace metrics…" />
            ) : (
              <>
                <dl className="grid grid-cols-2 border-y border-border lg:grid-cols-4 lg:divide-x lg:divide-border">
                  <Metric label="Open findings" value={stats.totals.findings} />
                  <Metric
                    label="Criticals unfixed"
                    value={stats.totals.criticalsUnfixed}
                  />
                  <Metric label="Open cases" value={stats.totals.openCases} />
                  <Metric
                    label="Median acknowledgement"
                    value={
                      stats.totals.medianAcknowledgementDays == null
                        ? "—"
                        : `${stats.totals.medianAcknowledgementDays.toFixed(0)}d`
                    }
                  />
                </dl>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <Card>
                    <CardHeader>
                      <CardTitle>Severity</CardTitle>
                    </CardHeader>
                    <CardBody>
                      <StackedBar
                        caption="Findings by severity"
                        segments={severityChartSegments(stats.severity)}
                      />
                    </CardBody>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>Intake</CardTitle>
                      <span className="text-[11px] text-text-muted">
                        Last 90 days
                      </span>
                    </CardHeader>
                    <CardBody>
                      <TrendChart
                        caption="Findings opened over the last 90 days"
                        buckets={stats.trend.map((point) =>
                          formatBucket(point.bucketStart, stats.bucket),
                        )}
                        series={[
                          {
                            key: "opened",
                            label: "Opened",
                            color: "--cv-accent",
                            points: stats.trend.map((point) => point.opened),
                          },
                        ]}
                      />
                    </CardBody>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>Disclosure posture</CardTitle>
                    </CardHeader>
                    <CardBody>
                      <BarList
                        caption="Findings by disclosure state"
                        items={stats.disclosure
                          .filter((entry) => entry.count > 0)
                          .map((entry) => ({
                            key: entry.state,
                            label: humanise(entry.state),
                            value: entry.count,
                            color: "--cv-info",
                          }))}
                      />
                    </CardBody>
                  </Card>
                </div>
              </>
            )}
          </div>
        </details>
      </PageBody>
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}): React.JSX.Element {
  return (
    <div className="px-3 py-3">
      <dt className="text-[11px] text-text-muted">{label}</dt>
      <dd className="mt-1 text-[20px] font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function AttentionRow({ item }: { item: AttentionItem }): React.JSX.Element {
  const route = ROUTE_FOR_ENTITY[item.entityType];
  const body = (
    <div className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-3 py-2.5 text-[12px] hover:bg-surface-hover lg:grid-cols-[10rem_7rem_minmax(0,1fr)_auto_auto] lg:items-start">
      <span className="text-[11px] font-medium text-text-muted">
        {ATTENTION_LABELS[item.kind]}
      </span>
      <Mono className="row-start-2 text-text-muted lg:row-start-auto">
        {item.ref}
      </Mono>
      <span className="min-w-0 lg:row-start-auto">
        <span className="block text-pretty">{item.title}</span>
        {item.detail === null ? null : (
          <span className="text-text-muted">{item.detail}</span>
        )}
      </span>
      {item.severity === null ? null : (
        <SeverityBadge severity={item.severity} />
      )}
      {item.dueAt === null ? null : (
        <span className="shrink-0 text-right text-text-muted">
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
