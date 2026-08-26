import { Check } from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import type { FindingDetail } from "@codevault/contracts";
import {
  buildCwss10Vector,
  buildOwaspRiskVector,
  buildSsvcCoordinatorPublishVector,
  calculateCwss10,
  calculateCvss31,
  calculateCvss40,
  calculateOwaspRisk,
  calculateSsvcCoordinatorPublish,
  CWSS10_METRICS,
  CVSS31_METRICS,
  CVSS40_METRICS,
  OWASP_RISK_METRICS,
  searchCwe,
  SSVC_COORDINATOR_PUBLISH_METRICS,
  type SeverityRating,
} from "@codevault/standards";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  Mono,
  Select,
  SeverityBadge,
} from "@codevault/ui";

import { formatDateTime } from "../../lib/dates.js";
import { queryKeys, useApiMutation } from "../../lib/api.js";
import { Avatar } from "../../components/avatar.js";
import {
  intelligenceFreshness,
  isFreshnessTrackedIntelligence,
} from "./intelligence-freshness.js";

/**
 * Scoring.
 *
 * Metric by metric, with the score computed locally as a preview and
 * authoritatively by the server on submit. The researcher chooses values; the
 * number is derived. An AI suggestion arrives as a proposal that fills these
 * same fields, so the human always sees the metrics before the score exists.
 */

type CalculatedScheme = "CVSS40" | "CVSS31" | "CWSS10" | "OWASP_RR" | "SSVC";
type Scheme = CalculatedScheme | "EVSS";

const SCHEME_METRICS = {
  CVSS40: CVSS40_METRICS.filter((metric) => metric.group === "Base"),
  CVSS31: CVSS31_METRICS.filter((metric) => metric.group === "Base"),
  CWSS10: CWSS10_METRICS,
  OWASP_RR: OWASP_RISK_METRICS,
  SSVC: SSVC_COORDINATOR_PUBLISH_METRICS,
};

const DEFAULTS: Record<CalculatedScheme, Record<string, string>> = {
  CVSS40: {
    AV: "N",
    AC: "L",
    AT: "N",
    PR: "N",
    UI: "N",
    VC: "N",
    VI: "N",
    VA: "N",
    SC: "N",
    SI: "N",
    SA: "N",
  },
  CVSS31: {
    AV: "N",
    AC: "L",
    PR: "N",
    UI: "N",
    S: "U",
    C: "N",
    I: "N",
    A: "N",
  },
  CWSS10: Object.fromEntries(
    CWSS10_METRICS.map((metric) => [metric.code, "D"]),
  ),
  OWASP_RR: Object.fromEntries(
    OWASP_RISK_METRICS.map((metric) => [
      metric.code,
      metric.optional === true ? "X" : (metric.values[0]?.code ?? ""),
    ]),
  ),
  SSVC: { SI: "C", E: "N", VA: "P" },
};

const SCHEME_OPTIONS = [
  { value: "CVSS40", label: "CVSS 4.0" },
  { value: "CVSS31", label: "CVSS 3.1" },
  { value: "CWSS10", label: "MITRE CWSS 1.0" },
  { value: "OWASP_RR", label: "OWASP Risk Rating" },
  { value: "SSVC", label: "SSVC Coordinator Publish" },
  { value: "EVSS", label: "Edgescan EVSS" },
] as const;

function recordedScoreLabel(score: FindingDetail["scores"][number]): string {
  if (score.scheme === "CWSS10" && score.score !== null) {
    return `${score.score.toFixed(1)} / 100`;
  }

  if (score.scheme === "EVSS" && score.score !== null) {
    return `${score.score.toFixed(1)} / 10`;
  }

  if (score.scheme === "EPSS" && score.score !== null) {
    return `${(score.score * 100).toFixed(1)}%`;
  }

  const decision = score.metrics.decision;
  if (typeof decision === "string") {
    return decision.replaceAll("_", " ").toLowerCase();
  }

  const rating = score.metrics.rating;
  if (typeof rating === "string") {
    return rating.toLowerCase();
  }

  return score.score === null ? "—" : String(score.score);
}

export interface ScoringPanelProps {
  finding: FindingDetail;
  canEdit: boolean;
}

export function ScoringPanel({
  finding,
  canEdit,
}: ScoringPanelProps): React.JSX.Element {
  const [scheme, setScheme] = useState<Scheme>("CVSS40");
  const [metrics, setMetrics] = useState<Record<string, string>>(
    () => DEFAULTS.CVSS40,
  );
  const [externalScore, setExternalScore] = useState("");
  const [externalSource, setExternalSource] = useState("Edgescan");
  const [cweQuery, setCweQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const proposed = useMemo(() => {
    try {
      if (scheme === "EVSS") {
        const score = Number(externalScore);

        if (
          externalScore.trim().length === 0 ||
          !Number.isFinite(score) ||
          score < 0 ||
          score > 10
        ) {
          throw new Error(
            "EVSS must be a sourced Edgescan value from 0 to 10.",
          );
        }

        if (externalSource.trim().length === 0) {
          throw new Error(
            "Name the Edgescan report or integration that supplied this score.",
          );
        }

        return {
          vector: null,
          score,
          severity: null,
          label: `${score.toFixed(1)} / 10`,
          error: null as string | null,
        };
      }

      if (scheme === "CWSS10") {
        const result = calculateCwss10(buildCwss10Vector(metrics));
        return {
          vector: result.vector,
          score: result.score,
          severity: null,
          label: `${result.score.toFixed(1)} / 100`,
          error: null as string | null,
        };
      }

      if (scheme === "OWASP_RR") {
        const result = calculateOwaspRisk(buildOwaspRiskVector(metrics));
        return {
          vector: result.vector,
          score: null,
          severity: null,
          label: `${result.rating} · ${result.impactBasis.toLowerCase()} impact`,
          error: null as string | null,
        };
      }

      if (scheme === "SSVC") {
        const result = calculateSsvcCoordinatorPublish(
          buildSsvcCoordinatorPublishVector(metrics),
        );
        return {
          vector: result.vector,
          score: null,
          severity: null,
          label: result.decision.replaceAll("_", " "),
          error: null as string | null,
        };
      }

      const parts = Object.entries(metrics)
        .filter(([, value]) => value.length > 0)
        .map(([code, value]) => `${code}:${value}`)
        .join("/");
      const vector =
        scheme === "CVSS40" ? `CVSS:4.0/${parts}` : `CVSS:3.1/${parts}`;
      const result =
        scheme === "CVSS40" ? calculateCvss40(vector) : calculateCvss31(vector);

      return {
        vector: result.vector,
        score: result.score,
        severity: result.severity as SeverityRating,
        label: null,
        error: null as string | null,
      };
    } catch (calculationError: unknown) {
      return {
        vector: null,
        score: null,
        severity: null,
        label: null,
        error:
          calculationError instanceof Error
            ? calculationError.message
            : "That combination of metrics is not valid.",
      };
    }
  }, [externalScore, externalSource, metrics, scheme]);

  const submit = useApiMutation<FindingDetail, { approve: boolean }>(
    ({ approve }) => ({
      path: `/v1/findings/${finding.id}/scores`,
      method: "POST",
      body:
        scheme === "EVSS"
          ? {
              scheme,
              score: proposed.score,
              sourceName: externalSource.trim(),
              approve,
            }
          : { scheme, vector: proposed.vector, approve },
    }),
    () => [
      queryKeys.finding(finding.id),
      queryKeys.findings(),
      queryKeys.dashboard,
    ],
  );

  const approveExisting = useApiMutation<FindingDetail, string>(
    (scoreId) => ({
      path: `/v1/findings/${finding.id}/scores/${scoreId}/approve`,
      method: "POST",
    }),
    () => [queryKeys.finding(finding.id), queryKeys.findings()],
  );

  const setCwes = useApiMutation<FindingDetail, string[]>(
    (cweIds) => ({
      path: `/v1/findings/${finding.id}`,
      method: "PATCH",
      body: { cweIds, expectedRevision: finding.revision },
    }),
    () => [queryKeys.finding(finding.id)],
  );

  const cweSuggestions = useMemo(
    () => (cweQuery.trim().length === 0 ? [] : searchCwe(cweQuery, 6)),
    [cweQuery],
  );
  const staleIntelligenceCount = finding.scores.filter((score) => {
    return (
      score.source === "EXTERNAL" &&
      isFreshnessTrackedIntelligence(score.scheme) &&
      intelligenceFreshness(score.scheme, score.retrievedAt).state === "STALE"
    );
  }).length;

  return (
    <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Build an assessment</CardTitle>
          <Select
            aria-label="Scoring scheme"
            value={scheme}
            onValueChange={(value) => {
              const next = value as Scheme;

              setScheme(next);
              if (next !== "EVSS") {
                setMetrics(DEFAULTS[next]);
              }
            }}
            className="w-40 sm:w-52"
            options={[...SCHEME_OPTIONS]}
          />
        </CardHeader>

        <CardBody className="space-y-2">
          {scheme === "EVSS" ? (
            <div className="space-y-3">
              <div>
                <label
                  className="mb-1 block text-[12px] text-text-muted"
                  htmlFor="evss-score"
                >
                  EVSS score (0–10)
                </label>
                <Input
                  id="evss-score"
                  type="number"
                  min="0"
                  max="10"
                  step="0.1"
                  value={externalScore}
                  onChange={(event) => setExternalScore(event.target.value)}
                  disabled={!canEdit}
                />
              </div>
              <div>
                <label
                  className="mb-1 block text-[12px] text-text-muted"
                  htmlFor="evss-source"
                >
                  Edgescan source
                </label>
                <Input
                  id="evss-source"
                  value={externalSource}
                  onChange={(event) => setExternalSource(event.target.value)}
                  placeholder="Edgescan report or integration"
                  disabled={!canEdit}
                />
              </div>
              <p className="text-[11px] text-text-muted">
                EVSS is proprietary, so CodeVault records the supplied value and
                provenance; it does not recreate Edgescan’s formula.
              </p>
            </div>
          ) : (
            SCHEME_METRICS[scheme].map((metric, index, allMetrics) => (
              <Fragment key={metric.code}>
                {index === 0 ||
                allMetrics[index - 1]?.group !== metric.group ? (
                  <p className="pt-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    {metric.group}
                  </p>
                ) : null}
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-[150px_1fr] sm:items-center sm:gap-2">
                  <label
                    className="text-[12px] text-text-muted"
                    title={metric.name}
                    htmlFor={`metric-${metric.code}`}
                  >
                    <Mono>{metric.code}</Mono> {metric.name}
                  </label>
                  <Select
                    aria-label={metric.name}
                    value={metrics[metric.code]}
                    onValueChange={(value) =>
                      setMetrics((current) => ({
                        ...current,
                        [metric.code]: value,
                      }))
                    }
                    disabled={!canEdit}
                    options={metric.values.map((value) => ({
                      value: value.code,
                      label: `${value.code} · ${value.label}`,
                      description: value.description,
                    }))}
                  />
                </div>
              </Fragment>
            ))
          )}

          <div className="mt-3 rounded-(--cv-radius) border border-border bg-surface-raised p-2">
            <div className="flex items-center gap-2">
              {proposed.severity === null ? (
                <span className="font-mono text-[12px] font-semibold">
                  {proposed.label ?? "Unscored"}
                </span>
              ) : (
                <SeverityBadge
                  severity={proposed.severity}
                  score={proposed.score}
                />
              )}
              {proposed.vector === null ? null : (
                <Mono className="min-w-0 flex-1 truncate text-text-muted">
                  {proposed.vector}
                </Mono>
              )}
            </div>
            <p className="mt-1 text-[11px] text-text-muted">
              {scheme === "EVSS"
                ? "Shown as a preview. The server validates the value and retains its source."
                : "Shown as a preview. The server recomputes the result from the vector before storing it."}
            </p>
            {proposed.error === null ? null : (
              <p className="mt-1 text-[11px] text-danger">{proposed.error}</p>
            )}
          </div>

          {error === null ? null : (
            <p className="text-[12px] text-danger">{error}</p>
          )}

          {canEdit ? (
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={proposed.error !== null || submit.isPending}
                onClick={() =>
                  submit.mutate(
                    { approve: false },
                    { onError: (e) => setError(e.message) },
                  )
                }
              >
                Save as proposed
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={proposed.error !== null || submit.isPending}
                onClick={() =>
                  submit.mutate(
                    { approve: true },
                    { onError: (e) => setError(e.message) },
                  )
                }
              >
                <Check aria-hidden className="size-3" />
                Approve assessment
              </Button>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Recorded scores</CardTitle>
          </CardHeader>

          {finding.scores.length === 0 ? (
            <CardBody className="text-[12px] text-text-muted">
              No score has been recorded yet.
            </CardBody>
          ) : (
            <>
              {staleIntelligenceCount === 0 ? null : (
                <div
                  role="status"
                  className="border-b border-warning/35 bg-warning/10 px-3 py-2 text-[11px] text-warning"
                >
                  {staleIntelligenceCount} intelligence source
                  {staleIntelligenceCount === 1 ? " is" : "s are"} stale. Review
                  {staleIntelligenceCount === 1 ? " its" : " their"} retrieval
                  time before using it in a decision.
                </div>
              )}
              <ul className="divide-y divide-border">
                {finding.scores.map((score) => (
                  <li key={score.id} className="px-3 py-2 text-[12px]">
                    <div className="flex items-center gap-2">
                      <Mono className="w-16 shrink-0">{score.scheme}</Mono>
                      {score.severity === null ? (
                        <span className="font-mono">
                          {recordedScoreLabel(score)}
                        </span>
                      ) : (
                        <SeverityBadge
                          severity={score.severity}
                          score={score.score}
                        />
                      )}
                      <span className="rounded border border-border px-1 text-[10px] uppercase text-text-muted">
                        {score.reviewState.toLowerCase()}
                      </span>
                      <span className="text-[10px] uppercase text-text-muted">
                        {score.source.replace("_", " ").toLowerCase()}
                      </span>
                      {score.source === "EXTERNAL" &&
                      isFreshnessTrackedIntelligence(score.scheme) ? (
                        <IntelligenceFreshnessBadge
                          scheme={score.scheme}
                          retrievedAt={score.retrievedAt}
                        />
                      ) : null}
                      {canEdit && score.reviewState === "PROPOSED" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="ml-auto"
                          onClick={() => approveExisting.mutate(score.id)}
                          disabled={approveExisting.isPending}
                        >
                          Approve
                        </Button>
                      ) : null}
                    </div>
                    {score.vector === null ? null : (
                      <Mono className="mt-0.5 block truncate text-text-muted">
                        {score.vector}
                      </Mono>
                    )}
                    {score.sourceName === null ? null : (
                      <p className="mt-0.5 text-text-muted">
                        {score.sourceName}
                        {score.retrievedAt === null
                          ? ""
                          : ` · retrieved ${formatDateTime(score.retrievedAt)}`}
                      </p>
                    )}
                    {score.reviewedBy === null ? null : (
                      <div className="mt-0.5 flex items-center gap-1 text-text-muted">
                        <span>Approved by</span>
                        <Avatar
                          avatarId={null}
                          userId={score.reviewedBy.id}
                          label={score.reviewedBy.displayName}
                          size="sm"
                          showLabel
                          className="gap-1"
                        />
                        <span>on {formatDateTime(score.reviewedAt)}</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Weakness classification</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {finding.cweIds.length === 0 ? (
                <span className="text-[12px] text-text-muted">
                  No CWE assigned.
                </span>
              ) : (
                finding.cweIds.map((cweId) => (
                  <span
                    key={cweId}
                    className="inline-flex items-center gap-1 rounded-(--cv-radius) border border-border bg-surface-raised px-1.5 py-0.5 text-[11px]"
                  >
                    <Mono>{cweId}</Mono>
                    {canEdit ? (
                      <button
                        type="button"
                        aria-label={`Remove ${cweId}`}
                        className="text-text-muted hover:text-danger"
                        onClick={() =>
                          setCwes.mutate(
                            finding.cweIds.filter((id) => id !== cweId),
                          )
                        }
                      >
                        ×
                      </button>
                    ) : null}
                  </span>
                ))
              )}
            </div>

            {canEdit ? (
              <>
                <Input
                  value={cweQuery}
                  onChange={(event) => setCweQuery(event.target.value)}
                  placeholder="Search CWE by number or name…"
                  aria-label="Search CWE"
                />
                {cweSuggestions.length === 0 ? null : (
                  <ul className="divide-y divide-border rounded-(--cv-radius) border border-border">
                    {cweSuggestions.map((entry) => (
                      <li key={entry.id}>
                        <button
                          type="button"
                          className="flex w-full items-start gap-2 px-2 py-1.5 text-left text-[12px] hover:bg-surface-hover"
                          onClick={() => {
                            setCwes.mutate([
                              ...new Set([...finding.cweIds, entry.id]),
                            ]);
                            setCweQuery("");
                          }}
                        >
                          <Mono className="w-20 shrink-0">{entry.id}</Mono>
                          <span className="min-w-0">
                            <span className="block">{entry.name}</span>
                            <span className="block text-text-muted">
                              {entry.summary}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function IntelligenceFreshnessBadge({
  scheme,
  retrievedAt,
}: {
  scheme: string;
  retrievedAt: string | null;
}): React.JSX.Element {
  const freshness = intelligenceFreshness(scheme, retrievedAt);
  const label =
    freshness.state === "FRESH"
      ? "Fresh"
      : freshness.state === "STALE"
        ? "Stale"
        : "Age unknown";
  const description =
    freshness.ageDays === null
      ? `${scheme} has no valid retrieval timestamp.`
      : `${scheme} was retrieved ${freshness.ageDays.toFixed(1)} days ago; its freshness window is ${freshness.thresholdDays} days.`;

  return (
    <span
      title={description}
      className={
        freshness.state === "FRESH"
          ? "rounded border border-success/35 bg-success/10 px-1 text-[10px] text-success"
          : freshness.state === "STALE"
            ? "rounded border border-warning/35 bg-warning/10 px-1 text-[10px] text-warning"
            : "rounded border border-border px-1 text-[10px] text-text-muted"
      }
    >
      {label}
    </span>
  );
}
