import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as TanStackRouter from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MailboxConnection } from "@codevault/contracts";

import { MailRoute } from "./mail.js";

const apiRequest = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original = await importOriginal<typeof TanStackRouter>();
  return {
    ...original,
    Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
    useNavigate: () => navigate,
  };
});

vi.mock("../lib/bridge.js", () => ({
  bridge: () => ({ api: { request: apiRequest } }),
}));

const connectionId = "018f2f56-7c9a-7abc-8def-0123456789ac";
const submissionId = "018f2f56-7c9a-7abc-8def-0123456789ab";
const threadId = "18d5f79a9c0d1234";
const connection: MailboxConnection = {
  id: connectionId,
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

describe("MailRoute", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    navigate.mockReset();
    apiRequest.mockImplementation((path: string, options?: unknown) => {
      if (path === "/v1/mail/connections") {
        return Promise.resolve({ ok: true, data: { items: [connection] } });
      }
      if (path === "/v1/mail/tracking-targets") {
        return Promise.resolve({
          ok: true,
          data: {
            items: [
              {
                submissionId,
                submissionRef: "SUB-000001",
                revision: 4,
                subject: "Account recovery issue",
                caseRef: "CASE-000001",
                caseTitle: "Account recovery",
                vendorName: "Example Vendor",
              },
            ],
          },
        });
      }
      if (path.includes("/tracking-preview?")) {
        return Promise.resolve({
          ok: true,
          data: {
            mailboxConnectionId: connectionId,
            mailboxAddress: connection.emailAddress,
            providerThreadId: threadId,
            subject: "Security issue in account recovery",
            messages: [],
            warnings: [],
          },
        });
      }
      if (path.includes(`/threads/${threadId}`)) {
        return Promise.resolve({
          ok: true,
          data: {
            mailboxConnectionId: connectionId,
            mailboxAddress: connection.emailAddress,
            providerThreadId: threadId,
            subject: "Security issue in account recovery",
            tooLarge: false,
            tracking: null,
            messages: [
              {
                providerMessageId: "message-1",
                direction: "OUTBOUND",
                from: connection.emailAddress,
                to: ["security@vendor.example"],
                cc: [],
                subject: "Security issue in account recovery",
                bodyText: "I found an account recovery issue.",
                encrypted: false,
                previewUnavailable: false,
                occurredAt: "2026-08-25T09:30:00.000Z",
                attachments: [],
              },
            ],
          },
        });
      }
      if (path.includes("/threads?")) {
        return Promise.resolve({
          ok: true,
          data: {
            items: [
              {
                providerMessageId: "message-1",
                providerThreadId: threadId,
                subject: "Security issue in account recovery",
                participants: ["security@vendor.example"],
                occurredAt: "2026-08-25T09:30:00.000Z",
                unread: false,
                tracking: null,
              },
            ],
            nextPageToken: null,
          },
        });
      }
      if (path.endsWith("/gmail-thread/link")) {
        return Promise.resolve({ ok: true, data: { id: submissionId } });
      }
      throw new Error(`Unexpected API request: ${path} ${String(options)}`);
    });
  });

  it("opens a Gmail conversation and tracks it to the preselected disclosure", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={client}>
        <MailRoute
          search={{
            folder: "SENT",
            connectionId,
            threadId,
            submissionId,
          }}
        />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Security issue in account recovery",
      }),
    ).toBeTruthy();
    expect(screen.getByText("I found an account recovery issue.")).toBeTruthy();
    const trackButton = await screen.findByRole("button", {
      name: "Track thread",
    });
    await waitFor(() =>
      expect((trackButton as HTMLButtonElement).disabled).toBe(false),
    );
    await userEvent.click(trackButton);

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        `/v1/submissions/${submissionId}/gmail-thread/link`,
        {
          method: "POST",
          body: {
            mailboxConnectionId: connectionId,
            threadReference: threadId,
            expectedRevision: 4,
          },
        },
      ),
    );
  });
});
