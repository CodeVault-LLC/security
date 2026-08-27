import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type { MailThreadDetail, ServerEvent } from "@codevault/contracts";

import { queryKeys } from "./api.js";
import { invalidateForEvent } from "./events.js";

describe("organization mail policy events", () => {
  it("removes cached HTML before refetching when rendering is disabled", () => {
    const queryClient = new QueryClient();
    const key = queryKeys.mailboxThread("mailbox-1", "thread-1");
    const thread: MailThreadDetail = {
      mailboxConnectionId: "018f2f56-7c9a-7abc-8def-0123456789ab",
      mailboxAddress: "researcher@example.test",
      providerThreadId: "thread-1",
      subject: "Security update",
      tooLarge: false,
      htmlRenderingAllowed: true,
      tracking: null,
      messages: [
        {
          providerMessageId: "message-1",
          direction: "INBOUND",
          from: "vendor@example.test",
          to: ["researcher@example.test"],
          cc: [],
          subject: "Security update",
          bodyText: "Fix ready",
          bodyHtml: "<p>Fix ready</p>",
          encrypted: false,
          previewUnavailable: false,
          occurredAt: "2026-08-27T10:00:00.000Z",
          attachments: [],
        },
      ],
    };
    queryClient.setQueryData(key, thread);
    const event: ServerEvent = {
      id: "event-1",
      type: "entity.changed",
      entityType: "organization_security_policy",
      entityId: "018f2f56-7c9a-7abc-8def-0123456789aa",
      caseId: null,
      detail: { mailHtmlRenderingEnabled: false },
      occurredAt: "2026-08-27T10:01:00.000Z",
    };

    invalidateForEvent(queryClient, event);

    expect(queryClient.getQueryData<MailThreadDetail>(key)).toMatchObject({
      htmlRenderingAllowed: false,
      messages: [{ bodyHtml: null }],
    });
  });
});
