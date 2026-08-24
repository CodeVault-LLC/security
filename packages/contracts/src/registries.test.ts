import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  AssetRegistrySearchQuery,
  AssetRegistrySearchResponse,
} from "./registries.js";

describe("asset registry contracts", () => {
  it("bounds search input", () => {
    expect(Value.Check(AssetRegistrySearchQuery, { query: "x" })).toBe(false);
    expect(
      Value.Check(AssetRegistrySearchQuery, {
        query: "security",
        source: "WORDPRESS_PLUGIN",
        limit: 50,
      }),
    ).toBe(true);
    expect(
      Value.Check(AssetRegistrySearchQuery, { query: "security", limit: 51 }),
    ).toBe(false);
  });

  it("requires HTTPS provenance and rejects extra fields", () => {
    const response = {
      items: [
        {
          source: "NPM",
          sourceLabel: "npm",
          externalId: "secure-package",
          name: "secure-package",
          description: null,
          latestVersion: "1.0.0",
          purl: "pkg:npm/secure-package",
          vendorName: null,
          homepageUrl: null,
          sourceUrl: "http://registry.example/package",
          lastUpdatedAt: null,
          metadata: {},
        },
      ],
      failures: [],
      searchedSources: ["NPM"],
    };

    expect(Value.Check(AssetRegistrySearchResponse, response)).toBe(false);
    response.items[0]!.sourceUrl = "https://registry.example/package";
    expect(Value.Check(AssetRegistrySearchResponse, response)).toBe(true);
    expect(
      Value.Check(AssetRegistrySearchResponse, { ...response, extra: true }),
    ).toBe(false);
  });
});
