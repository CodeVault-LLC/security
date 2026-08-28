import { Download, LockKeyhole, Send } from "lucide-react";

import type {
  SubmissionDetail,
  SubmissionValidationResult,
} from "@codevault/contracts";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Mono,
} from "@codevault/ui";

export function PackageReview({
  submission,
  validation,
  busy,
  canWrite,
  canApprove,
  canDisclose,
  onReview,
  onApprove,
  onDownloadManualBundle,
  onSealEmail,
  onSendEmail,
}: {
  submission: SubmissionDetail;
  validation: SubmissionValidationResult | undefined;
  busy: boolean;
  canWrite: boolean;
  canApprove: boolean;
  canDisclose: boolean;
  onReview: () => void;
  onApprove: () => void;
  onDownloadManualBundle: () => void;
  onSealEmail: () => void;
  onSendEmail: () => void;
}): React.JSX.Element {
  const blocking = validation?.blocking ?? true;
  const route = submission.routeSnapshot.route;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Exact package review</CardTitle>
        <Mono className="text-[11px] text-text-muted">
          revision {submission.revision}
        </Mono>
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="text-[12px]">
          <p>
            <span className="text-text-muted">Route:</span> {route.name} (
            {route.type.toLowerCase()})
          </p>
          <p>
            <span className="text-text-muted">Crypto:</span>{" "}
            {submission.cryptoMode.toLowerCase()}
          </p>
          {route.type === "EMAIL" ? (
            <p>
              <span className="text-text-muted">Recipients:</span>{" "}
              {route.to.join(", ")}
            </p>
          ) : (
            <p className="break-all">
              <span className="text-text-muted">Destination:</span>{" "}
              {route.destinationUrl}
            </p>
          )}
        </div>
        <ul className="divide-y divide-border rounded border border-border">
          {submission.attachments.map((attachment) => (
            <li
              key={attachment.artifactId}
              className="flex items-center gap-2 px-2 py-1.5 text-[11px]"
            >
              <span className="min-w-0 flex-1 truncate">
                {attachment.filename}
              </span>
              <span>{attachment.visibility.toLowerCase()}</span>
              <Mono title={attachment.sha256}>
                {attachment.sha256.slice(0, 12)}
              </Mono>
            </li>
          ))}
        </ul>

        {submission.status === "DRAFT" && canWrite ? (
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            onClick={onReview}
          >
            Start exact review
          </Button>
        ) : submission.status === "IN_REVIEW" && canApprove ? (
          <Button
            size="sm"
            variant="primary"
            disabled={blocking}
            loading={busy}
            onClick={onApprove}
          >
            <LockKeyhole className="size-3" aria-hidden />
            Approve exact content
          </Button>
        ) : submission.status === "APPROVED" &&
          route.type === "MANUAL" &&
          canWrite ? (
          <Button
            size="sm"
            variant="primary"
            disabled={blocking}
            loading={busy}
            onClick={onDownloadManualBundle}
          >
            <Download className="size-3" aria-hidden />
            Download sealed bundle
          </Button>
        ) : submission.status === "APPROVED" &&
          route.type === "EMAIL" &&
          canWrite ? (
          <Button
            size="sm"
            variant="primary"
            disabled={blocking}
            loading={busy}
            onClick={onSealEmail}
          >
            <LockKeyhole className="size-3" aria-hidden />
            Seal exact email
          </Button>
        ) : ["SEALED", "SEND_FAILED"].includes(submission.status) &&
          route.type === "EMAIL" &&
          canDisclose ? (
          <Button
            size="sm"
            variant="danger"
            loading={busy}
            onClick={onSendEmail}
          >
            <Send className="size-3" aria-hidden />
            {submission.status === "SEND_FAILED"
              ? "Review and retry send"
              : "Review and send now"}
          </Button>
        ) : (
          <p className="text-[12px] text-text-muted">
            Package status:{" "}
            {submission.status.toLowerCase().replaceAll("_", " ")}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
