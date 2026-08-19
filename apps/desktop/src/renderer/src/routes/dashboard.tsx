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
  StatTile,
  TrendChart,
} from "@codevault/ui";

import { PageBody, PageHeader } from "../components/app-shell.js";
import { Avatar } from "../components/avatar.js";
import { QueryError } from "../components/query-boundary.js";
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

      <PageBody className="space-y-4">
        {dashboard.error === null ? null : (
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
        )}

        {/* The charts fail independently of the lists below. A metrics outage
            must not take the operational half of the page with it. */}
        <QueryError query={metrics} />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Open findings"
            value={stats?.totals.findings ?? 0}
            {...(stats === undefined
              ? {}
              : { trend: stats.trend.map((point) => point.opened) })}
          />
          <StatTile
            label="Criticals unfixed"
            value={stats?.totals.criticalsUnfixed ?? 0}
            hint="Severe, and not yet remediated"
          />
          <StatTile
            label="Open cases"
            value={stats?.totals.openCases ?? data?.openCaseCount ?? 0}
          />
          <StatTile
            label="Median ack"
            value={
              stats?.totals.medianAcknowledgementDays == null
                ? "—"
                : `${stats.totals.medianAcknowledgementDays.toFixed(0)}d`
            }
            hint={
              stats?.totals.medianAcknowledgementDays == null
                ? "Too few coordinated cases"
                : "Vendor acknowledgement"
            }
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Severity</CardTitle>
            </CardHeader>
            <CardBody>
              {stats === undefined ? (
                <LoadingState className="py-2" />
              ) : (
                <StackedBar
                  caption="Findings by severity"
                  segments={severityChartSegments(stats.severity)}
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Intake</CardTitle>
              <span className="text-[11px] text-text-muted">last 90 days</span>
            </CardHeader>
            <CardBody>
              {stats === undefined ? (
                <LoadingState className="py-2" />
              ) : (
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
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Disclosure posture</CardTitle>
            </CardHeader>
            <CardBody>
              {stats === undefined ? (
                <LoadingState className="py-2" />
              ) : (
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
              )}
            </CardBody>
          </Card>
        </div>

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
              <LoadingState />
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
              <LoadingState />
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
