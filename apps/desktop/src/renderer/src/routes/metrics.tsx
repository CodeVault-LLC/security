import { Link } from "@tanstack/react-router";
import { useState } from "react";

import type { MetricsResponse, MetricWindow } from "@codevault/contracts";
import { METRIC_WINDOWS } from "@codevault/contracts";
import {
  BarList,
  Button,
  ButtonGroup,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Funnel,
  Meter,
  Mono,
  severityChartSegments,
  StackedBar,
  StageBar,
  StatTile,
  TrendChart,
} from "@codevault/ui";

import { PageBody, PageHeader } from "../components/app-shell.js";
import { buildOperationalSignals } from "../features/metrics/operational-signals.js";
import { QueryBoundary } from "../components/query-boundary.js";
import { queryKeys, useApiQuery } from "../lib/api.js";
import { humanise } from "../lib/format.js";

/**
 * Metrics.
 *
 * The deep set, kept off the dashboard so the homepage stays readable. One
 * filter row scopes every chart on the page: per-chart controls would make it
 * impossible to know which slice two cards are comparing.
 *
 * Distributions are current totals and deliberately ignore the window. That is
 * stated on the page rather than left to be discovered, because a severity
 * breakdown that silently changed with the date range would be answering a
 * different question from the one its title asks.
 */

const WINDOW_LABELS: Record<MetricWindow, string> = {
  "30d": "30 days",
  "90d": "90 days",
  "365d": "1 year",
  all: "All time",
};

const STAGE_LABELS: Record<string, string> = {
  DISCOVERY_TO_CONTACT: "Discovery to vendor contact",
  CONTACT_TO_ACKNOWLEDGEMENT: "Contact to acknowledgement",
  ACKNOWLEDGEMENT_TO_FIX: "Acknowledgement to verified fix",
};

/**
 * Validation colouring.
 *
 * An ordinal ramp for the four states that form a pipeline, and separate tones
 * for the two that do not. Disputed and Invalid are terminal outcomes, not the
 * far end of a progression, and painting them the same green as Confirmed would
 * say a finding nobody could reproduce had reached the same place as one that
 * survived review.
 */
const VALIDATION_COLORS: Record<string, string> = {
  DRAFT: "--cv-severity-info",
  REPRODUCED: "--cv-info",
  PEER_REVIEWED: "--cv-accent",
  CONFIRMED: "--cv-success",
  DISPUTED: "--cv-warning",
  INVALID: "--cv-border-strong",
};

export function MetricsRoute(): React.JSX.Element {
  const [window, setWindow] = useState<MetricWindow>("90d");

  const metrics = useApiQuery<MetricsResponse>(
    queryKeys.metrics({ window }),
    `/v1/metrics?window=${window}`,
    // Holds the previous numbers while a new window loads, so switching the
    // range does not blank the page and jump the layout.
    { placeholderData: (previous) => previous },
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Metrics"
        description="Intake, validation, disclosure timing and weakness classes."
        actions={
          <ButtonGroup>
            {METRIC_WINDOWS.map((option) => (
              <Button
                key={option}
                size="sm"
                variant={option === window ? "primary" : "secondary"}
                onClick={() => setWindow(option)}
              >
                {WINDOW_LABELS[option]}
              </Button>
            ))}
          </ButtonGroup>
        }
      />

      <PageBody
        className={
          metrics.isFetching && metrics.data !== undefined
            ? "space-y-4 opacity-60 transition-opacity"
            : "space-y-4 transition-opacity"
        }
      >
        <QueryBoundary query={metrics} loadingLabel="Loading metrics…">
          {(data) => (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
                <StatTile label="Findings" value={data.totals.findings} />
                <StatTile label="Open cases" value={data.totals.openCases} />
                <StatTile label="Confirmed" value={data.totals.confirmed} />
                <StatTile
                  label="Awaiting review"
                  value={data.totals.awaitingReview}
                />
                <StatTile
                  label="Criticals unfixed"
                  value={data.totals.criticalsUnfixed}
                />
                <StatTile
                  label="Overdue replies"
                  value={data.totals.overdueVendorResponses}
                />
                <StatTile label="Published" value={data.totals.published} />
                <StatTile
                  label="Median ack"
                  value={
                    data.totals.medianAcknowledgementDays === null
                      ? "—"
                      : `${data.totals.medianAcknowledgementDays.toFixed(0)}d`
                  }
                  hint={
                    data.totals.medianAcknowledgementDays === null
                      ? "Too few coordinated cases"
                      : "Vendor acknowledgement"
                  }
                />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Operational signals</CardTitle>
                  <span className="text-[11px] text-text-muted">
                    derived from visible records
                  </span>
                </CardHeader>
                <ul className="grid grid-cols-1 divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-3">
                  {buildOperationalSignals(data).map((signal) => (
                    <li
                      key={signal.label}
                      className="min-w-0 border-b border-border px-4 py-3 last:border-b-0 md:[&:nth-child(n+3)]:border-t xl:[&:nth-child(n+3)]:border-t-0 xl:[&:nth-child(n+4)]:border-t"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[11px] font-medium text-text-muted">
                          {signal.label}
                        </span>
                        <span className="font-mono text-[18px] font-semibold tabular-nums text-text">
                          {signal.value}
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] leading-4 text-text-muted">
                        {signal.detail}
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Intake and publication</CardTitle>
                  <span className="text-[11px] text-text-muted">
                    by {data.bucket}, {WINDOW_LABELS[data.window].toLowerCase()}
                  </span>
                </CardHeader>
                <CardBody>
                  <TrendChart
                    caption="Findings opened and published over time"
                    buckets={data.trend.map((point) =>
                      formatBucket(point.bucketStart, data.bucket),
                    )}
                    series={[
                      {
                        key: "opened",
                        label: "Opened",
                        color: "--cv-accent",
                        points: data.trend.map((point) => point.opened),
                      },
                      {
                        key: "published",
                        label: "Published",
                        color: "--cv-success",
                        points: data.trend.map((point) => point.published),
                      },
                    ]}
                  />
                </CardBody>
              </Card>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Severity</CardTitle>
                    <span className="text-[11px] text-text-muted">
                      current total
                    </span>
                  </CardHeader>
                  <CardBody>
                    <StackedBar
                      caption="Findings by severity"
                      segments={severityChartSegments(data.severity)}
                    />
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Remediation</CardTitle>
                    <span className="text-[11px] text-text-muted">
                      current total
                    </span>
                  </CardHeader>
                  <CardBody>
                    <BarList
                      caption="Findings by remediation state"
                      items={data.remediation.map((entry) => ({
                        key: entry.state,
                        label: humanise(entry.state),
                        value: entry.count,
                        color:
                          entry.state === "FIX_VERIFIED"
                            ? "--cv-success"
                            : entry.state === "REGRESSED"
                              ? "--cv-danger"
                              : "--cv-warning",
                      }))}
                    />
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Validation</CardTitle>
                    <span className="text-[11px] text-text-muted">
                      current total
                    </span>
                  </CardHeader>
                  <CardBody>
                    <Funnel
                      caption="Findings by validation state"
                      steps={data.validation.map((entry) => ({
                        key: entry.state,
                        label: humanise(entry.state),
                        value: entry.count,
                        color: VALIDATION_COLORS[entry.state] ?? "--cv-accent",
                      }))}
                    />
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>External identifiers</CardTitle>
                    <span className="text-[11px] text-text-muted">
                      current total
                    </span>
                  </CardHeader>
                  <CardBody>
                    <BarList
                      caption="Findings by external identifier state"
                      items={data.externalId.map((entry) => ({
                        key: entry.state,
                        label: humanise(entry.state),
                        value: entry.count,
                        color: "--cv-info",
                      }))}
                    />
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Disclosure timing</CardTitle>
                    <span className="text-[11px] text-text-muted">
                      median and 90th percentile
                    </span>
                  </CardHeader>
                  <CardBody>
                    <StageBar
                      caption="Days per disclosure stage"
                      stages={data.stages.map((stage) => ({
                        key: stage.stage,
                        label: STAGE_LABELS[stage.stage] ?? stage.stage,
                        p50Days: stage.p50Days,
                        p90Days: stage.p90Days,
                        sampleSize: stage.sampleSize,
                        color: "--cv-accent",
                      }))}
                    />
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Disclosure posture</CardTitle>
                    <span className="text-[11px] text-text-muted">
                      current total
                    </span>
                  </CardHeader>
                  <CardBody>
                    <BarList
                      caption="Findings by disclosure state"
                      items={data.disclosure.map((entry) => ({
                        key: entry.state,
                        label: humanise(entry.state),
                        value: entry.count,
                        color: "--cv-info",
                      }))}
                    />
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Weakness classes</CardTitle>
                    <span className="text-[11px] text-text-muted">top 10</span>
                  </CardHeader>
                  <CardBody>
                    <BarList
                      caption="Findings by CWE"
                      items={data.cwe.map((entry) => ({
                        key: entry.cweId,
                        label: entry.cweId,
                        value: entry.count,
                      }))}
                    />
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Prior art</CardTitle>
                    <span className="text-[11px] text-text-muted">
                      novelty of the corpus
                    </span>
                  </CardHeader>
                  <CardBody>
                    <BarList
                      caption="Findings by prior-art conclusion"
                      items={data.priorArt.map((entry) => ({
                        key: entry.state,
                        label: humanise(entry.state),
                        value: entry.count,
                        color: priorArtColor(entry.state),
                      }))}
                    />
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Research coverage</CardTitle>
                    <span className="text-[11px] text-text-muted">
                      of {data.coverage.total} findings
                    </span>
                  </CardHeader>
                  <CardBody className="space-y-2">
                    <Meter
                      label="Approved score"
                      value={data.coverage.scored}
                      total={data.coverage.total}
                    />
                    <Meter
                      label="Weakness classified"
                      value={data.coverage.weaknessClassified}
                      total={data.coverage.total}
                    />
                    <Meter
                      label="Asset linked"
                      value={data.coverage.assetLinked}
                      total={data.coverage.total}
                    />
                    <Meter
                      label="Evidence linked"
                      value={data.coverage.evidenceLinked}
                      total={data.coverage.total}
                    />
                    <Meter
                      label="Affected range recorded"
                      value={data.coverage.affectedRangeRecorded}
                      total={data.coverage.total}
                    />
                    <Meter
                      label="Prior art checked"
                      value={data.coverage.priorArtChecked}
                      total={data.coverage.total}
                    />
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Unresolved finding age</CardTitle>
                    <span className="text-[11px] text-text-muted">
                      excludes invalid and resolved
                    </span>
                  </CardHeader>
                  <CardBody>
                    <BarList
                      caption="Unresolved findings by age"
                      items={[
                        {
                          key: "under-30",
                          label: "Under 30 days",
                          value: data.age.under30Days,
                        },
                        {
                          key: "30-89",
                          label: "30 to 89 days",
                          value: data.age.from30To89Days,
                        },
                        {
                          key: "90-179",
                          label: "90 to 179 days",
                          value: data.age.from90To179Days,
                        },
                        {
                          key: "180-plus",
                          label: "180 days or more",
                          value: data.age.atLeast180Days,
                        },
                      ].filter((entry) => entry.value > 0)}
                    />
                  </CardBody>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Most affected assets</CardTitle>
                  <span className="text-[11px] text-text-muted">
                    {data.topAssets.length} asset
                    {data.topAssets.length === 1 ? "" : "s"}
                  </span>
                </CardHeader>

                {data.topAssets.length === 0 ? (
                  <CardBody className="text-[12px] text-text-muted">
                    No findings are linked to an asset yet.
                  </CardBody>
                ) : (
                  <ul className="divide-y divide-border">
                    {data.topAssets.map((entry) => (
                      <li key={entry.assetId}>
                        <Link
                          to={`/assets/${entry.assetId}`}
                          className="flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-surface-hover"
                        >
                          <Mono className="w-24 shrink-0 text-text-muted">
                            {entry.ref}
                          </Mono>
                          <span className="w-52 shrink-0 truncate">
                            {entry.name}
                          </span>
                          <StackedBar
                            compact
                            className="min-w-0 flex-1"
                            caption={`Severity of findings against ${entry.name}`}
                            description={`${entry.name}: ${entry.total} findings by severity`}
                            segments={severityChartSegments(entry.severity)}
                          />
                          <span className="w-8 shrink-0 text-right font-mono tabular-nums">
                            {entry.total}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          )}
        </QueryBoundary>
      </PageBody>
    </div>
  );
}

/**
 * Prior-art colouring.
 *
 * Status rather than identity: these mean something on a scale from "nobody
 * looked" to "a person put their name to it being new", so they wear the status
 * tokens rather than a categorical hue.
 */
function priorArtColor(state: string): string {
  if (state === "HUMAN_CONFIRMED_NOVEL") {
    return "--cv-success";
  }

  if (state === "CONFIRMED_KNOWN" || state === "LIKELY_KNOWN") {
    return "--cv-danger";
  }

  if (state === "POSSIBLE_MATCH") {
    return "--cv-warning";
  }

  return "--cv-border-strong";
}

/** Axis labels: short enough to sit under a dense chart without wrapping. */
export function formatBucket(iso: string, bucket: string): string {
  const date = new Date(iso);

  if (bucket === "month") {
    return date.toLocaleDateString("en-GB", {
      month: "short",
      year: "2-digit",
    });
  }

  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
