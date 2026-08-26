import { RefreshCw } from "lucide-react";
import { useState } from "react";

import type {
  FindingDetail,
  IntelligenceRefreshPolicy,
  IntelligenceRefreshSettings,
} from "@codevault/contracts";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  LoadingState,
  Select,
} from "@codevault/ui";

import { QueryError } from "../../components/query-boundary.js";
import { queryKeys, useApiMutation, useApiQuery } from "../../lib/api.js";
import { formatDateTime, formatDistanceToNowStrict } from "../../lib/dates.js";

export function IntelligenceRefreshControls({
  finding,
  canEdit,
}: {
  finding: FindingDetail;
  canEdit: boolean;
}): React.JSX.Element {
  const [message, setMessage] = useState<string | null>(null);
  const settings = useApiQuery<IntelligenceRefreshSettings>(
    queryKeys.intelligenceRefresh(finding.id),
    `/v1/findings/${finding.id}/intelligence-refresh`,
  );
  const setPolicy = useApiMutation<
    IntelligenceRefreshPolicy,
    { cadence: "DAILY" | "WEEKLY"; enabled: boolean; revision?: number }
  >(
    ({ cadence, enabled, revision }) => ({
      path: `/v1/findings/${finding.id}/intelligence-refresh`,
      method: "PATCH",
      body: {
        cadence,
        enabled,
        ...(revision === undefined ? {} : { expectedRevision: revision }),
      },
    }),
    () => [queryKeys.intelligenceRefresh(finding.id)],
  );
  const runNow = useApiMutation<{ queuedAt: string }>(
    () => ({
      path: `/v1/findings/${finding.id}/intelligence-refresh/run`,
      method: "POST",
    }),
    () => [
      queryKeys.intelligenceRefresh(finding.id),
      queryKeys.finding(finding.id),
    ],
  );
  const cveCount = (finding.identifiers ?? []).filter(
    (identifier) => identifier.scheme === "CVE",
  ).length;
  const policy = settings.data?.policy ?? null;
  const cadence = policy?.cadence ?? "DAILY";
  const error = setPolicy.error ?? runNow.error;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>EPSS and KEV refresh</CardTitle>
          <p className="mt-0.5 text-[11px] text-text-muted">
            Retrieve current external intelligence for attached CVE identifiers.
          </p>
        </div>
        {canEdit ? (
          <Button
            size="sm"
            variant="secondary"
            loading={runNow.isPending}
            disabled={cveCount === 0}
            onClick={() =>
              runNow.mutate(undefined, {
                onSuccess: (result) =>
                  setMessage(
                    `Refresh queued ${formatDateTime(result.queuedAt)}.`,
                  ),
              })
            }
          >
            <RefreshCw aria-hidden className="size-3.5" />
            Refresh now
          </Button>
        ) : null}
      </CardHeader>
      {settings.error !== null ? (
        <QueryError query={settings} className="m-3" />
      ) : settings.isLoading ? (
        <LoadingState label="Loading refresh policy…" />
      ) : (
        <CardBody className="space-y-3">
          {cveCount === 0 ? (
            <p className="text-[12px] text-warning">
              Add a CVE identifier before retrieving EPSS or KEV data.
            </p>
          ) : (
            <p className="text-[12px] text-text-muted">
              {cveCount} CVE identifier{cveCount === 1 ? "" : "s"} will be
              checked. Scheduled refreshes read the current identifiers at run
              time.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-40">
              <p className="mb-1 text-[11px] text-text-muted">Cadence</p>
              <Select
                value={cadence}
                disabled={!canEdit || cveCount === 0 || setPolicy.isPending}
                onValueChange={(value) =>
                  setPolicy.mutate({
                    cadence: value as "DAILY" | "WEEKLY",
                    enabled: policy?.enabled ?? false,
                    ...(policy === null ? {} : { revision: policy.revision }),
                  })
                }
                options={[
                  { value: "DAILY", label: "Daily at 03:00 UTC" },
                  { value: "WEEKLY", label: "Mondays at 03:00 UTC" },
                ]}
              />
            </div>
            {canEdit ? (
              <Button
                size="sm"
                variant={policy?.enabled ? "secondary" : "primary"}
                loading={setPolicy.isPending}
                disabled={cveCount === 0}
                onClick={() =>
                  setPolicy.mutate({
                    cadence,
                    enabled: !(policy?.enabled ?? false),
                    ...(policy === null ? {} : { revision: policy.revision }),
                  })
                }
              >
                {policy?.enabled ? "Pause schedule" : "Enable schedule"}
              </Button>
            ) : null}
          </div>
          <p className="text-[11px] text-text-muted">
            {policy === null
              ? "No recurring refresh is configured."
              : policy.enabled && policy.nextRunAt !== null
                ? `Next refresh ${formatDistanceToNowStrict(policy.nextRunAt)}.`
                : "Recurring refresh is paused."}
            {policy?.lastQueuedAt === null || policy?.lastQueuedAt === undefined
              ? ""
              : ` Last queued ${formatDateTime(policy.lastQueuedAt)}.`}
          </p>
          {message === null ? null : (
            <p className="text-[11px] text-success" role="status">
              {message}
            </p>
          )}
          {error === null ? null : (
            <p className="text-[11px] text-danger">{error.message}</p>
          )}
        </CardBody>
      )}
    </Card>
  );
}
