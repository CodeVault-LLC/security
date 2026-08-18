import { useState } from "react";

import type {
  Evidence,
  ReportExport,
  ReportSummary,
  SubmissionDetail,
} from "@codevault/contracts";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Label,
  Mono,
} from "@codevault/ui";

import { formatBytesApprox } from "../../lib/format.js";
import { queryKeys, useApiQuery } from "../../lib/api.js";

interface Page<T> {
  items: T[];
}

export function AttachmentSelector({
  submission,
  busy,
  onSave,
}: {
  submission: SubmissionDetail;
  busy: boolean;
  onSave: (input: {
    artifactIds: string[];
    reportExportId: string | null;
  }) => void;
}): React.JSX.Element {
  const [reportId, setReportId] = useState("");
  const [reportExportId, setReportExportId] = useState(
    submission.reportExportId ?? "",
  );
  const [artifactIds, setArtifactIds] = useState(
    () => new Set(submission.attachments.map((item) => item.artifactId)),
  );
  const evidence = useApiQuery<Page<Evidence>>(
    queryKeys.evidence({ caseId: submission.caseId }),
    `/v1/evidence?caseId=${submission.caseId}&limit=200`,
  );
  const reports = useApiQuery<Page<ReportSummary>>(
    queryKeys.reports(submission.caseId),
    `/v1/reports?caseId=${submission.caseId}`,
  );
  const exports = useApiQuery<Page<ReportExport>>(
    queryKeys.reportExports(reportId),
    `/v1/reports/${reportId}/exports`,
    { enabled: reportId.length > 0 },
  );
  const artifacts = (evidence.data?.items ?? [])
    .flatMap((item) => item.artifacts)
    .filter(
      (artifact) =>
        artifact.status === "STORED" && artifact.visibility !== "INTERNAL",
    );
  const completedExports = (exports.data?.items ?? []).filter(
    (item) => item.status === "COMPLETED" && item.format === "PDF",
  );
  const locked = !["DRAFT", "IN_REVIEW", "APPROVED"].includes(
    submission.status,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Approved report and evidence</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="submission-report">Vendor report</Label>
            <select
              id="submission-report"
              className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-[12px]"
              value={reportId}
              disabled={locked}
              onChange={(event) => {
                setReportId(event.target.value);
                setReportExportId("");
              }}
            >
              <option value="">Select approved vendor report</option>
              {(reports.data?.items ?? [])
                .filter(
                  (report) =>
                    report.audience === "VENDOR" &&
                    ["APPROVED", "PUBLISHED"].includes(report.status),
                )
                .map((report) => (
                  <option key={report.id} value={report.id}>
                    {report.ref} · {report.title}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <Label htmlFor="submission-export">Completed PDF</Label>
            <select
              id="submission-export"
              className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-[12px]"
              value={reportExportId}
              disabled={locked || reportId.length === 0}
              onChange={(event) => setReportExportId(event.target.value)}
            >
              <option value="">Select an export</option>
              {completedExports.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.createdAt} · {item.sha256?.slice(0, 12)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <ul className="max-h-56 divide-y divide-border overflow-auto rounded border border-border">
          {artifacts.map((artifact) => (
            <li
              key={artifact.id}
              className="flex items-center gap-2 px-2 py-1.5 text-[11px]"
            >
              <input
                type="checkbox"
                aria-label={`Attach ${artifact.filename}`}
                checked={artifactIds.has(artifact.id)}
                disabled={locked}
                onChange={(event) =>
                  setArtifactIds((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(artifact.id);
                    else next.delete(artifact.id);
                    return next;
                  })
                }
              />
              <span className="min-w-0 flex-1 truncate">
                {artifact.filename}
              </span>
              <span>{artifact.visibility.toLowerCase()}</span>
              <span>{formatBytesApprox(artifact.sizeBytes)}</span>
              <Mono title={artifact.sha256}>
                {artifact.sha256.slice(0, 10)}
              </Mono>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-text-muted">
          Internal, quarantined, deleted, and pending artifacts are hidden here
          and independently rejected by server validation.
        </p>
        <Button
          variant="secondary"
          size="sm"
          disabled={locked}
          loading={busy}
          onClick={() =>
            onSave({
              artifactIds: [...artifactIds],
              reportExportId: reportExportId || null,
            })
          }
        >
          Save attachment selection
        </Button>
      </CardBody>
    </Card>
  );
}
