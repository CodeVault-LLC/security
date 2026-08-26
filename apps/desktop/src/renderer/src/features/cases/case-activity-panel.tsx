import { FileDown } from "lucide-react";
import { useState } from "react";

import type { AuditEvent } from "@codevault/contracts";
import { exportAuditEventsCsv } from "@codevault/exchange/audit-export";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  LoadingState,
  Mono,
} from "@codevault/ui";

import { Avatar } from "../../components/avatar.js";
import { QueryError } from "../../components/query-boundary.js";
import { queryKeys, useApiQuery } from "../../lib/api.js";
import { bridge } from "../../lib/bridge.js";
import { formatDateTime } from "../../lib/dates.js";

interface AuditPage {
  items: AuditEvent[];
  nextCursor: string | null;
}

export function CaseActivityPanel({
  caseId,
}: {
  caseId: string;
}): React.JSX.Element {
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const activity = useApiQuery<AuditPage>(
    queryKeys.activity({ caseId }),
    `/v1/activity?caseId=${encodeURIComponent(caseId)}&limit=200`,
  );
  const events = activity.data?.items ?? [];

  const exportCsv = async (): Promise<void> => {
    if (events.length === 0) return;
    setExporting(true);
    setMessage(null);
    try {
      const outcome = await bridge().audit.saveCsv(
        caseId,
        exportAuditEventsCsv(events),
      );
      if (!outcome.ok) {
        setMessage(`${outcome.message} Choose Export shown CSV to retry.`);
      } else if (outcome.data.saved) {
        setMessage(`CSV saved. SHA-256 ${outcome.data.sha256?.slice(0, 12)}…`);
      }
    } catch {
      setMessage("The activity CSV could not be saved.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Case activity</CardTitle>
          <p className="mt-0.5 text-[11px] text-text-muted">
            Latest 200 append-only events for this case.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto"
          loading={exporting}
          disabled={events.length === 0}
          onClick={() => void exportCsv()}
        >
          <FileDown aria-hidden className="size-3.5" />
          Export shown CSV
        </Button>
      </CardHeader>

      {message === null ? null : (
        <p
          className="border-b border-border px-3 py-2 text-[11px] text-text-muted"
          role="status"
        >
          {message}
        </p>
      )}

      {activity.error !== null ? (
        <QueryError query={activity} className="m-3" />
      ) : activity.isLoading ? (
        <LoadingState label="Loading case activity…" />
      ) : events.length === 0 ? (
        <EmptyState
          title="No case activity recorded yet"
          description="Sensitive changes will appear here as they occur."
        />
      ) : (
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[54rem] text-left text-[12px]">
              <thead className="border-b border-border text-[10px] uppercase tracking-wide text-text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Actor</th>
                  <th className="px-3 py-2 font-medium">Entity</th>
                  <th className="px-3 py-2 font-medium">Request</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {events.map((event) => (
                  <tr key={event.id}>
                    <td className="whitespace-nowrap px-3 py-2 text-text-muted">
                      {formatDateTime(event.occurredAt)}
                    </td>
                    <td className="px-3 py-2">
                      <Mono>{event.action}</Mono>
                    </td>
                    <td className="px-3 py-2">
                      {event.actor === null ? (
                        <span className="text-text-muted">system</span>
                      ) : (
                        <Avatar
                          avatarId={null}
                          userId={event.actor.id}
                          label={event.actor.displayName}
                          size="sm"
                          showLabel
                          className="gap-1.5"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-text-muted">
                      <span>{event.entityType}</span>
                      {event.entityId === null ? null : (
                        <Mono className="ml-2 text-[10px]">
                          {event.entityId.slice(0, 12)}
                        </Mono>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Mono className="text-[10px] text-text-muted">
                        {event.requestId ?? "—"}
                      </Mono>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      )}
    </Card>
  );
}
