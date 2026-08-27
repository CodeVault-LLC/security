import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  GmailThreadPreview,
  MailboxConnection,
} from "@codevault/contracts";

import { queryKeys } from "../../lib/api.js";
import { LinkGmailThread } from "./link-gmail-thread.js";

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock("../../lib/bridge.js", () => ({
  bridge: () => ({ api: { request: apiRequest } }),
}));

const submissionId = "018f2f56-7c9a-7abc-8def-0123456789ab";
const mailboxConnectionId = "018f2f56-7c9a-7abc-8def-0123456789ac";
const providerThreadId = "18d5f79a9c0d1234";

const connection: MailboxConnection = {
  id: mailboxConnectionId,
  provider: "gmail",
  emailAddress: "researcher@example.test",
  status: "ACTIVE",
  capabilities: ["SEND", "TRACK_REPLIES"],
  lastSuccessfulSyncAt: null,
  watchExpiresAt: null,
  errorCategory: null,
  createdAt: "2026-08-26T08:00:00.000Z",
  updatedAt: "2026-08-26T08:00:00.000Z",
  revision: 1,
};

const preview: GmailThreadPreview = {
  providerThreadId: "18d5f79a9c0d1234",
  mailboxConnectionId,
  mailboxAddress: connection.emailAddress,
  subject: "Security issue in account recovery",
  messages: [
    {
      providerMessageId: "message-1",
      direction: "OUTBOUND",
      from: connection.emailAddress,
      to: ["security@vendor.example"],
      subject: "Security issue in account recovery",
      occurredAt: "2026-08-25T09:30:00.000Z",
    },
    {
      providerMessageId: "message-2",
      direction: "INBOUND",
      from: "security@vendor.example",
      to: [connection.emailAddress],
      subject: "Re: Security issue in account recovery",
      occurredAt: "2026-08-25T11:00:00.000Z",
    },
  ],
  warnings: ["This thread includes a recipient outside the vendor route."],
};

describe("LinkGmailThread", () => {
  beforeEach(() => {
    apiRequest.mockReset();
  });

  it("searches sent Gmail, previews a result, then links it", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path.endsWith("/gmail-thread/search")) {
        return Promise.resolve({
          ok: true,
          data: {
            items: [
              {
                providerThreadId,
                subject: preview.subject,
                to: ["security@vendor.example"],
                occurredAt: "2026-08-25T09:30:00.000Z",
              },
            ],
          },
        });
      }
      return Promise.resolve({
        ok: true,
        data: path.endsWith("/preview") ? preview : { id: submissionId },
      });
    });
    const client = new QueryClient({
      defaultOptions: {
        queries: { staleTime: Number.POSITIVE_INFINITY },
        mutations: { retry: false },
      },
    });
    client.setQueryData(queryKeys.mailConnections, { items: [connection] });
    render(
      <QueryClientProvider client={client}>
        <LinkGmailThread submission={{ id: submissionId, revision: 4 }} />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "Link existing Gmail thread" }),
    );
    await user.type(screen.getByLabelText("Search sent Gmail"), "vendor");
    await user.click(screen.getByRole("button", { name: "Search Gmail" }));
    await user.click(
      await screen.findByRole("button", {
        name: `Preview Gmail thread: ${preview.subject}`,
      }),
    );

    expect(await screen.findByText("Preview only")).toBeTruthy();
    expect(screen.getAllByText(preview.subject)).toHaveLength(2);
    expect(screen.getByText(preview.warnings[0]!)).toBeTruthy();
    expect(screen.getByText("Sent")).toBeTruthy();
    expect(screen.getByText("Received")).toBeTruthy();
    expect(apiRequest).toHaveBeenCalledWith(
      `/v1/submissions/${submissionId}/gmail-thread/search`,
      {
        method: "POST",
        body: { mailboxConnectionId, query: "vendor" },
      },
    );
    expect(apiRequest).toHaveBeenCalledWith(
      `/v1/submissions/${submissionId}/gmail-thread/preview`,
      {
        method: "POST",
        body: { mailboxConnectionId, threadReference: providerThreadId },
      },
    );

    await user.click(screen.getByRole("button", { name: "Link Gmail thread" }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        `/v1/submissions/${submissionId}/gmail-thread/link`,
        {
          method: "POST",
          body: {
            mailboxConnectionId,
            threadReference: providerThreadId,
            expectedRevision: 4,
          },
        },
      ),
    );
  });

  it("explains how to recover when a Gmail browser URL is pasted", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { staleTime: Number.POSITIVE_INFINITY },
        mutations: { retry: false },
      },
    });
    client.setQueryData(queryKeys.mailConnections, { items: [connection] });
    render(
      <QueryClientProvider client={client}>
        <LinkGmailThread submission={{ id: submissionId, revision: 4 }} />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "Link existing Gmail thread" }),
    );
    await user.type(
      screen.getByLabelText("Search sent Gmail"),
      "https://mail.google.com/mail/u/0/#inbox/QgrcJHsbhNcPkDbcJLpgPMrGRnndXKxTMVb",
    );
    await user.click(screen.getByRole("button", { name: "Search Gmail" }));

    expect(
      await screen.findByText(
        "Gmail browser links cannot identify an API thread. Search by recipient or words from the subject instead.",
      ),
    ).toBeTruthy();
    expect(apiRequest).not.toHaveBeenCalledWith(
      expect.stringContaining("/gmail-thread/search"),
      expect.anything(),
    );
  });

  it("focuses the loaded input and restores focus when cancelled", async () => {
    apiRequest.mockResolvedValue({ ok: true, data: { items: [connection] } });
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={client}>
        <LinkGmailThread submission={{ id: submissionId, revision: 4 }} />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", {
      name: "Link existing Gmail thread",
    });

    await user.click(trigger);

    const input = await screen.findByLabelText("Search sent Gmail");
    await waitFor(() => expect(document.activeElement).toBe(input));

    await user.click(
      screen.getByRole("button", { name: "Cancel linking Gmail thread" }),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Link existing Gmail thread" }),
      ),
    );
  });

  it("moves focus to the connection error when loading fails", async () => {
    apiRequest.mockResolvedValue({
      ok: false,
      category: "PROVIDER_UNAVAILABLE",
      message: "Gmail is unavailable.",
      requestId: "request-1",
      details: null,
    });
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={client}>
        <LinkGmailThread submission={{ id: submissionId, revision: 4 }} />
      </QueryClientProvider>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Link existing Gmail thread" }),
    );

    const error = await screen.findByText(
      "Gmail connections could not be loaded. Try opening this section again.",
    );
    const focusTarget = error.closest('[tabindex="-1"]');
    await waitFor(() => expect(document.activeElement).toBe(focusTarget));
  });
});
