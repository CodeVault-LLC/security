import { ArrowLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

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
  ErrorState,
  LoadingState,
  Mono,
  StateBadge,
} from "@codevault/ui";

import { AttachmentSelector } from "../features/submissions/attachment-selector.js";
import { ManualDeliveryPanel } from "../features/submissions/manual-delivery-panel.js";
import { PackageReview } from "../features/submissions/package-review.js";
import { SubmissionComposer } from "../features/submissions/submission-composer.js";
import { SubmissionValidator } from "../features/submissions/submission-validator.js";
import { bridge } from "../lib/bridge.js";
import {
  errorHeading,
  queryKeys,
  useApiMutation,
  useApiQuery,
} from "../lib/api.js";
import { canWrite, useSession } from "../lib/session.js";

export function SubmissionDetailRoute({
  submissionId,
}: {
  submissionId: string;
}): React.JSX.Element {
  const user = useSession((state) => state.user);
  const [error, setError] = useState<string | null>(null);
  const detail = useApiQuery<SubmissionDetail>(
    queryKeys.submission(submissionId),
    `/v1/submissions/${submissionId}`,
  );
  const validation = useApiQuery<SubmissionValidationResult>(
    queryKeys.submissionValidation(submissionId),
    `/v1/submissions/${submissionId}/validation`,
  );
  const invalidate = () =>
    [
      queryKeys.submission(submissionId),
      queryKeys.submissionValidation(submissionId),
      queryKeys.dashboard,
    ] as const;

  const update = useApiMutation<
    SubmissionDetail,
    {
      subject: string;
      bodyMarkdown: string;
      manualFields: Record<string, string>;
      expectedRevision: number;
    }
  >(
    (body) => ({
      path: `/v1/submissions/${submissionId}`,
      method: "PATCH",
      body,
    }),
    invalidate,
  );
  const review = useApiMutation<SubmissionDetail, number>(
    (expectedRevision) => ({
      path: `/v1/submissions/${submissionId}/review`,
      body: { expectedRevision },
    }),
    invalidate,
  );
  const attachments = useApiMutation<
    SubmissionDetail,
    {
      artifactIds: string[];
      reportExportId: string | null;
      expectedRevision: number;
    }
  >(
    (body) => ({
      path: `/v1/submissions/${submissionId}/attachments`,
      body,
    }),
    invalidate,
  );
  const approve = useApiMutation<SubmissionDetail, number>(
    (expectedRevision) => ({
      path: `/v1/submissions/${submissionId}/approve`,
      body: { expectedRevision },
    }),
    invalidate,
  );
  const record = useApiMutation<
    SubmissionDetail,
    {
      packageId: string;
      deliveredAt: string;
      destinationUrl: string;
      externalReference?: string;
    }
  >(
    (body) => ({
      path: `/v1/submissions/${submissionId}/manual-deliveries`,
      body,
    }),
    invalidate,
  );

  if (detail.isLoading) return <LoadingState label="Loading submission…" />;
  if (detail.error !== null || detail.data === undefined) {
    return (
      <ErrorState
        title={errorHeading(detail.error)}
        description={
          detail.error?.message ?? "That submission could not be loaded."
        }
      />
    );
  }
  const submission = detail.data;
  const busy =
    update.isPending ||
    attachments.isPending ||
    review.isPending ||
    approve.isPending ||
    record.isPending;

  const downloadManualBundle = async (): Promise<void> => {
    setError(null);
    const outcome = await bridge().submissions.downloadManualBundle(
      submission.id,
    );
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    if (outcome.data.saved) await detail.refetch();
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/cases/$caseId" params={{ caseId: submission.caseId }}>
            <ArrowLeft className="size-3" aria-hidden />
            Case
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Mono>{submission.ref}</Mono>
            <StateBadge kind="validation" state={submission.status} />
          </div>
          <h1 className="truncate text-[15px] font-semibold">
            {submission.vendor.name} disclosure
          </h1>
        </div>
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader>
            <CardTitle>Submission content</CardTitle>
          </CardHeader>
          <CardBody>
            <SubmissionComposer
              key={`${submission.id}:${submission.revision}`}
              submission={submission}
              canEdit={canWrite(user)}
              saving={update.isPending}
              onSave={(body) =>
                update.mutate(
                  { ...body, expectedRevision: submission.revision },
                  {
                    onError: (mutationError) => setError(mutationError.message),
                  },
                )
              }
            />
          </CardBody>
        </Card>
        <div className="space-y-4">
          <AttachmentSelector
            key={`attachments:${submission.revision}`}
            submission={submission}
            busy={attachments.isPending}
            onSave={(body) =>
              attachments.mutate(
                { ...body, expectedRevision: submission.revision },
                {
                  onError: (mutationError) => setError(mutationError.message),
                },
              )
            }
          />
          <Card>
            <CardHeader>
              <CardTitle>Validation</CardTitle>
            </CardHeader>
            <CardBody>
              <SubmissionValidator result={validation.data} />
            </CardBody>
          </Card>
          <PackageReview
            submission={submission}
            validation={validation.data}
            busy={busy}
            onReview={() =>
              review.mutate(submission.revision, {
                onError: (mutationError) => setError(mutationError.message),
              })
            }
            onApprove={() =>
              approve.mutate(submission.revision, {
                onError: (mutationError) => setError(mutationError.message),
              })
            }
            onDownloadManualBundle={() => void downloadManualBundle()}
          />
          <ManualDeliveryPanel
            submission={submission}
            busy={record.isPending}
            onRecord={(body) =>
              record.mutate(body, {
                onError: (mutationError) => setError(mutationError.message),
              })
            }
          />
          {error === null ? null : (
            <p role="alert" className="text-[12px] text-danger">
              {error}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
