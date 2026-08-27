import { Link } from "@tanstack/react-router";
import { AlertTriangle, Link2, Mail, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  GmailThreadPreview,
  GmailThreadSearchResults,
  MailboxConnection,
  SubmissionDetail,
} from "@codevault/contracts";
import {
  Button,
  FieldDescription,
  FieldError,
  Input,
  Label,
  Select,
} from "@codevault/ui";

import { queryKeys, useApiMutation, useApiQuery } from "../../lib/api.js";
import { formatDateTime } from "../../lib/dates.js";

export function LinkGmailThread({
  submission,
}: {
  submission: Pick<SubmissionDetail, "id" | "revision">;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [mailboxConnectionId, setMailboxConnectionId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [searchValidationError, setSearchValidationError] = useState<
    string | null
  >(null);
  const triggerButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const fallbackFocus = useRef<HTMLDivElement>(null);
  const restoreTriggerFocus = useRef(false);
  const connections = useApiQuery<{ items: MailboxConnection[] }>(
    queryKeys.mailConnections,
    "/v1/mail/connections",
    { enabled: open },
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
  const selectedMailboxConnectionId =
    mailboxConnectionId || trackedConnections[0]?.id || "";
  const search = useApiMutation<
    GmailThreadSearchResults,
    { mailboxConnectionId: string; query: string }
  >(
    (variables) => ({
      path: `/v1/submissions/${submission.id}/gmail-thread/search`,
      body: variables,
    }),
    () => [],
  );
  const preview = useApiMutation<GmailThreadPreview, string>(
    (providerThreadId) => ({
      path: `/v1/submissions/${submission.id}/gmail-thread/preview`,
      body: {
        mailboxConnectionId: selectedMailboxConnectionId,
        threadReference: providerThreadId,
      },
    }),
    () => [],
  );
  const linkThread = useApiMutation<SubmissionDetail>(
    () => ({
      path: `/v1/submissions/${submission.id}/gmail-thread/link`,
      body: {
        mailboxConnectionId: selectedMailboxConnectionId,
        threadReference: selectedThreadId,
        expectedRevision: submission.revision,
      },
    }),
    () => [
      queryKeys.submission(submission.id),
      queryKeys.correspondence(submission.id),
      queryKeys.vendorResponseSla(submission.id),
      queryKeys.dashboard,
    ],
  );

  useEffect(() => {
    if (!open) {
      if (restoreTriggerFocus.current) {
        triggerButton.current?.focus();
        restoreTriggerFocus.current = false;
      }
      return;
    }
    if (!connections.isLoading) {
      if (trackedConnections.length > 0) searchInput.current?.focus();
      else fallbackFocus.current?.focus();
    }
  }, [connections.isLoading, open, trackedConnections.length]);

  const resetPreview = (): void => {
    preview.reset();
    linkThread.reset();
    setSelectedThreadId("");
  };

  const close = (): void => {
    restoreTriggerFocus.current = true;
    setOpen(false);
    setSearchQuery("");
    setSearchValidationError(null);
    search.reset();
    resetPreview();
  };

  const submitSearch = (): void => {
    const query = searchQuery.trim();
    resetPreview();
    if (/^https?:\/\/mail\.google\.com\//i.test(query)) {
      search.reset();
      setSearchValidationError(
        "Gmail browser links cannot identify an API thread. Search by recipient or words from the subject instead.",
      );
      return;
    }
    setSearchValidationError(null);
    search.mutate({
      mailboxConnectionId: selectedMailboxConnectionId,
      query,
    });
  };
  const visibleSearchResults =
    search.data !== undefined &&
    search.variables?.query === searchQuery.trim() &&
    search.variables.mailboxConnectionId === selectedMailboxConnectionId
      ? search.data
      : undefined;

  if (!open) {
    return (
      <div className="mt-3 border-t border-border pt-3">
        <Button
          ref={triggerButton}
          variant="secondary"
          size="sm"
          onClick={() => setOpen(true)}
        >
          <Link2 aria-hidden className="size-3.5" />
          Link existing Gmail thread
        </Button>
        <p className="mt-1.5 text-pretty text-[11px] leading-4 text-text-muted">
          Import one disclosure thread you already started, then track and
          answer future replies here.
        </p>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="link-gmail-thread-title"
      className="mt-3 border-t border-border pt-3"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 id="link-gmail-thread-title" className="text-[13px] font-medium">
            Link existing Gmail thread
          </h3>
          <p className="mt-0.5 text-pretty text-[11px] leading-4 text-text-muted">
            Search reads matching sent-message headers. CodeVault stores only
            the thread you confirm, and Gmail keeps the messages unchanged.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Cancel linking Gmail thread"
          onClick={close}
        >
          <X aria-hidden className="size-3.5" />
          Cancel
        </Button>
      </div>

      {connections.isLoading ? (
        <p role="status" className="mt-4 text-[11px] text-text-muted">
          Checking Gmail connections…
        </p>
      ) : connections.error !== null ? (
        <div ref={fallbackFocus} tabIndex={-1} className="focus:outline-none">
          <FieldError className="mt-4">
            Gmail connections could not be loaded. Try opening this section
            again.
          </FieldError>
        </div>
      ) : trackedConnections.length === 0 ? (
        <div
          ref={fallbackFocus}
          tabIndex={-1}
          className="mt-4 rounded-(--cv-radius) bg-surface-raised p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <div className="flex gap-2">
            <Mail aria-hidden className="mt-0.5 size-4 text-text-muted" />
            <div>
              <p className="text-[12px] font-medium">
                Reply tracking is required
              </p>
              <p className="mt-0.5 text-pretty text-[11px] leading-4 text-text-muted">
                Connect Gmail with reply tracking before linking an existing
                thread.
              </p>
              <Button asChild variant="secondary" size="sm" className="mt-2">
                <Link to="/settings/mail">Open mail settings</Link>
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div>
            <Label>Gmail mailbox</Label>
            <Select
              aria-label="Gmail mailbox"
              value={selectedMailboxConnectionId}
              onValueChange={(value) => {
                setMailboxConnectionId(value);
                search.reset();
                setSearchValidationError(null);
                resetPreview();
              }}
              options={trackedConnections.map((connection) => ({
                value: connection.id,
                label: connection.emailAddress,
              }))}
            />
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitSearch();
            }}
          >
            <Label htmlFor="gmail-thread-search">Search sent Gmail</Label>
            <div className="mt-1 flex items-center gap-2">
              <Input
                ref={searchInput}
                id="gmail-thread-search"
                value={searchQuery}
                placeholder="Recipient or words from the subject"
                maxLength={300}
                autoComplete="off"
                spellCheck={false}
                aria-describedby="gmail-thread-search-help"
                aria-invalid={searchValidationError !== null}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setSearchValidationError(null);
                  search.reset();
                  resetPreview();
                }}
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                loading={search.isPending}
                disabled={searchQuery.trim() === ""}
              >
                <Search aria-hidden className="size-3.5" />
                Search Gmail
              </Button>
            </div>
            <FieldDescription id="gmail-thread-search-help">
              Search messages you sent by vendor address or words from the
              subject. Gmail browser URLs use a different identifier and cannot
              be linked directly.
            </FieldDescription>
          </form>
          {searchValidationError === null ? null : (
            <FieldError>{searchValidationError}</FieldError>
          )}
          {search.error === null ? null : (
            <FieldError>
              {search.error.message} Try a recipient address or fewer words from
              the subject.
            </FieldError>
          )}

          {visibleSearchResults === undefined ? null : visibleSearchResults
              .items.length === 0 ? (
            <p role="status" className="text-[11px] text-text-muted">
              No sent Gmail threads matched. Try the vendor email address or a
              different part of the subject.
            </p>
          ) : (
            <div>
              <p className="text-[11px] font-medium text-text-muted">
                Sent threads
              </p>
              <ul className="mt-1 divide-y divide-border border-y border-border">
                {visibleSearchResults.items.map((candidate) => (
                  <li key={candidate.providerThreadId}>
                    <button
                      type="button"
                      aria-label={`Preview Gmail thread: ${candidate.subject}`}
                      aria-pressed={
                        selectedThreadId === candidate.providerThreadId
                      }
                      className={`w-full px-1 py-2.5 text-left transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus ${
                        selectedThreadId === candidate.providerThreadId
                          ? "bg-surface-raised"
                          : ""
                      }`}
                      onClick={() => {
                        setSelectedThreadId(candidate.providerThreadId);
                        linkThread.reset();
                        preview.mutate(candidate.providerThreadId);
                      }}
                    >
                      <span className="block truncate text-[12px] font-medium">
                        {candidate.subject || "(no subject)"}
                      </span>
                      <span className="mt-0.5 block truncate text-[10.5px] text-text-muted">
                        To: {candidate.to.join(", ") || "Recipient unavailable"}
                        {candidate.occurredAt === null
                          ? ""
                          : ` · ${formatDateTime(candidate.occurredAt)}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.error === null ? null : (
            <FieldError>
              {preview.error.message} Search again and choose another thread.
            </FieldError>
          )}

          {preview.isPending ? (
            <p role="status" className="text-[11px] text-text-muted">
              Loading Gmail thread preview…
            </p>
          ) : null}

          {preview.data === undefined ? null : (
            <div className="border-t border-border pt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="text-[12px] font-medium">
                    {preview.data.subject || "(no subject)"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-text-muted">
                    {preview.data.messages.length} message
                    {preview.data.messages.length === 1 ? "" : "s"} from{" "}
                    {preview.data.mailboxAddress}
                  </p>
                </div>
                <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
                  Preview only
                </span>
              </div>

              {preview.data.warnings.length === 0 ? null : (
                <div className="mt-3 rounded-(--cv-radius) bg-warning/10 p-3 text-warning">
                  {preview.data.warnings.map((warning) => (
                    <p
                      key={warning}
                      className="flex gap-2 text-[11px] leading-4"
                    >
                      <AlertTriangle
                        aria-hidden
                        className="mt-0.5 size-3.5 shrink-0"
                      />
                      <span>{warning}</span>
                    </p>
                  ))}
                </div>
              )}

              <ol className="mt-3 max-h-72 divide-y divide-border overflow-auto border-y border-border">
                {preview.data.messages.map((message) => (
                  <li key={message.providerMessageId} className="py-2.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[11px] font-medium">
                        {message.direction === "OUTBOUND" ? "Sent" : "Received"}
                      </span>
                      <span className="text-[10.5px] text-text-muted tabular-nums">
                        {message.occurredAt === null
                          ? "Date unavailable"
                          : formatDateTime(message.occurredAt)}
                      </span>
                    </div>
                    <p className="mt-1 break-words text-[11px]">
                      <span className="text-text-muted">From:</span>{" "}
                      {message.from}
                    </p>
                    <p className="break-words text-[11px]">
                      <span className="text-text-muted">To:</span>{" "}
                      {message.to.join(", ") || "Not available"}
                    </p>
                  </li>
                ))}
              </ol>

              <p className="mt-3 text-pretty text-[11px] leading-4 text-text-muted">
                Linking imports these messages and attachments into this
                submission, marks it sent, and starts reply tracking. The
                imported record is audited.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  loading={linkThread.isPending}
                  onClick={() => linkThread.mutate()}
                >
                  <Link2 aria-hidden className="size-3.5" />
                  Link Gmail thread
                </Button>
                <Button variant="ghost" size="sm" onClick={close}>
                  Cancel
                </Button>
              </div>
              {linkThread.error === null ? null : (
                <FieldError>
                  {linkThread.error.message} The thread was not linked. Review
                  the latest submission and try again.
                </FieldError>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
