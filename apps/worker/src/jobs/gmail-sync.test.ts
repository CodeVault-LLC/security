import { describe, expect, test, vi } from "vitest";

import {
  syncMailboxHistory,
  type GmailSyncDependencies,
} from "./gmail-sync.js";

function dependencies(
  trackedThreadId = "tracked-thread",
): GmailSyncDependencies {
  return {
    startHistoryId: "100",
    getHistory: vi.fn(async () => ({
      historyId: "101",
      messageIds: ["unrelated", "reply"],
      nextPageToken: null,
    })),
    getMessageMetadata: vi.fn(async (_token, id) => ({
      id,
      threadId: id === "reply" ? trackedThreadId : "other-thread",
      labelIds: ["INBOX"],
      headers: [],
    })),
    isTrackedThread: vi.fn(async (threadId) => threadId === trackedThreadId),
    getMessageRaw: vi.fn(async () => new TextEncoder().encode("raw reply")),
    persistTracked: vi.fn(async () => undefined),
    advanceCursor: vi.fn(async () => undefined),
    accessToken: "access",
  };
}

describe("tracked Gmail synchronization", () => {
  test("does not fetch an unrelated Gmail message body", async () => {
    const deps = dependencies();
    await syncMailboxHistory(deps);
    expect(deps.getMessageRaw).not.toHaveBeenCalledWith("access", "unrelated");
    expect(deps.persistTracked).toHaveBeenCalledTimes(1);
  });

  test("fetches a message only after its thread ID matches", async () => {
    const deps = dependencies();
    await syncMailboxHistory(deps);
    expect(deps.getMessageRaw).toHaveBeenCalledWith("access", "reply");
    expect(deps.persistTracked).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ threadId: "tracked-thread" }),
      }),
    );
    expect(deps.advanceCursor).toHaveBeenCalledWith("101");
  });

  test("does not advance the cursor when durable ingestion fails", async () => {
    const deps = dependencies();
    vi.mocked(deps.persistTracked).mockRejectedValueOnce(
      new Error("storage failed"),
    );
    await expect(syncMailboxHistory(deps)).rejects.toThrow("storage failed");
    expect(deps.advanceCursor).not.toHaveBeenCalled();
  });
});
