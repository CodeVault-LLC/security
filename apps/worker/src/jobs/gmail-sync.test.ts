import { describe, expect, test, vi } from "vitest";

import {
  syncMailboxHistory,
  syncTrackedThread,
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

  test("imports every message from one explicitly linked thread", async () => {
    const persistTracked = vi.fn(async () => undefined);
    const getMessageRaw = vi.fn(async (_token: string, id: string) =>
      new TextEncoder().encode(id),
    );
    await syncTrackedThread({
      accessToken: "access",
      threadId: "linked-thread",
      getThreadMessageIds: vi.fn(async () => ["sent", "reply"]),
      getMessageMetadata: vi.fn(async (_token, id) => ({
        id,
        threadId: "linked-thread",
        labelIds: id === "sent" ? ["SENT"] : ["INBOX"],
        headers: [],
      })),
      getMessageRaw,
      persistTracked,
    });
    expect(getMessageRaw).toHaveBeenCalledTimes(2);
    expect(persistTracked).toHaveBeenCalledTimes(2);
  });

  test("rejects inconsistent provider metadata before fetching raw content", async () => {
    const getMessageRaw = vi.fn(async () => new Uint8Array());
    await expect(
      syncTrackedThread({
        accessToken: "access",
        threadId: "linked-thread",
        getThreadMessageIds: vi.fn(async () => ["wrong"]),
        getMessageMetadata: vi.fn(async () => ({
          id: "wrong",
          threadId: "different-thread",
          labelIds: [],
          headers: [],
        })),
        getMessageRaw,
        persistTracked: vi.fn(async () => undefined),
      }),
    ).rejects.toThrow("inconsistent thread metadata");
    expect(getMessageRaw).not.toHaveBeenCalled();
  });
});
