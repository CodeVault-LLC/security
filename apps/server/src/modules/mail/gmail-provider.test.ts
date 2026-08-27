import { describe, expect, test, vi } from "vitest";

import { createGmailProvider } from "./gmail-provider.js";

describe("Gmail provider", () => {
  test("lists one mailbox page with the selected label and cursor", async () => {
    const request = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response(
          JSON.stringify({
            messages: [{ id: "message-1", threadId: "thread-1" }],
            nextPageToken: "next-page",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const provider = createGmailProvider({
      clientId: "client",
      clientSecret: "secret",
      fetch: request,
      endpoints: {
        token: "https://oauth.test/token",
        revoke: "https://oauth.test/revoke",
        userInfo: "https://oauth.test/userinfo",
        gmailApi: "https://gmail.test/gmail/v1",
      },
    });

    await expect(
      provider.listMessages("access-token", {
        labelId: "INBOX",
        query: "vendor",
        pageToken: "current-page",
        maxResults: 30,
      }),
    ).resolves.toEqual({
      messages: [
        { providerMessageId: "message-1", providerThreadId: "thread-1" },
      ],
      nextPageToken: "next-page",
    });

    const url = new URL(String(request.mock.calls[0]?.[0]));
    expect(url.searchParams.get("labelIds")).toBe("INBOX");
    expect(url.searchParams.get("q")).toBe("vendor");
    expect(url.searchParams.get("pageToken")).toBe("current-page");
    expect(url.searchParams.get("maxResults")).toBe("30");
  });

  test("searches sent messages and returns API message and thread IDs", async () => {
    const request = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response(
          JSON.stringify({
            messages: [
              { id: "message-1", threadId: "thread-1" },
              { id: "message-2", threadId: "thread-2" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const provider = createGmailProvider({
      clientId: "client",
      clientSecret: "secret",
      fetch: request,
      endpoints: {
        token: "https://oauth.test/token",
        revoke: "https://oauth.test/revoke",
        userInfo: "https://oauth.test/userinfo",
        gmailApi: "https://gmail.test/gmail/v1",
      },
    });

    await expect(
      provider.searchSentMessages("access-token", "vendor subject", 20),
    ).resolves.toEqual([
      { providerMessageId: "message-1", providerThreadId: "thread-1" },
      { providerMessageId: "message-2", providerThreadId: "thread-2" },
    ]);

    const url = new URL(String(request.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/gmail/v1/users/me/messages");
    expect(url.searchParams.get("labelIds")).toBe("SENT");
    expect(url.searchParams.get("q")).toBe("vendor subject");
    expect(url.searchParams.get("maxResults")).toBe("20");
  });
});
