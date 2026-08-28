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

describe("case access events", () => {
  it("refreshes the review matrix and history after a grant change", () => {
    const queryClient = new QueryClient();
    const caseId = "018f2f56-7c9a-7abc-8def-0123456789ab";
    queryClient.setQueryData(["case-access-review"], { items: [] });
    queryClient.setQueryData(["case-access-history", caseId], { items: [] });

    invalidateForEvent(queryClient, {
      id: "event-1",
      type: "case.access_changed",
      entityType: "case_access",
      entityId: caseId,
      caseId,
      detail: { canRead: true },
      occurredAt: "2026-08-28T10:01:00.000Z",
    });

    expect(
      queryClient.getQueryState(["case-access-review"])?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(["case-access-history", caseId])?.isInvalidated,
    ).toBe(true);
  });

  it("removes case-scoped cached data immediately after revocation", () => {
    const queryClient = new QueryClient();
    const caseId = "018f2f56-7c9a-7abc-8def-0123456789ab";
    queryClient.setQueryData(queryKeys.case(caseId), { title: "Embargoed" });
    queryClient.setQueryData(queryKeys.reports(caseId), {
      items: [{ title: "Private report" }],
    });

    invalidateForEvent(queryClient, {
      id: "event-2",
      type: "case.access_changed",
      entityType: "case_access",
      entityId: caseId,
      caseId,
      detail: { canRead: false },
      occurredAt: "2026-08-28T10:01:00.000Z",
    });

    expect(queryClient.getQueryData(queryKeys.case(caseId))).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.reports(caseId))).toBeUndefined();
  });
});
