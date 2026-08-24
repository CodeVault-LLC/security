import { afterEach, describe, expect, it, vi } from "vitest";

import { SafeRegistryHttpClient } from "./http-client.js";

describe("SafeRegistryHttpClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects hosts outside the registry allowlist before fetching", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(
      new SafeRegistryHttpClient().getJson(new URL("https://example.com/data")),
    ).rejects.toThrow("not allowed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts bounded JSON responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('{"ok":true}', {
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    await expect(
      new SafeRegistryHttpClient().getJson(
        new URL("https://registry.npmjs.org/-/v1/search"),
      ),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects oversized and non-JSON responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", {
            headers: {
              "content-type": "text/html",
              "content-length": String(2 * 1024 * 1024),
            },
          }),
      ),
    );

    await expect(
      new SafeRegistryHttpClient().getJson(
        new URL("https://registry.npmjs.org/-/v1/search"),
      ),
    ).rejects.toThrow("non-JSON");
  });
});
