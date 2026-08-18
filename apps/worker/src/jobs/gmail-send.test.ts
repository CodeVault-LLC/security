import { describe, expect, test, vi } from "vitest";

import {
  assertSenderHeader,
  sendDelivery,
  type GmailSendDependencies,
} from "./gmail-send.js";

function dependencies(): GmailSendDependencies {
  return {
    claim: vi.fn(async () => ({
      deliveryId: "delivery-1",
      attemptNumber: 1,
      accessToken: "access",
      rawMessage: new TextEncoder().encode(
        "Message-ID: <stable@codevault.test>\r\n\r\nBody",
      ),
      rfcMessageId: "<stable@codevault.test>",
      providerThreadId: null,
    })),
    findByRfcMessageId: vi.fn(async () => null),
    send: vi.fn(async () => ({
      providerMessageId: "gmail-message",
      providerThreadId: "gmail-thread",
    })),
    recordSent: vi.fn(async () => undefined),
    recordFailed: vi.fn(async () => undefined),
    recordUnknown: vi.fn(async () => undefined),
  };
}

describe("Gmail delivery", () => {
  test("rejects sender substitution and duplicate From headers", () => {
    expect(() =>
      assertSenderHeader(
        new TextEncoder().encode("From: attacker@example.test\r\n\r\nBody"),
        "researcher@example.test",
      ),
    ).toThrow("does not match");
    expect(() =>
      assertSenderHeader(
        new TextEncoder().encode(
          "From: researcher@example.test\r\nFrom: attacker@example.test\r\n\r\nBody",
        ),
        "researcher@example.test",
      ),
    ).toThrow("exactly one");
  });

  test("reconciles a timed-out send by stable RFC Message-ID before retrying", async () => {
    const deps = dependencies();
    vi.mocked(deps.send).mockRejectedValueOnce(
      new DOMException("timed out", "TimeoutError"),
    );
    vi.mocked(deps.findByRfcMessageId)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        providerMessageId: "gmail-message",
        providerThreadId: "gmail-thread",
      });
    await sendDelivery(deps, "delivery-1");
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.findByRfcMessageId).toHaveBeenCalledWith(
      "access",
      "<stable@codevault.test>",
    );
    expect(deps.recordSent).toHaveBeenCalledWith(
      expect.objectContaining({
        providerThreadId: "gmail-thread",
        reconciled: true,
      }),
    );
    expect(deps.recordUnknown).not.toHaveBeenCalled();
  });

  test("does not send when a previous ambiguous attempt is found during preflight", async () => {
    const deps = dependencies();
    vi.mocked(deps.findByRfcMessageId).mockResolvedValueOnce({
      providerMessageId: "already-sent",
      providerThreadId: "existing-thread",
    });
    await sendDelivery(deps, "delivery-1");
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.recordSent).toHaveBeenCalledWith(
      expect.objectContaining({ reconciled: true }),
    );
  });

  test("marks an unresolved timeout unknown and never retries automatically", async () => {
    const deps = dependencies();
    vi.mocked(deps.send).mockRejectedValueOnce(
      new DOMException("timed out", "TimeoutError"),
    );
    await sendDelivery(deps, "delivery-1");
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.recordUnknown).toHaveBeenCalledOnce();
    expect(deps.recordFailed).not.toHaveBeenCalled();
  });

  test("refuses a retry when Gmail reconciliation permission is unavailable", async () => {
    const deps = dependencies();
    vi.mocked(deps.claim).mockResolvedValueOnce({
      ...(await deps.claim("delivery-1"))!,
      attemptNumber: 2,
    });
    vi.mocked(deps.findByRfcMessageId).mockRejectedValueOnce(
      new Error("insufficient scope"),
    );
    await sendDelivery(deps, "delivery-1");
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.recordUnknown).toHaveBeenCalledWith(
      expect.objectContaining({ category: "GMAIL_RECONCILIATION_UNAVAILABLE" }),
    );
  });
});
