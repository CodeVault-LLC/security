import { Download, FileDown, KeyRound, Save } from "lucide-react";
import { useState } from "react";

import type {
  CorrespondenceMessage,
  CorrespondenceThread as CorrespondenceThreadData,
  SubmissionDetail,
} from "@codevault/contracts";
import { MESSAGE_CLASSIFICATIONS } from "@codevault/core";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Mono,
  Select,
  Spinner,
} from "@codevault/ui";

import { QueryBoundary, QueryError } from "../../components/query-boundary.js";
import {
  apiRequest,
  queryKeys,
  useApiMutation,
  useApiQuery,
} from "../../lib/api.js";
import { bridge } from "../../lib/bridge.js";
import { formatDateTime } from "../../lib/dates.js";
import { humanise } from "../../lib/format.js";
import { buildCorrespondenceTranscript } from "./correspondence-transcript.js";

export function CorrespondenceThread({
  submissionId,
  submissionStatus,
  submissionRevision,
}: {
  submissionId: string;
  submissionStatus: string;
  submissionRevision: number;
}): React.JSX.Element {
  const [plaintext, setPlaintext] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const thread = useApiQuery<CorrespondenceThreadData>(
    queryKeys.correspondence(submissionId),
    `/v1/submissions/${submissionId}/correspondence`,
  );
  const classify = useApiMutation<
    CorrespondenceMessage,
    { message: CorrespondenceMessage; classification: string }
  >(
    ({ message, classification }) => ({
      path: `/v1/submissions/${submissionId}/correspondence/${message.id}`,
      method: "PATCH",
      body: { classification, expectedRevision: message.revision },
    }),
    () => [queryKeys.correspondence(submissionId), queryKeys.dashboard],
  );
  const savePlaintext = useApiMutation<
    CorrespondenceMessage,
    { message: CorrespondenceMessage; bodyText: string }
  >(
    ({ message, bodyText }) => ({
      path: `/v1/submissions/${submissionId}/correspondence/${message.id}/reviewed-plaintext`,
      body: { bodyText, expectedRevision: message.revision },
    }),
    () => [queryKeys.correspondence(submissionId)],
  );
  const createReply = useApiMutation<SubmissionDetail, { messageId: string }>(
    ({ messageId }) => ({
      path: `/v1/submissions/${submissionId}/reply-draft`,
      body: { messageId, expectedRevision: submissionRevision },
    }),
    () => [
      queryKeys.submission(submissionId),
      queryKeys.submissionValidation(submissionId),
      queryKeys.correspondence(submissionId),
    ],
  );

  const decrypt = async (message: CorrespondenceMessage): Promise<void> => {
    setError(null);
    const outcome = await bridge().correspondence.decrypt(message.id);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    setPlaintext((current) => ({
      ...current,
      [message.id]: outcome.data.bodyText,
    }));
  };

  const download = async (artifactId: string): Promise<void> => {
    setError(null);
    try {
      const result = await apiRequest<{ url: string }>(
        `/v1/artifacts/${artifactId}`,
      );
      await bridge().app.openExternal(result.url);
    } catch (downloadError: unknown) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "Attachment download failed.",
      );
    }
  };

  const exportTranscript = async (): Promise<void> => {
    if (thread.data === undefined || thread.data.items.length === 0) return;
    setError(null);
    setExporting(true);
    const markdown = buildCorrespondenceTranscript({
      submissionId,
      generatedAt: new Date().toISOString(),
      messages: thread.data.items,
      localPlaintext: plaintext,
    });
    try {
      const outcome = await bridge().correspondence.exportTranscript(
        submissionId,
        markdown,
      );
      if (!outcome.ok) setError(outcome.message);
    } catch {
      setError("The correspondence transcript could not be saved.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vendor correspondence</CardTitle>
        {thread.data?.sync === null ||
        thread.data?.sync === undefined ? null : (
          <span
            className={
              thread.data.sync.status === "ACTIVE"
                ? "text-[11px] text-success"
                : "text-[11px] text-warning"
            }
          >
            Gmail {humanise(thread.data.sync.status)}
            {thread.data.sync.lastSuccessfulSyncAt === null
              ? ""
              : ` · synced ${formatDateTime(thread.data.sync.lastSuccessfulSyncAt)}`}
          </span>
        )}
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto"
          loading={exporting}
          disabled={(thread.data?.items.length ?? 0) === 0}
          onClick={() => void exportTranscript()}
        >
          <FileDown aria-hidden className="size-3" />
          Export transcript
        </Button>
      </CardHeader>
      <CardBody className="space-y-3">
        <QueryError query={thread} />
        <QueryBoundary query={thread} loadingLabel="Loading correspondence…">
          {(data) =>
            data.items.length === 0 ? (
              <p className="text-[12px] text-text-muted">
                No sent or received messages yet. This is a submission thread,
                not a mailbox view.
              </p>
            ) : (
              <div className="space-y-3">
                {data.items.map((message) => {
                  const localPlaintext = plaintext[message.id];
                  return (
                    <article
                      key={message.id}
                      className="rounded-(--cv-radius) border border-border p-3 text-[12px]"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={
                            message.direction === "INBOUND"
                              ? "font-medium text-accent"
                              : "font-medium"
                          }
                        >
                          {message.direction === "INBOUND"
                            ? "Vendor reply"
                            : "Sent"}
                        </span>
                        <span className="text-text-muted">
                          {formatDateTime(
                            message.receivedAt ??
                              message.sentAt ??
                              message.createdAt,
                          )}
                        </span>
                        {message.encrypted ? (
                          <span className="text-warning">
                            OpenPGP encrypted
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1">
                        <span className="text-text-muted">From:</span>{" "}
                        {message.from}
                      </p>
                      <p>
                        <span className="text-text-muted">To:</span>{" "}
                        {message.to.join(", ")}
                      </p>
                      <p>
                        <span className="text-text-muted">Subject:</span>{" "}
                        {message.subject}
                      </p>
                      {message.encrypted &&
                      localPlaintext === undefined &&
                      message.bodyText === null ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="mt-2"
                          onClick={() => void decrypt(message)}
                        >
                          <KeyRound className="size-3" aria-hidden /> Decrypt
                          locally
                        </Button>
                      ) : (
                        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-surface-raised p-2 font-sans">
                          {localPlaintext ?? message.bodyText ?? ""}
                        </pre>
                      )}
                      {localPlaintext === undefined ? null : (
                        <div className="mt-2 flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={savePlaintext.isPending}
                            onClick={() =>
                              savePlaintext.mutate(
                                { message, bodyText: localPlaintext },
                                {
                                  onSuccess: () =>
                                    setPlaintext((current) => {
                                      const next = { ...current };
                                      delete next[message.id];
                                      return next;
                                    }),
                                  onError: (mutationError) =>
                                    setError(mutationError.message),
                                },
                              )
                            }
                          >
                            <Save className="size-3" aria-hidden /> Save
                            reviewed plaintext to case
                          </Button>
                          <span className="text-text-muted">
                            Saving is permanent and audited.
                          </span>
                        </div>
                      )}
                      {message.attachments.length === 0 ? null : (
                        <ul className="mt-2 space-y-1">
                          {message.attachments.map((attachment) => (
                            <li
                              key={attachment.artifactId}
                              className="flex items-center gap-2"
                            >
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  void download(attachment.artifactId)
                                }
                              >
                                <Download className="size-3" aria-hidden />{" "}
                                {attachment.filename}
                              </Button>
                              <Mono className="text-text-muted">
                                {attachment.sha256.slice(0, 12)}
                              </Mono>
                            </li>
                          ))}
                        </ul>
                      )}
                      {message.direction === "INBOUND" ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {submissionStatus === "SENT" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={createReply.isPending}
                              onClick={() =>
                                createReply.mutate(
                                  { messageId: message.id },
                                  {
                                    onError: (mutationError) =>
                                      setError(mutationError.message),
                                  },
                                )
                              }
                            >
                              Draft reply in this thread
                            </Button>
                          ) : null}
                          <div className="w-56">
                            <Select
                              aria-label="Message classification"
                              value={message.classification}
                              onValueChange={(classification) =>
                                classify.mutate(
                                  { message, classification },
                                  {
                                    onError: (mutationError) =>
                                      setError(mutationError.message),
                                  },
                                )
                              }
                              options={MESSAGE_CLASSIFICATIONS.map((value) => ({
                                value,
                                label: humanise(value),
                              }))}
                            />
                            {classify.isPending ? (
                              <Spinner className="mt-1 size-3" />
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )
          }
        </QueryBoundary>
        {error === null ? null : (
          <p role="alert" className="text-[12px] text-danger">
            {error}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
