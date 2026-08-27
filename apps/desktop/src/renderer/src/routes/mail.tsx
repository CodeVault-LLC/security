import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Inbox,
  LockKeyhole,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Star,
} from "lucide-react";
import { useMemo, useState } from "react";

import type {
  MailboxConnection,
  MailboxFolder,
  MailCategory,
  MailReadFilter,
  MailThreadAttachmentPreview,
  GmailThreadPreview,
  MailThreadDetail,
  MailThreadPage,
  MailThreadSummary,
  MailTrackingTargets,
  SubmissionDetail,
} from "@codevault/contracts";
import {
  Button,
  Card,
  EmptyState,
  FieldError,
  Input,
  Select,
  cn,
} from "@codevault/ui";

import { PageBody, PageHeader } from "../components/app-shell.js";
import { QueryBoundary, QueryError } from "../components/query-boundary.js";
import { queryKeys, useApiMutation, useApiQuery } from "../lib/api.js";
import { bridge } from "../lib/bridge.js";
import { formatDateTime } from "../lib/dates.js";
import { formatBytesApprox, humanise } from "../lib/format.js";

const FOLDERS: Array<{
  id: MailboxFolder;
  label: string;
  icon: React.JSX.Element;
}> = [
  { id: "INBOX", label: "Inbox", icon: <Inbox aria-hidden /> },
  { id: "SENT", label: "Sent", icon: <Send aria-hidden /> },
  { id: "TRACKED", label: "Tracked", icon: <ShieldCheck aria-hidden /> },
];

export interface MailRouteSearch {
  folder: MailboxFolder;
  connectionId?: string | undefined;
  threadId?: string | undefined;
  submissionId?: string | undefined;
}

function shortParticipants(thread: MailThreadSummary): string {
  return thread.participants.length === 0
    ? "Unknown participants"
    : thread.participants.slice(0, 2).join(", ");
}

export function MailRoute({
  search,
}: {
  search: MailRouteSearch;
}): React.JSX.Element {
  const navigate = useNavigate();
  const [mailQuery, setMailQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [readFilter, setReadFilter] = useState<MailReadFilter>("ALL");
  const [category, setCategory] = useState<MailCategory | "ALL">("ALL");
  const [pageToken, setPageToken] = useState<string | undefined>();
  const [previousTokens, setPreviousTokens] = useState<
    Array<string | undefined>
  >([]);
  const [trackingTargetId, setTrackingTargetId] = useState(
    search.submissionId ?? "",
  );
  const connections = useApiQuery<{ items: MailboxConnection[] }>(
    queryKeys.mailConnections,
    "/v1/mail/connections",
  );
  const trackedConnections = useMemo(
    () =>
      (connections.data?.items ?? []).filter(
        (connection) =>
          connection.provider === "gmail" &&
          connection.status === "ACTIVE" &&
          connection.capabilities.includes("TRACK_REPLIES"),
      ),
    [connections.data],
  );
  const selectedConnectionId =
    trackedConnections.find(
      (connection) => connection.id === search.connectionId,
    )?.id ??
    trackedConnections[0]?.id ??
    "";
  const listParameters = new URLSearchParams({ folder: search.folder });
  if (submittedQuery !== "") listParameters.set("query", submittedQuery);
  if (readFilter !== "ALL") listParameters.set("readFilter", readFilter);
  if (category !== "ALL") listParameters.set("category", category);
  if (pageToken !== undefined) listParameters.set("pageToken", pageToken);
  const threads = useApiQuery<MailThreadPage>(
    queryKeys.mailboxThreads(
      selectedConnectionId,
      search.folder,
      submittedQuery,
      readFilter,
      category,
      pageToken,
    ),
    `/v1/mail/connections/${selectedConnectionId}/threads?${listParameters.toString()}`,
    {
      enabled: selectedConnectionId !== "",
      placeholderData: (previous) => previous,
    },
  );
  const detail = useApiQuery<MailThreadDetail>(
    queryKeys.mailboxThread(selectedConnectionId, search.threadId ?? ""),
    `/v1/mail/connections/${selectedConnectionId}/threads/${encodeURIComponent(search.threadId ?? "")}`,
    { enabled: selectedConnectionId !== "" && search.threadId !== undefined },
  );
  const targets = useApiQuery<MailTrackingTargets>(
    queryKeys.mailTrackingTargets,
    "/v1/mail/tracking-targets",
    { enabled: detail.data !== undefined && detail.data.tracking === null },
  );
  const resolvedTrackingTargetId =
    targets.data?.items.some(
      (target) => target.submissionId === trackingTargetId,
    ) === true
      ? trackingTargetId
      : targets.data?.items.some(
            (target) => target.submissionId === search.submissionId,
          ) === true
        ? (search.submissionId ?? "")
        : "";
  const selectedTarget = targets.data?.items.find(
    (target) => target.submissionId === resolvedTrackingTargetId,
  );
  const trackingPreview = useApiQuery<GmailThreadPreview>(
    queryKeys.mailTrackingPreview(
      selectedConnectionId,
      search.threadId ?? "",
      selectedTarget?.submissionId ?? "",
    ),
    `/v1/mail/connections/${selectedConnectionId}/threads/${encodeURIComponent(search.threadId ?? "")}/tracking-preview?submissionId=${encodeURIComponent(selectedTarget?.submissionId ?? "")}`,
    {
      enabled:
        selectedConnectionId !== "" &&
        search.threadId !== undefined &&
        selectedTarget !== undefined,
    },
  );
  const track = useApiMutation<SubmissionDetail>(
    () => ({
      path: `/v1/submissions/${selectedTarget?.submissionId ?? ""}/gmail-thread/link`,
      body: {
        mailboxConnectionId: selectedConnectionId,
        threadReference: search.threadId,
        expectedRevision: selectedTarget?.revision,
      },
    }),
    (submission) => [
      queryKeys.mailboxThread(selectedConnectionId, search.threadId ?? ""),
      ["mailbox-threads"],
      queryKeys.mailTrackingTargets,
      queryKeys.submission(submission.id),
      queryKeys.correspondence(submission.id),
      queryKeys.dashboard,
    ],
  );

  const resetPagination = (): void => {
    setPageToken(undefined);
    setPreviousTokens([]);
  };

  const updateSearch = (next: Partial<MailRouteSearch>): void => {
    void navigate({
      to: "/mail",
      search: {
        ...search,
        ...next,
      },
    });
  };

  const selectThread = (threadId: string): void => {
    track.reset();
    updateSearch({
      connectionId: selectedConnectionId,
      threadId,
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Mail"
        description="Review disclosure conversations and choose which Gmail threads become part of the case record."
        actions={
          <>
            {trackedConnections.length > 1 ? (
              <div className="w-56">
                <Select
                  aria-label="Gmail mailbox"
                  value={selectedConnectionId}
                  options={trackedConnections.map((connection) => ({
                    value: connection.id,
                    label: connection.emailAddress,
                  }))}
                  onValueChange={(connectionId) => {
                    resetPagination();
                    updateSearch({ connectionId, threadId: undefined });
                  }}
                />
              </div>
            ) : null}
            <Button asChild variant="secondary">
              <Link to="/settings/mail">Mail settings</Link>
            </Button>
          </>
        }
      />
      <PageBody className="overflow-hidden p-0">
        <QueryBoundary query={connections} loadingLabel="Loading Gmail…">
          {() =>
            trackedConnections.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title="Connect Gmail to open Mail"
                  description="Reply tracking grants the read access needed to browse disclosure threads and receive vendor responses."
                  action={
                    <Button asChild variant="primary">
                      <Link to="/settings/mail">Connect Gmail</Link>
                    </Button>
                  }
                />
              </div>
            ) : (
              <div className="grid h-full min-h-0 grid-cols-[156px_360px_minmax(0,1fr)] max-lg:grid-cols-[300px_minmax(0,1fr)] max-md:block">
                <nav
                  aria-label="Mail folders"
                  className="border-r border-border bg-surface-raised/50 p-2 max-lg:col-span-2 max-lg:flex max-lg:border-b max-lg:border-r-0 max-md:flex"
                >
                  {FOLDERS.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      className={cn(
                        "flex h-9 w-full items-center gap-2 rounded-(--cv-radius) px-2.5 text-left text-[12px] font-medium transition-colors max-lg:w-auto",
                        folder.id === search.folder
                          ? "bg-surface text-text shadow-[inset_0_0_0_1px_var(--cv-border)]"
                          : "text-text-muted hover:bg-surface-hover hover:text-text",
                      )}
                      onClick={() => {
                        resetPagination();
                        updateSearch({
                          folder: folder.id,
                          threadId: undefined,
                        });
                      }}
                    >
                      <span className="[&>svg]:size-3.5">{folder.icon}</span>
                      {folder.label}
                    </button>
                  ))}
                </nav>

                <section
                  aria-label={`${search.folder.toLowerCase()} threads`}
                  className={cn(
                    "flex min-h-0 flex-col border-r border-border bg-surface",
                    search.threadId !== undefined && "max-md:hidden",
                  )}
                >
                  <form
                    className="space-y-2 border-b border-border p-2.5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      resetPagination();
                      setSubmittedQuery(mailQuery.trim());
                    }}
                  >
                    <div className="relative">
                      <Search
                        aria-hidden
                        className="absolute left-2.5 top-2.5 size-4 text-text-muted"
                      />
                      <Input
                        aria-label="Search mail"
                        className="pl-8 pr-9"
                        value={mailQuery}
                        maxLength={300}
                        placeholder="Search Gmail"
                        onChange={(event) => setMailQuery(event.target.value)}
                      />
                      {threads.isFetching ? (
                        <RefreshCw
                          aria-label="Refreshing"
                          className="absolute right-2.5 top-2.5 size-4 animate-spin text-text-muted motion-reduce:animate-none"
                        />
                      ) : null}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Select
                        aria-label="Message state"
                        value={readFilter}
                        options={[
                          { value: "ALL", label: "All mail" },
                          { value: "UNREAD", label: "Unread" },
                          { value: "READ", label: "Read" },
                          { value: "STARRED", label: "Starred" },
                          { value: "IMPORTANT", label: "Important" },
                        ]}
                        onValueChange={(value) => {
                          resetPagination();
                          setReadFilter(value as MailReadFilter);
                          updateSearch({ threadId: undefined });
                        }}
                      />
                      <Select
                        aria-label="Message category"
                        value={category}
                        options={[
                          { value: "ALL", label: "All categories" },
                          { value: "PRIMARY", label: "Primary" },
                          { value: "UPDATES", label: "Updates" },
                          { value: "FORUMS", label: "Forums" },
                          { value: "SOCIAL", label: "Social" },
                          { value: "PROMOTIONS", label: "Promotions" },
                        ]}
                        onValueChange={(value) => {
                          resetPagination();
                          setCategory(value as MailCategory | "ALL");
                          updateSearch({ threadId: undefined });
                        }}
                      />
                    </div>
                  </form>
                  {threads.isFetching && threads.data !== undefined ? (
                    <div
                      role="progressbar"
                      aria-label="Refreshing conversations"
                      className="h-0.5 overflow-hidden bg-accent/15"
                    >
                      <span className="block h-full w-1/3 animate-[mail-progress_1s_ease-in-out_infinite] bg-accent motion-reduce:animate-none" />
                    </div>
                  ) : null}
                  {threads.data === undefined && threads.error === null ? (
                    <MailThreadListSkeleton />
                  ) : (
                    <QueryBoundary
                      query={threads}
                      loadingLabel="Loading threads…"
                      className="m-4"
                    >
                      {(page) =>
                        page.items.length === 0 ? (
                          <div className="m-4">
                            <EmptyState
                              title={
                                submittedQuery === ""
                                  ? `No ${search.folder.toLowerCase()} threads`
                                  : "No matching threads"
                              }
                              description={
                                search.folder === "TRACKED"
                                  ? "Track a Gmail conversation to make it part of a disclosure case."
                                  : "Try another Gmail folder or a broader search."
                              }
                            />
                          </div>
                        ) : (
                          <div className="flex min-h-0 flex-1 flex-col">
                            <div className="flex h-8 shrink-0 items-center justify-between border-b border-border px-3 text-[10px] text-text-muted">
                              <span>
                                {page.items.length} conversation
                                {page.items.length === 1 ? "" : "s"}
                              </span>
                              <span>
                                {
                                  page.items.filter((item) => item.unread)
                                    .length
                                }{" "}
                                unread
                              </span>
                            </div>
                            <ul className="min-h-0 flex-1 overflow-y-auto">
                              {page.items.map((thread) => (
                                <ThreadRow
                                  key={thread.providerThreadId}
                                  thread={thread}
                                  selected={
                                    thread.providerThreadId === search.threadId
                                  }
                                  onSelect={() =>
                                    selectThread(thread.providerThreadId)
                                  }
                                />
                              ))}
                            </ul>
                          </div>
                        )
                      }
                    </QueryBoundary>
                  )}
                  {threads.data === undefined ||
                  (threads.data.nextPageToken === null &&
                    previousTokens.length === 0) ? null : (
                    <div className="flex items-center justify-between border-t border-border px-2.5 py-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={previousTokens.length === 0}
                        onClick={() => {
                          const tokens = [...previousTokens];
                          setPageToken(tokens.pop());
                          setPreviousTokens(tokens);
                        }}
                      >
                        <ChevronLeft aria-hidden /> Newer
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={threads.data.nextPageToken === null}
                        onClick={() => {
                          setPreviousTokens((current) => [
                            ...current,
                            pageToken,
                          ]);
                          setPageToken(
                            threads.data?.nextPageToken ?? undefined,
                          );
                        }}
                      >
                        Older <ChevronRight aria-hidden />
                      </Button>
                    </div>
                  )}
                </section>

                <main
                  className={cn(
                    "min-h-0 overflow-y-auto bg-surface-raised/25",
                    search.threadId === undefined && "max-md:hidden",
                  )}
                >
                  {search.threadId === undefined ? (
                    <div className="flex h-full items-center justify-center p-6">
                      <EmptyState
                        title="Select a conversation"
                        description="Message bodies are read from Gmail when you open a thread. Nothing is saved until you track it."
                      />
                    </div>
                  ) : (
                    <div className="mx-auto max-w-4xl p-5 max-md:p-3">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mb-3 hidden max-md:inline-flex"
                        onClick={() => updateSearch({ threadId: undefined })}
                      >
                        <ArrowLeft aria-hidden /> Back to threads
                      </Button>
                      {detail.data === undefined && detail.error === null ? (
                        <MailReaderSkeleton />
                      ) : (
                        <QueryBoundary
                          query={detail}
                          loadingLabel="Opening conversation…"
                        >
                          {(thread) => (
                            <ThreadReader
                              thread={thread}
                              targets={targets}
                              trackingTargetId={resolvedTrackingTargetId}
                              setTrackingTargetId={setTrackingTargetId}
                              track={track}
                              trackingPreview={trackingPreview}
                              canTrack={
                                selectedTarget !== undefined &&
                                trackingPreview.data !== undefined
                              }
                            />
                          )}
                        </QueryBoundary>
                      )}
                    </div>
                  )}
                </main>
              </div>
            )
          }
        </QueryBoundary>
      </PageBody>
    </div>
  );
}

function ThreadRow({
  thread,
  selected,
  onSelect,
}: {
  thread: MailThreadSummary;
  selected: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <li className="border-b border-border">
      <button
        type="button"
        className={cn(
          "w-full px-3 py-3 text-left transition-colors hover:bg-surface-hover",
          "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus",
          selected && "bg-accent/6 shadow-[inset_3px_0_0_var(--cv-accent)]",
        )}
        onClick={onSelect}
      >
        <div className="flex items-center gap-2">
          <p
            className={cn(
              "min-w-0 flex-1 truncate text-[12px]",
              thread.unread ? "font-semibold" : "font-medium",
            )}
          >
            {shortParticipants(thread)}
          </p>
          <time className="shrink-0 text-[10px] tabular-nums text-text-muted">
            {formatDateTime(thread.occurredAt)}
          </time>
        </div>
        <p className="mt-1 truncate text-[12px] text-text-muted">
          {thread.subject}
        </p>
        <div className="mt-2 flex items-center gap-2 text-[10px] text-text-muted">
          {thread.unread ? (
            <span
              className="size-1.5 rounded-full bg-accent"
              aria-label="Unread"
            />
          ) : null}
          {thread.tracking === null ? null : (
            <span className="inline-flex items-center gap-1 text-accent">
              <ShieldCheck aria-hidden className="size-3" />
              {thread.tracking.caseRef}
            </span>
          )}
          {thread.starred ? (
            <Star
              aria-label="Starred"
              className="size-3 fill-warning text-warning"
            />
          ) : null}
          {thread.important ? (
            <span className="font-medium text-warning">Important</span>
          ) : null}
          <span className="ml-auto">{humanise(thread.category)}</span>
        </div>
      </button>
    </li>
  );
}

function MailThreadListSkeleton(): React.JSX.Element {
  return (
    <div role="status" aria-label="Loading conversations" className="flex-1">
      <span className="sr-only">Loading conversations…</span>
      {["one", "two", "three", "four", "five", "six"].map((key) => (
        <div
          key={key}
          aria-hidden
          className="space-y-2 border-b border-border px-3 py-3"
        >
          <div className="h-3 w-2/3 animate-pulse rounded bg-surface-raised motion-reduce:animate-none" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-surface-raised motion-reduce:animate-none" />
          <div className="h-2.5 w-1/3 animate-pulse rounded bg-surface-raised motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

function MailReaderSkeleton(): React.JSX.Element {
  return (
    <div role="status" aria-label="Opening conversation" className="space-y-4">
      <span className="sr-only">Opening conversation…</span>
      <div
        aria-hidden
        className="h-5 w-2/3 animate-pulse rounded bg-surface motion-reduce:animate-none"
      />
      {["first", "second"].map((key) => (
        <div
          key={key}
          aria-hidden
          className="space-y-3 rounded-(--cv-radius-lg) border border-border bg-surface p-4"
        >
          <div className="h-3 w-1/4 animate-pulse rounded bg-surface-raised motion-reduce:animate-none" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-surface-raised motion-reduce:animate-none" />
          <div className="h-20 animate-pulse rounded bg-surface-raised motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

function AttachmentDownloadButton({
  connectionId,
  messageId,
  attachment,
}: {
  connectionId: string;
  messageId: string;
  attachment: MailThreadAttachmentPreview;
}): React.JSX.Element {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const outcome = await bridge().mail.downloadAttachment(
        connectionId,
        messageId,
        attachment.attachmentIndex,
      );
      if (!outcome.ok) setError(outcome.message);
    } catch {
      setError("The attachment could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Button
        size="sm"
        variant="secondary"
        loading={saving}
        title={`Save ${attachment.filename}`}
        onClick={() => void download()}
      >
        <Paperclip aria-hidden />
        <span className="max-w-64 truncate">{attachment.filename}</span>
        <span className="text-text-muted">
          {formatBytesApprox(attachment.sizeBytes)}
        </span>
        <Download aria-hidden />
      </Button>
      {error === null ? null : (
        <p role="alert" className="mt-1 max-w-64 text-[10px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function ThreadReader({
  thread,
  targets,
  trackingTargetId,
  setTrackingTargetId,
  track,
  trackingPreview,
  canTrack,
}: {
  thread: MailThreadDetail;
  targets: ReturnType<typeof useApiQuery<MailTrackingTargets>>;
  trackingTargetId: string;
  setTrackingTargetId: (id: string) => void;
  track: ReturnType<typeof useApiMutation<SubmissionDetail>>;
  trackingPreview: ReturnType<typeof useApiQuery<GmailThreadPreview>>;
  canTrack: boolean;
}): React.JSX.Element {
  return (
    <div>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-balance text-[18px] font-semibold tracking-[-0.015em]">
            {thread.subject}
          </h2>
          <p className="mt-1 text-[11px] text-text-muted">
            {thread.messages.length} message
            {thread.messages.length === 1 ? "" : "s"} · {thread.mailboxAddress}
          </p>
        </div>
        {thread.tracking === null ? null : (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-accent">
              <ShieldCheck aria-hidden className="size-3.5" />
              Tracked in {thread.tracking.caseRef}
            </span>
            <Button asChild size="sm" variant="primary">
              <Link
                to="/submissions/$submissionId"
                params={{ submissionId: thread.tracking.submissionId }}
                search={{ messageId: undefined }}
              >
                Reply in submission
              </Link>
            </Button>
          </div>
        )}
      </header>

      {thread.tooLarge ? (
        <Card className="p-4">
          <p className="text-[13px] font-medium">
            Conversation is too large to preview
          </p>
          <p className="mt-1 text-[12px] leading-5 text-text-muted">
            This thread has more than 100 messages. Open it in Gmail, or narrow
            the disclosure to a smaller thread before tracking it.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {thread.messages.map((message) => (
            <article
              key={message.providerMessageId}
              className="rounded-(--cv-radius-lg) border border-border bg-surface p-4 shadow-[0_1px_2px_oklch(0_0_0/0.025)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-[12px] font-medium">
                    {message.direction === "INBOUND" ? "Vendor reply" : "Sent"}
                  </p>
                  <p className="mt-0.5 break-all text-[11px] text-text-muted">
                    From {message.from} · To {message.to.join(", ")}
                  </p>
                </div>
                <time className="text-[10px] tabular-nums text-text-muted">
                  {formatDateTime(message.occurredAt)}
                </time>
              </div>
              {message.encrypted ? (
                <div className="mt-3 flex gap-2 rounded-(--cv-radius) bg-surface-raised p-3 text-[12px] text-text-muted">
                  <LockKeyhole aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <p>
                    OpenPGP encrypted. Track the thread, then use the local
                    reviewed-decryption flow from the submission.
                  </p>
                </div>
              ) : message.previewUnavailable ? (
                <p className="mt-3 rounded-(--cv-radius) bg-surface-raised p-3 text-[12px] text-text-muted">
                  This message uses a MIME structure that CodeVault cannot
                  preview safely. Open it in Gmail, or track the thread to use
                  the normal import checks.
                </p>
              ) : (
                <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-[12px] leading-5 text-text">
                  {message.bodyText || "Message has no plain-text body."}
                </pre>
              )}
              {message.attachments.length === 0 ? null : (
                <ul className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                  {message.attachments.map((attachment) => (
                    <li key={attachment.attachmentIndex}>
                      <AttachmentDownloadButton
                        connectionId={thread.mailboxConnectionId}
                        messageId={message.providerMessageId}
                        attachment={attachment}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}

      {thread.tracking !== null ? null : (
        <Card className="mt-4 p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-accent"
            />
            <div className="min-w-0 flex-1">
              <h3 className="text-[13px] font-medium">Track this disclosure</h3>
              <p className="mt-1 max-w-2xl text-pretty text-[11px] leading-4 text-text-muted">
                Tracking imports this conversation into the selected case,
                starts reply monitoring, and marks the draft submission as sent.
                The change is audited.
              </p>
              <QueryError query={targets} className="mt-3" />
              <QueryError query={trackingPreview} className="mt-3" />
              {trackingPreview.isFetching ? (
                <p role="status" className="mt-3 text-[11px] text-text-muted">
                  Checking thread participants against the saved vendor route…
                </p>
              ) : null}
              {trackingPreview.data?.warnings.length ? (
                <ul className="mt-3 space-y-1 rounded-(--cv-radius) border border-warning/30 bg-warning/8 p-3 text-[11px] text-text">
                  {trackingPreview.data.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
              {targets.data?.items.length === 0 ? (
                <div className="mt-3 rounded-(--cv-radius) bg-surface-raised p-3 text-[11px] text-text-muted">
                  No eligible email drafts. Create one from Disclosure, then
                  return here to track this thread.
                </div>
              ) : targets.data === undefined ? null : (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div className="min-w-64 flex-1">
                    <Select
                      aria-label="Disclosure submission"
                      placeholder="Choose a disclosure draft"
                      value={trackingTargetId}
                      options={targets.data.items.map((target) => ({
                        value: target.submissionId,
                        label: `${target.caseRef} · ${target.vendorName} · ${target.submissionRef}`,
                      }))}
                      onValueChange={(value) => {
                        track.reset();
                        setTrackingTargetId(value);
                      }}
                    />
                  </div>
                  <Button
                    variant="primary"
                    loading={track.isPending}
                    disabled={!canTrack || thread.tooLarge}
                    onClick={() => track.mutate()}
                  >
                    <ShieldCheck aria-hidden /> Track thread
                  </Button>
                </div>
              )}
              {track.error === null ? null : (
                <FieldError className="mt-3">{track.error.message}</FieldError>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
