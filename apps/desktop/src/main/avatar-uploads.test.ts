import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionStore } from "./session-store.js";
import { loadAvatarDataUrl } from "./avatar-uploads.js";

const webp = Buffer.from("RIFF\u0004\u0000\u0000\u0000WEBP");

function sessionStore(): SessionStore {
  return {
    current: () => ({
      token: "session-token",
      serverUrl: "https://vault.example",
      expiresAt: "2030-01-01T00:00:00.000Z",
      userId: "018f03d2-b7fd-7aef-8ac4-24b921aa6723",
    }),
    save: vi.fn(),
    restore: vi.fn(),
    clear: vi.fn(),
    status: () => ({ available: true, persistent: true, backend: "test" }),
  };
}

describe("loadAvatarDataUrl", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads a current avatar through the stable user-id route", async () => {
    const fetchAvatar = vi.fn().mockResolvedValue(
      new Response(webp, {
        status: 200,
        headers: { "content-type": "image/webp" },
      }),
    );
    vi.stubGlobal("fetch", fetchAvatar);

    const store = sessionStore();
    await expect(
      Promise.all([
        loadAvatarDataUrl(
          store,
          "018f03d2-b7fd-7aef-8ac4-24b921aa6723",
          "USER",
        ),
        loadAvatarDataUrl(
          store,
          "018f03d2-b7fd-7aef-8ac4-24b921aa6723",
          "USER",
        ),
      ]),
    ).resolves.toEqual([
      `data:image/webp;base64,${webp.toString("base64")}`,
      `data:image/webp;base64,${webp.toString("base64")}`,
    ]);

    expect(String(fetchAvatar.mock.calls[0]?.[0])).toBe(
      "https://vault.example/v1/user-avatars/018f03d2-b7fd-7aef-8ac4-24b921aa6723/content",
    );
    expect(fetchAvatar).toHaveBeenCalledTimes(1);
  });
});
