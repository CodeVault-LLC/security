import { Timer } from "lucide-react";

import type { VendorResponseSla } from "@codevault/contracts";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  LoadingState,
} from "@codevault/ui";

import { QueryError } from "../../components/query-boundary.js";
import { formatDateTime, formatDistanceToNowStrict } from "../../lib/dates.js";
import { queryKeys, useApiQuery } from "../../lib/api.js";

export function VendorResponseSlaCard({
  submissionId,
}: {
  submissionId: string;
}): React.JSX.Element {
  const query = useApiQuery<VendorResponseSla>(
    queryKeys.vendorResponseSla(submissionId),
    `/v1/submissions/${submissionId}/vendor-response-sla`,
  );
  const sla = query.data;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Vendor response SLA</CardTitle>
          <p className="mt-0.5 text-[11px] text-text-muted">
            Acknowledgement and update cadence from the saved contact route.
          </p>
        </div>
        <Timer aria-hidden className="size-4 text-text-muted" />
      </CardHeader>
      {query.error !== null ? (
        <QueryError query={query} className="m-3" />
      ) : query.isLoading || sla === undefined ? (
        <LoadingState label="Loading vendor response SLA…" />
      ) : (
        <CardBody className="space-y-2 text-[12px]">
          <p className={statusClass(sla.status)}>
            {sla.status.replaceAll("_", " ").toLowerCase()}
          </p>
          {sla.sentAt === null ? (
            <p className="text-text-muted">
              Tracking starts when delivery is recorded.
            </p>
          ) : sla.firstResponseAt === null ? (
            <p className="text-text-muted">
              Acknowledgement due {formatDateTime(sla.acknowledgementDueAt!)} ·{" "}
              {formatDistanceToNowStrict(sla.acknowledgementDueAt!)}
            </p>
          ) : (
            <>
              <p className="text-text-muted">
                First response {formatDateTime(sla.firstResponseAt)}.
              </p>
              {sla.nextUpdateDueAt === null ? (
                <p className="text-text-muted">
                  The contact route does not define an update cadence.
                </p>
              ) : (
                <p className="text-text-muted">
                  Next update due {formatDateTime(sla.nextUpdateDueAt)} ·{" "}
                  {formatDistanceToNowStrict(sla.nextUpdateDueAt)}
                </p>
              )}
            </>
          )}
          <p className="text-[11px] text-text-muted">
            {sla.acknowledgementBusinessDays} business day acknowledgement
            target
            {sla.updateCadenceDays === null
              ? ""
              : ` · updates every ${sla.updateCadenceDays} days`}
          </p>
        </CardBody>
      )}
    </Card>
  );
}

function statusClass(status: VendorResponseSla["status"]): string {
  if (status.endsWith("OVERDUE")) return "font-medium text-danger";
  if (status === "NOT_STARTED") return "font-medium text-text-muted";
  if (status === "NO_UPDATE_CADENCE") return "font-medium text-warning";
  return "font-medium text-success";
}
