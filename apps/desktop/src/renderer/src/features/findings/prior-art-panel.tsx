import { ExternalLink, RefreshCw, ShieldQuestion } from "lucide-react";
import { useState } from "react";

import type { PriorArtCheck, FindingDetail } from "@codevault/contracts";
import type { PriorArtState } from "@codevault/core";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Mono,
  PriorArtBadge,
} from "@codevault/ui";

import { bridge } from "../../lib/bridge.js";
import { formatDateTime } from "../../lib/dates.js";
import { queryKeys, useApiMutation, useApiQuery } from "../../lib/api.js";
import { QueryError } from "../../components/query-boundary.js";

/**
 * The prior-art tab.
 *
 * Shows what was searched, the exact queries, when they ran, what came back,
 * and what the AI made of it — then asks a person for the conclusion. The
 * button says "Check prior art", never "AI says zero-day", because the tool has
 * no business making that claim and a researcher's reputation rests on it.
 */

const HUMAN_CONCLUSIONS: Array<{
  state: PriorArtState;
  label: string;
  description: string;
}> = [
  {
    state: "CONFIRMED_KNOWN",
    label: "Mark known",
    description: "This is an already-published vulnerability.",
  },
  {
    state: "POSSIBLE_MATCH",
    label: "Mark possible match",
    description: "A candidate may describe the same issue.",
  },
  {
    state: "NO_PRIOR_ART_FOUND",
    label: "No prior art found",
    description:
      "The sources checked returned no convincing match, as of today. Not a claim that it has never existed.",
  },
  {
    state: "HUMAN_CONFIRMED_NOVEL",
    label: "Human confirmed novel",
    description:
      "You have reviewed the evidence and are recording this as novel under your own name.",
  },
];

export interface PriorArtPanelProps {
  finding: FindingDetail;
  canEdit: boolean;
}

export function PriorArtPanel({
  finding,
  canEdit,
}: PriorArtPanelProps): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);

  const checks = useApiQuery<{ items: PriorArtCheck[] }>(
    queryKeys.priorArt(finding.id),
    `/v1/findings/${finding.id}/prior-art-checks`,
  );

  const startCheck = useApiMutation<PriorArtCheck>(
    () => ({
      path: `/v1/findings/${finding.id}/prior-art-checks`,
      method: "POST",
      body: {},
    }),
    () => [queryKeys.priorArt(finding.id), queryKeys.finding(finding.id)],
  );

  const conclude = useApiMutation<
    PriorArtCheck,
    { checkId: string; state: PriorArtState }
  >(
    ({ checkId, state }) => ({
      path: `/v1/prior-art-checks/${checkId}/conclude`,
      method: "POST",
      body: { conclusion: state },
    }),
    () => [
      queryKeys.priorArt(finding.id),
      queryKeys.finding(finding.id),
      queryKeys.findings(),
    ],
  );

  const latest = checks.data?.items[0];
  const previous = checks.data?.items[1];

  const openExternal = (url: string): void => {
    void bridge().app.openExternal(url);
  };

  const newSinceLastCheck = new Set(
    previous === undefined
      ? []
      : (latest?.matches
          .filter(
            (match) =>
              !previous.matches.some(
                (old) =>
                  old.provider === match.provider &&
                  old.externalId === match.externalId,
              ),
          )
          .map((match) => match.id) ?? []),
  );

  return (
    <div className="space-y-4 p-4">
      <QueryError query={checks} />
      <Card>
        <CardHeader>
          <CardTitle>Prior art</CardTitle>
          <div className="flex items-center gap-2">
            <PriorArtBadge state={finding.priorArtState} />
            {canEdit ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() =>
                  startCheck.mutate(undefined, {
                    onError: (mutationError) => setError(mutationError.message),
                  })
                }
                disabled={startCheck.isPending}
              >
                {latest === undefined ? (
                  <ShieldQuestion aria-hidden className="size-3" />
                ) : (
                  <RefreshCw aria-hidden className="size-3" />
                )}
                {latest === undefined ? "Check prior art" : "Re-run check"}
              </Button>
            ) : null}
          </div>
        </CardHeader>

        {error === null ? null : (
          <CardBody className="text-[12px] text-danger">{error}</CardBody>
        )}

        {latest === undefined ? (
          <EmptyState
            title="No prior-art check has been run"
            description="Search CodeVault's own findings and the external advisory databases for anything describing the same issue."
          />
        ) : (
          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-[12px] text-text-muted">
              <span>
                Status:{" "}
                <span className="text-text">{latest.status.toLowerCase()}</span>
              </span>
              <span>Started {formatDateTime(latest.startedAt)}</span>
              {latest.completedAt === null ? null : (
                <span>Completed {formatDateTime(latest.completedAt)}</span>
              )}
              <span>by {latest.startedBy.displayName}</span>
            </div>

            <div>
              <h3 className="mb-1 text-[11px] uppercase tracking-wide text-text-muted">
                Sources checked
              </h3>
              <ul className="divide-y divide-border rounded-(--cv-radius) border border-border">
                {latest.sourcesChecked.map((source) => (
                  <li key={source.provider} className="px-2 py-1.5 text-[12px]">
                    <div className="flex items-center gap-2">
                      <Mono className="w-28 shrink-0">{source.provider}</Mono>
                      <span
                        className={
                          source.error === null
                            ? "text-text-muted"
                            : "text-warning"
                        }
                      >
                        {source.error ?? `${source.resultCount} result(s)`}
                      </span>
                      <span className="ml-auto text-text-muted">
                        {source.retrievedAt === null
                          ? "not run"
                          : formatDateTime(source.retrievedAt)}
                      </span>
                    </div>
                    {source.queries.length === 0 ? null : (
                      <ul className="mt-1 space-y-0.5">
                        {source.queries.map((query) => (
                          <li
                            key={query}
                            className="truncate font-mono text-[10.5px] text-text-muted"
                            title={query}
                          >
                            {query}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {latest.analysis === null ? null : (
              <div className="rounded-(--cv-radius) border border-accent/40 bg-accent/5 p-2">
                <h3 className="mb-1 text-[11px] uppercase tracking-wide text-accent">
                  AI comparison · advisory only
                </h3>
                <p className="text-[12px]">
                  <span className="font-medium">
                    {latest.analysis.conclusion
                      .replace(/_/g, " ")
                      .toLowerCase()}
                  </span>{" "}
                  <span className="text-text-muted">
                    (confidence {latest.analysis.confidence.toLowerCase()})
                  </span>
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[12px] text-text-muted">
                  {latest.analysis.reasoning}
                </p>
                {latest.analysis.missingChecks.length === 0 ? null : (
                  <div className="mt-2">
                    <p className="text-[11px] uppercase tracking-wide text-text-muted">
                      Suggested further checks
                    </p>
                    <ul className="list-disc pl-4 text-[12px] text-text-muted">
                      {latest.analysis.missingChecks.map((check) => (
                        <li key={check}>{check}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div>
              <h3 className="mb-1 text-[11px] uppercase tracking-wide text-text-muted">
                Candidates · {latest.matches.length}
                {previous === undefined
                  ? ""
                  : ` · ${newSinceLastCheck.size} new since the previous check`}
              </h3>

              {latest.matches.length === 0 ? (
                <p className="rounded-(--cv-radius) border border-border px-2 py-3 text-center text-[12px] text-text-muted">
                  Nothing came back from the sources that were checked.
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-(--cv-radius) border border-border">
                  {latest.matches.map((match) => (
                    <li key={match.id} className="px-2 py-1.5 text-[12px]">
                      <div className="flex items-center gap-2">
                        <Mono className="w-20 shrink-0 text-text-muted">
                          {match.provider}
                        </Mono>
                        <Mono className="w-36 shrink-0">
                          {match.externalId ?? "—"}
                        </Mono>
                        <span className="min-w-0 flex-1 truncate">
                          {match.title}
                        </span>
                        {newSinceLastCheck.has(match.id) ? (
                          <span className="shrink-0 rounded border border-info/50 px-1 text-[10px] uppercase text-info">
                            New
                          </span>
                        ) : null}
                        {match.aiRelationship === null ? null : (
                          <span className="shrink-0 text-[10px] uppercase text-text-muted">
                            AI: {match.aiRelationship.toLowerCase()}
                          </span>
                        )}
                        <span className="w-12 shrink-0 text-right font-mono text-text-muted">
                          {(match.similarity * 100).toFixed(0)}%
                        </span>
                        {match.url === null ? null : (
                          <button
                            type="button"
                            aria-label="Open the source"
                            className="shrink-0 text-text-muted hover:text-text"
                            onClick={() => openExternal(match.url as string)}
                          >
                            <ExternalLink aria-hidden className="size-3" />
                          </button>
                        )}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-text-muted">
                        {match.summary}
                      </p>
                      <p
                        className="mt-0.5 truncate font-mono text-[10.5px] text-text-muted"
                        title={match.query}
                      >
                        {match.query}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {canEdit && latest.status === "COMPLETED" ? (
              <div className="rounded-(--cv-radius) border border-border p-2">
                <h3 className="mb-1 text-[11px] uppercase tracking-wide text-text-muted">
                  Your conclusion
                </h3>
                <p className="mb-2 text-[12px] text-text-muted">
                  The AI comparison above is advisory. What CodeVault records is
                  the conclusion you put your name to.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {HUMAN_CONCLUSIONS.map((option) => (
                    <Button
                      key={option.state}
                      size="sm"
                      variant={
                        finding.priorArtState === option.state
                          ? "primary"
                          : "secondary"
                      }
                      title={option.description}
                      disabled={conclude.isPending}
                      onClick={() =>
                        conclude.mutate(
                          { checkId: latest.id, state: option.state },
                          {
                            onError: (mutationError) =>
                              setError(mutationError.message),
                          },
                        )
                      }
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
                {latest.concludedBy === null ? null : (
                  <p className="mt-2 text-[11px] text-text-muted">
                    Recorded by {latest.concludedBy.displayName} on{" "}
                    {formatDateTime(latest.concludedAt)}.
                  </p>
                )}
              </div>
            ) : null}
          </CardBody>
        )}
      </Card>
    </div>
  );
}
