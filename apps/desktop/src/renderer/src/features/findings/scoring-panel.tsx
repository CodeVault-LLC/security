import { Check } from "lucide-react";
import { useMemo, useState } from "react";

import type { FindingDetail } from "@codevault/contracts";
import {
  calculateCvss31,
  calculateCvss40,
  CVSS31_METRICS,
  CVSS40_METRICS,
  searchCwe,
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

/**
 * Scoring.
 *
 * Metric by metric, with the score computed locally as a preview and
 * authoritatively by the server on submit. The researcher chooses values; the
 * number is derived. An AI suggestion arrives as a proposal that fills these
 * same fields, so the human always sees the metrics before the score exists.
 */

type Scheme = "CVSS40" | "CVSS31";

const SCHEME_METRICS = {
  CVSS40: CVSS40_METRICS.filter((metric) => metric.group === "Base"),
  CVSS31: CVSS31_METRICS.filter((metric) => metric.group === "Base"),
};

const DEFAULTS: Record<Scheme, Record<string, string>> = {
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
};

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
  const [cweQuery, setCweQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const proposed = useMemo(() => {
    const parts = Object.entries(metrics)
      .filter(([, value]) => value.length > 0)
      .map(([code, value]) => `${code}:${value}`)
      .join("/");
    const vector =
      scheme === "CVSS40" ? `CVSS:4.0/${parts}` : `CVSS:3.1/${parts}`;

    try {
      const result =
        scheme === "CVSS40" ? calculateCvss40(vector) : calculateCvss31(vector);

      return {
        vector: result.vector,
        score: result.score,
        severity: result.severity as SeverityRating,
        error: null as string | null,
      };
    } catch (calculationError: unknown) {
      return {
        vector,
        score: null,
        severity: null,
        error:
          calculationError instanceof Error
            ? calculationError.message
            : "That combination of metrics is not valid.",
      };
    }
  }, [metrics, scheme]);

  const submit = useApiMutation<FindingDetail, { approve: boolean }>(
    ({ approve }) => ({
      path: `/v1/findings/${finding.id}/scores`,
      method: "POST",
      body: { scheme, vector: proposed.vector, approve },
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

  return (
    <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Build a vector</CardTitle>
          <Select
            aria-label="Scoring scheme"
            value={scheme}
            onValueChange={(value) => {
              const next = value as Scheme;

              setScheme(next);
              setMetrics(DEFAULTS[next]);
            }}
            className="w-36"
            options={[
              { value: "CVSS40", label: "CVSS 4.0" },
              { value: "CVSS31", label: "CVSS 3.1" },
            ]}
          />
        </CardHeader>

        <CardBody className="space-y-2">
          {SCHEME_METRICS[scheme].map((metric) => (
            <div
              key={metric.code}
              className="grid grid-cols-[130px_1fr] items-center gap-2"
            >
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
                options={metric.values
                  .filter((value) => value.code !== "X")
                  .map((value) => ({
                    value: value.code,
                    label: `${value.code} · ${value.label}`,
                    description: value.description,
                  }))}
              />
            </div>
          ))}

          <div className="mt-3 rounded-[--radius] border border-border bg-surface-raised p-2">
            <div className="flex items-center gap-2">
              <SeverityBadge
                severity={proposed.severity}
                score={proposed.score}
              />
              <Mono className="min-w-0 flex-1 truncate text-text-muted">
                {proposed.vector}
              </Mono>
            </div>
            <p className="mt-1 text-[11px] text-text-muted">
              Shown as a preview. The stored score is computed by the server
              from this vector, so the number can never be entered by hand.
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
                Approve vector
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
            <ul className="divide-y divide-border">
              {finding.scores.map((score) => (
                <li key={score.id} className="px-3 py-2 text-[12px]">
                  <div className="flex items-center gap-2">
                    <Mono className="w-16 shrink-0">{score.scheme}</Mono>
                    {score.severity === null ? (
                      <span className="font-mono">{score.score ?? "—"}</span>
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
                    <p className="mt-0.5 text-text-muted">
                      Approved by {score.reviewedBy.displayName} on{" "}
                      {formatDateTime(score.reviewedAt)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
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
                    className="inline-flex items-center gap-1 rounded-[--radius] border border-border bg-surface-raised px-1.5 py-0.5 text-[11px]"
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
                  <ul className="divide-y divide-border rounded-[--radius] border border-border">
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
