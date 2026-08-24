import { describe, expect, it } from "vitest";

import { createDefaultRegistryProviders } from "./providers.js";
import type { RegistryHttpClient } from "./provider.js";

class FixtureClient implements RegistryHttpClient {
  async getJson(url: URL): Promise<unknown> {
    if (url.pathname.startsWith("/plugins/")) {
      return {
        plugins: [
          {
            slug: "secure-plugin",
            name: "Secure &amp; Plugin",
            short_description: "<p>Blocks <strong>bad</strong> input.</p>",
            version: "2.1.0",
            author: '<a href="https://example.com">Acme Security</a>',
            homepage: "http://insecure.example.com",
            last_updated: "2026-08-20 12:00:00",
            active_installs: 12_000,
            rating: 94,
          },
        ],
      };
    }

    if (url.pathname.startsWith("/themes/")) {
      return {
        themes: [{ slug: "safe-theme", name: "Safe Theme", version: "1.4" }],
      };
    }

    if (url.hostname === "registry.npmjs.org") {
      return {
        objects: [
          {
            package: {
              name: "@scope/security-kit",
              version: "3.0.0",
              description: "Security helpers",
              publisher: { username: "acme" },
              date: "2026-08-20T12:00:00.000Z",
              links: { homepage: "https://example.com/npm" },
            },
            score: { final: 0.9 },
          },
        ],
      };
    }

    if (url.hostname === "crates.io") {
      return {
        crates: [{ id: "safe-crate", newest_version: "1.2.3", downloads: 42 }],
      };
    }

    if (url.hostname === "packagist.org") {
      return {
        results: [{ name: "acme/security", description: "Composer package" }],
      };
    }

    if (url.hostname === "rubygems.org") {
      return [{ name: "safe_gem", version: "4.2.0", authors: "Acme" }];
    }

    if (url.hostname.includes("nuget.org")) {
      return {
        data: [{ id: "Safe.Package", version: "5.0.0", authors: ["Acme"] }],
      };
    }

    return {
      response: {
        docs: [{ g: "com.acme", a: "security", latestVersion: "6.0.0" }],
      },
    };
  }
}

describe("default asset registry providers", () => {
  it("normalizes all eight registries into reviewable asset proposals", async () => {
    const providers = createDefaultRegistryProviders(new FixtureClient());
    const results = await Promise.all(
      providers.map(async (entry) => (await entry.search("security", 5))[0]),
    );

    expect(results.map((entry) => entry?.purl)).toEqual([
      "pkg:wordpress/secure-plugin",
      "pkg:wordpress/safe-theme",
      "pkg:npm/%40scope/security-kit",
      "pkg:cargo/safe-crate",
      "pkg:composer/acme/security",
      "pkg:gem/safe_gem",
      "pkg:nuget/Safe.Package",
      "pkg:maven/com.acme/security",
    ]);
    expect(results[0]).toMatchObject({
      name: "Secure & Plugin",
      description: "Blocks bad input.",
      vendorName: "Acme Security",
      homepageUrl: null,
      metadata: { activeInstalls: 12_000, rating: 94 },
    });
  });

  it("encodes user queries as URL parameters instead of URL fragments", async () => {
    const seen: URL[] = [];
    const client: RegistryHttpClient = {
      async getJson(url) {
        seen.push(url);
        return url.hostname === "rubygems.org" ? [] : {};
      },
    };

    await Promise.all(
      createDefaultRegistryProviders(client).map((entry) =>
        entry.search("router & security", 3),
      ),
    );

    expect(seen).toHaveLength(8);
    expect(seen.every((url) => !url.pathname.includes("router"))).toBe(true);
    expect(seen.every((url) => url.search.includes("router"))).toBe(true);
  });
});
