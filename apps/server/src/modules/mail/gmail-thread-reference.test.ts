import { describe, expect, test } from "vitest";

import {
  gmailThreadWarnings,
  parseGmailThreadReference,
  previewGmailMessage,
} from "./gmail-thread-reference.js";

describe("Gmail thread references", () => {
  test("accepts a raw API thread ID", () => {
    expect(parseGmailThreadReference("18db7abc_DEF-1")).toBe("18db7abc_DEF-1");
  });

  test("rejects Gmail browser URLs because their IDs are not API thread IDs", () => {
    expect(() =>
      parseGmailThreadReference(
        "https://mail.google.com/mail/u/0/#inbox/18db7abc_DEF-1",
      ),
    ).toThrow("Search sent Gmail");
  });

  test("rejects non-Gmail URLs", () => {
    expect(() =>
      parseGmailThreadReference("https://example.test/inbox/thread"),
    ).toThrow("mail.google.com");
  });

  test("derives direction and participant warnings from metadata", () => {
    const message = previewGmailMessage(
      {
        id: "message-1",
        threadId: "thread-1",
        labelIds: ["SENT"],
        headers: [
          { name: "From", value: "Researcher <researcher@example.test>" },
          { name: "To", value: "Vendor <security@vendor.test>" },
          { name: "Subject", value: "Security report" },
          { name: "Date", value: "Wed, 26 Aug 2026 10:00:00 +0000" },
        ],
      },
      "researcher@example.test",
    );
    expect(message).toMatchObject({
      direction: "OUTBOUND",
      to: ["security@vendor.test"],
      subject: "Security report",
    });
    expect(
      gmailThreadWarnings({
        messages: [message],
        mailboxAddress: "researcher@example.test",
        routeRecipients: ["security@vendor.test"],
      }),
    ).toEqual([]);
    expect(
      gmailThreadWarnings({
        messages: [message],
        mailboxAddress: "researcher@example.test",
        routeRecipients: ["different@vendor.test"],
      }),
    ).toHaveLength(1);
    expect(
      gmailThreadWarnings({
        messages: [
          message,
          {
            ...message,
            providerMessageId: "message-2",
            from: "unexpected@example.test",
            direction: "INBOUND",
          },
        ],
        mailboxAddress: "researcher@example.test",
        routeRecipients: ["security@vendor.test"],
      }),
    ).toEqual([
      "The thread includes participants outside the saved vendor email route: unexpected@example.test. Review them before linking.",
    ]);
  });
});
