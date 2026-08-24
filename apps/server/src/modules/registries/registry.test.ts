import { describe, expect, it } from "vitest";

import type {
  AssetRegistryResult,
  AssetRegistrySource,
} from "@codevault/contracts";

import type { AssetRegistryProvider } from "./provider.js";
import { AssetRegistry } from "./registry.js";

function result(
  source: AssetRegistrySource,
  name: string,
  purl = `pkg:test/${name}`,
): AssetRegistryResult {
  return {
    source,
    sourceLabel: source,
    externalId: name,
    name,
    description: null,
    latestVersion: null,
    purl,
    vendorName: null,
    homepageUrl: null,
    sourceUrl: "https://registry.example/package",
    lastUpdatedAt: null,
    metadata: {},
  };
}

function provider(
  source: AssetRegistrySource,
  search: AssetRegistryProvider["search"],
): AssetRegistryProvider {
  return { source, label: source, search };
}

describe("AssetRegistry", () => {
  it("ranks exact and prefix matches ahead of provider order", async () => {
    const registry = new AssetRegistry([
      provider("NPM", async () => [result("NPM", "other-query")]),
      provider("CRATES_IO", async () => [result("CRATES_IO", "query-tools")]),
      provider("NUGET", async () => [result("NUGET", "query")]),
    ]);

    const response = await registry.search({ query: "query", limit: 10 });

    expect(response.items.map((item) => item.name)).toEqual([
      "query",
      "query-tools",
      "other-query",
    ]);
  });

  it("deduplicates PURLs, applies the limit, and keeps partial failures", async () => {
    const registry = new AssetRegistry([
      provider("NPM", async () => [
        result("NPM", "one", "pkg:npm/shared"),
        result("NPM", "two"),
      ]),
      provider("NUGET", async () => [
        result("NUGET", "duplicate", "pkg:npm/shared"),
      ]),
      provider("RUBYGEMS", async () => {
        throw new Error("Registry maintenance");
      }),
    ]);

    const response = await registry.search({ query: "package", limit: 2 });

    expect(response.items).toHaveLength(2);
    expect(
      response.items.filter((item) => item.purl === "pkg:npm/shared"),
    ).toHaveLength(1);
    expect(response.failures).toEqual([
      {
        source: "RUBYGEMS",
        sourceLabel: "RUBYGEMS",
        message: "Registry maintenance",
      },
    ]);
  });

  it("searches only the selected source with the requested limit", async () => {
    const calls: Array<{ source: AssetRegistrySource; limit: number }> = [];
    const registry = new AssetRegistry([
      provider("NPM", async (_query, limit) => {
        calls.push({ source: "NPM", limit });
        return [];
      }),
      provider("NUGET", async (_query, limit) => {
        calls.push({ source: "NUGET", limit });
        return [];
      }),
    ]);

    const response = await registry.search({
      query: "router",
      source: "NUGET",
      limit: 37,
    });

    expect(calls).toEqual([{ source: "NUGET", limit: 37 }]);
    expect(response.searchedSources).toEqual(["NUGET"]);
  });
});
