import type {
  AssetRegistryFailure,
  AssetRegistrySearchResponse,
  AssetRegistrySource,
} from "@codevault/contracts";

import type { AssetRegistryProvider } from "./provider.js";

function relevance(name: string, query: string): number {
  const candidate = name.toLocaleLowerCase("en-US");
  if (candidate === query) return 0;
  if (candidate.startsWith(query)) return 1;
  if (candidate.includes(query)) return 2;
  return 3;
}

export class AssetRegistry {
  readonly #providers: Map<AssetRegistrySource, AssetRegistryProvider>;

  constructor(providers: readonly AssetRegistryProvider[]) {
    this.#providers = new Map(providers.map((entry) => [entry.source, entry]));
  }

  sources(): AssetRegistrySource[] {
    return [...this.#providers.keys()];
  }

  async search(options: {
    query: string;
    source?: AssetRegistrySource;
    limit: number;
  }): Promise<AssetRegistrySearchResponse> {
    const selected =
      options.source === undefined
        ? [...this.#providers.values()]
        : [this.#providers.get(options.source)].filter(
            (entry): entry is AssetRegistryProvider => entry !== undefined,
          );
    const perProvider =
      options.source === undefined
        ? Math.min(10, options.limit)
        : options.limit;
    const settled = await Promise.allSettled(
      selected.map((entry) => entry.search(options.query, perProvider)),
    );
    const failures: AssetRegistryFailure[] = [];
    const sourceOrder = new Map(
      selected.map((entry, index) => [entry.source, index]),
    );
    const items = settled.flatMap((result, index) => {
      const current = selected[index];
      if (current === undefined) return [];

      if (result.status === "rejected") {
        failures.push({
          source: current.source,
          sourceLabel: current.label,
          message:
            result.reason instanceof Error
              ? result.reason.message.slice(0, 300)
              : "The registry search failed.",
        });
        return [];
      }

      return result.value;
    });

    const needle = options.query.trim().toLocaleLowerCase("en-US");
    const deduplicated = [
      ...new Map(items.map((item) => [item.purl, item])).values(),
    ]
      .sort(
        (left, right) =>
          relevance(left.name, needle) - relevance(right.name, needle) ||
          (sourceOrder.get(left.source) ?? 0) -
            (sourceOrder.get(right.source) ?? 0) ||
          left.name.localeCompare(right.name),
      )
      .slice(0, options.limit);

    return {
      items: deduplicated,
      failures,
      searchedSources: selected.map((entry) => entry.source),
    };
  }
}
