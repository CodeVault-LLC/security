import { describe, expect, it, vi } from "vitest";

import type { SessionStore } from "./session-store.js";
import { createApiClient } from "./api-client.js";

function storedSession(): SessionStore {
  return {
    current: () => ({
      token: "session-token",
      serverUrl: "https://codevault.internal",
      expiresAt: "2030-01-01T00:00:00.000Z",
      userId: "018f03d2-b7fd-7aef-8ac4-24b921aa6723",
    }),
    save: vi.fn(),
    restore: vi.fn(),
    clear: vi.fn(),
    status: () => ({
      available: true,
      persistent: true,
      backend: "keychain",
    }),
  };
}

describe("API client session invalidation", () => {
  it("clears a rejected authenticated session before returning the error", async () => {
    const sessionStore = storedSession();
    const onSessionExpired = vi.fn();
    const client = createApiClient({
      sessionStore,
      onSessionExpired,
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              category: "SESSION_EXPIRED",
              message: "Your session has expired. Sign in again.",
              requestId: "request-1",
            },
          }),
          { status: 401 },
        ),
      ),
    });

    await expect(client.request("/v1/dashboard")).rejects.toMatchObject({
      status: 401,
      category: "SESSION_EXPIRED",
    });
    expect(sessionStore.clear).toHaveBeenCalledOnce();
    expect(onSessionExpired).toHaveBeenCalledOnce();
  });
});

describe("API client origin boundary", () => {
  it("rejects an absolute request URL before attaching credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const client = createApiClient({
      sessionStore: storedSession(),
      fetchImpl,
    });

    await expect(
      client.request("https://attacker.example/v1/dashboard"),
    ).rejects.toMatchObject({
      status: 0,
      category: "VALIDATION",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("API client cancellation", () => {
  it("removes the caller abort listener after a completed request", async () => {
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, "removeEventListener");
    const client = createApiClient({
      sessionStore: storedSession(),
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      ),
    });

    await client.request("/v1/dashboard", { signal: caller.signal });

    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
