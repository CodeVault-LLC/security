import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { formatDistanceToNowStrict } from "../lib/dates.js";

import type {
  AttentionItem,
  DashboardResponse,
  EvaluationWorkspaceResponse,
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

const ATTENTION_ACTIONS: Record<AttentionItem["kind"], string> = {
  VENDOR_RESPONSE_DUE: "Open case",
  DISCLOSURE_DATE_APPROACHING: "Review timeline",
  CRITICAL_PRIVATE_FINDING: "Review finding",
  AWAITING_PEER_REVIEW: "Review finding",
  REPORT_AWAITING_APPROVAL: "Review report",
  STALE_AFFECTED_VERSIONS: "Verify versions",
  PRIOR_ART_NOT_RUN: "Check prior art",
  FAILED_BACKGROUND_JOB: "Inspect failure",
  PENDING_AI_PROPOSALS: "Review proposals",
  SUBMISSION_NEEDS_REVIEW: "Review submission",
  VENDOR_REPLY_NEEDS_REVIEW: "Review reply",
  VENDOR_INFORMATION_REQUEST_PENDING: "Draft response",
  VENDOR_ACKNOWLEDGEMENT_OVERDUE: "Draft follow-up",
  VENDOR_UPDATE_OVERDUE: "Draft follow-up",
  GMAIL_RECONNECT_REQUIRED: "Reconnect Gmail",
  SUBMISSION_SEND_FAILED: "Resolve delivery",
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
  const evaluation = useApiQuery<EvaluationWorkspaceResponse>(
    queryKeys.evaluationWorkspace,
    "/v1/evaluation-workspace",
  );

  const data = dashboard.data;
  const stats = metrics.data;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Home"
        description="Prioritized research work, recent changes, and workspace health."
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
          <div className="grid grid-cols-1 items-start gap-4 2xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
            <Card className="border-border-strong">
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
                        {item.detail === null ||
                        item.detail.trim() === item.title.trim() ? null : (
                          <span className="text-text-muted">{item.detail}</span>
                        )}
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

        {evaluation.data?.available === true ? (
          <EvaluationChecklist workspace={evaluation.data} />
        ) : null}

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

function EvaluationChecklist({
  workspace,
}: {
  workspace: Extract<EvaluationWorkspaceResponse, { available: true }>;
}): React.JSX.Element {
  const storageKey = `codevault.evaluation.${workspace.case.id}`;
  const [completed, setCompleted] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(
        window.localStorage.getItem(storageKey) ?? "[]",
      ) as unknown;
      return Array.isArray(stored)
        ? stored.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  });
  const steps = [
    {
      id: "case",
      label: "Open the synthetic sample case",
      to: `/cases/${workspace.case.id}`,
    },
    {
      id: "finding",
      label: "Review the recorded finding and prior-art conclusion",
      to: `/findings/${workspace.findingId}`,
    },
    {
      id: "evidence",
      label: "Inspect the sample evidence and custody metadata",
      to: `/cases/${workspace.case.id}`,
    },
    {
      id: "report",
      label: "Confirm that the internal report has no blocking issues",
      to: `/reports/${workspace.reportId}`,
    },
    {
      id: "export",
      label: "Export the sample report as PDF",
      to: `/reports/${workspace.reportId}`,
    },
  ];

  const toggle = (id: string): void => {
    const next = completed.includes(id)
      ? completed.filter((item) => item !== id)
      : [...completed, id];
    setCompleted(next);
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  };

  return (
    <Card aria-labelledby="evaluation-heading">
      <CardHeader>
        <div>
          <CardTitle id="evaluation-heading">Alpha 7 evaluation</CardTitle>
          <p className="mt-0.5 text-[11px] text-text-muted">
            Synthetic data in a disposable local workspace
          </p>
        </div>
        <span className="text-[11px] tabular-nums text-text-muted">
          {completed.length} of {steps.length} complete
        </span>
      </CardHeader>
      <ol className="divide-y divide-border">
        {steps.map((step) => (
          <li
            key={step.id}
            className="flex min-h-11 items-center gap-3 px-3 py-2"
          >
            <input
              type="checkbox"
              checked={completed.includes(step.id)}
              onChange={() => toggle(step.id)}
              aria-label={`Mark "${step.label}" complete`}
              className="size-4 shrink-0 accent-accent"
            />
            <Link
              to={step.to}
              className="min-w-0 flex-1 text-[12px] text-accent underline-offset-2 hover:underline"
            >
              {step.label}
            </Link>
          </li>
        ))}
      </ol>
      <div className="border-t border-border px-3 py-2 text-[11px] text-text-muted">
        Sample: <Mono>{workspace.case.ref}</Mono> {workspace.case.title}
      </div>
    </Card>
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
    <div className="flex min-h-16 items-center gap-3 px-3.5 py-2.5 text-[12px] transition-colors duration-100 group-hover:bg-surface-hover">
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 lg:grid-cols-[10rem_7rem_minmax(0,1fr)_auto_auto] lg:items-center">
        <span className="text-[11px] font-medium text-text-muted lg:col-start-1">
          {ATTENTION_LABELS[item.kind]}
        </span>
        <Mono className="row-start-2 text-text-muted lg:col-start-2 lg:row-start-1">
          {item.ref}
        </Mono>
        <span className="col-span-2 min-w-0 lg:col-span-1 lg:col-start-3 lg:row-start-1">
          <span className="block text-pretty font-medium">{item.title}</span>
          {item.detail === null ? null : (
            <span className="text-text-muted">{item.detail}</span>
          )}
        </span>
        {item.severity === null ? null : (
          <SeverityBadge
            severity={item.severity}
            className="col-start-2 row-start-1 justify-self-end lg:col-start-4"
          />
        )}
        {item.dueAt === null ? null : (
          <span className="col-start-2 row-start-2 shrink-0 text-right text-text-muted lg:col-start-5 lg:row-start-1">
            {formatDistanceToNowStrict(item.dueAt)}
          </span>
        )}
      </div>
      {route === undefined ? null : (
        <span className="inline-flex h-8 shrink-0 items-center gap-1 rounded-(--cv-radius) bg-accent px-2.5 text-[11px] font-medium leading-none text-accent-contrast shadow-sm transition-colors duration-100 group-hover:bg-accent-hover">
          {ATTENTION_ACTIONS[item.kind]}
          <ChevronRight aria-hidden className="size-3.5" />
        </span>
      )}
    </div>
  );

  if (route === undefined) {
    return body;
  }

  return (
    <Link
      to={route(item.entityId)}
      className="group block focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
    >
      {body}
    </Link>
  );
}
