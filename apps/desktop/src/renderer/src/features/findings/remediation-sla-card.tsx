import { CalendarClock } from "lucide-react";
import { useState } from "react";

import type {
  FindingDetail,
  RemediationSla,
  RemediationSlaSettings,
} from "@codevault/contracts";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  LoadingState,
} from "@codevault/ui";

import { QueryError } from "../../components/query-boundary.js";
import { formatDateTime, formatDistanceToNowStrict } from "../../lib/dates.js";
import { queryKeys, useApiMutation, useApiQuery } from "../../lib/api.js";

export function RemediationSlaCard({
  finding,
  canEdit,
}: {
  finding: FindingDetail;
  canEdit: boolean;
}): React.JSX.Element {
  const settings = useApiQuery<RemediationSlaSettings>(
    queryKeys.remediationSla(finding.id),
    `/v1/findings/${finding.id}/remediation-sla`,
  );
  const [targetDateOverride, setTargetDateOverride] = useState<string | null>(
    null,
  );
  const sla = settings.data?.sla ?? null;
  const targetDate =
    targetDateOverride ?? (sla === null ? "" : sla.targetAt.slice(0, 10));
  const save = useApiMutation<RemediationSla, void>(
    () => ({
      path: `/v1/findings/${finding.id}/remediation-sla`,
      method: "PATCH",
      body: {
        targetAt: `${targetDate}T23:59:59.999Z`,
        ...(sla === null ? {} : { expectedRevision: sla.revision }),
      },
    }),
    () => [queryKeys.remediationSla(finding.id), queryKeys.dashboard],
  );

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Remediation SLA</CardTitle>
          <p className="mt-0.5 text-[11px] text-text-muted">
            Deadline for a verified remediation outcome.
          </p>
        </div>
        <CalendarClock aria-hidden className="size-4 text-text-muted" />
      </CardHeader>
      {settings.error !== null ? (
        <QueryError query={settings} className="m-3" />
      ) : settings.isLoading ? (
        <LoadingState label="Loading remediation SLA…" />
      ) : (
        <CardBody className="space-y-3 text-[12px]">
          {sla === null ? (
            <p className="text-text-muted">No remediation deadline set.</p>
          ) : (
            <div>
              <span className={statusClass(sla.status)}>
                {sla.status.replaceAll("_", " ").toLowerCase()}
              </span>
              <p className="mt-1 text-text-muted">
                Target {formatDateTime(sla.targetAt)} ·{" "}
                {sla.status === "MET"
                  ? "resolved"
                  : formatDistanceToNowStrict(sla.targetAt)}
              </p>
            </div>
          )}
          {canEdit ? (
            <div className="flex items-end gap-2">
              <label className="min-w-0 flex-1 text-[11px] text-text-muted">
                Target date
                <Input
                  className="mt-1"
                  type="date"
                  value={targetDate}
                  onChange={(event) =>
                    setTargetDateOverride(event.target.value)
                  }
                />
              </label>
              <Button
                size="sm"
                variant="secondary"
                loading={save.isPending}
                disabled={targetDate.length === 0}
                onClick={() => save.mutate()}
              >
                {sla === null ? "Start tracking" : "Update"}
              </Button>
            </div>
          ) : null}
          {save.error === null ? null : (
            <p className="text-danger" role="alert">
              {save.error.message}
            </p>
          )}
        </CardBody>
      )}
    </Card>
  );
}

function statusClass(status: RemediationSla["status"]): string {
  if (status === "OVERDUE") return "font-medium text-danger";
  if (status === "AT_RISK") return "font-medium text-warning";
  return "font-medium text-success";
}
