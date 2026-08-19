import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionStore, type StoredSession } from "./session-store.js";

vi.mock("electron", () => ({
  app: { getPath: () => "/unused" },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
    getSelectedStorageBackend: () => "keychain",
  },
}));

const session: StoredSession = {
  token: "session-token",
  serverUrl: "https://codevault.internal",
  expiresAt: "2030-01-01T00:00:00.000Z",
  userId: "018f03d2-b7fd-7aef-8ac4-24b921aa6723",
};

describe("session store persistence choice", () => {
  let directory: string;
  let filePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "codevault-session-test-"));
    filePath = join(directory, "session.enc");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps an ordinary login in memory without writing it to disk", async () => {
    const store = createSessionStore({ filePath });

    await store.save(session, false);

    expect(store.current()).toEqual(session);
    await expect(access(filePath)).rejects.toThrow();
  });

  it("restores a remembered login from encrypted storage", async () => {
    const store = createSessionStore({ filePath });
    await store.save(session, true);

    const restartedStore = createSessionStore({ filePath });

    await expect(restartedStore.restore()).resolves.toEqual(session);
  });
});
