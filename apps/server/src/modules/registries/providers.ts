import type {
  AssetRegistryResult,
  AssetRegistrySource,
} from "@codevault/contracts";

import type { AssetRegistryProvider, RegistryHttpClient } from "./provider.js";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(record).filter((item): item is JsonRecord => item !== null)
    : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function plainText(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;

  const stripped = raw
    .replace(/<[^>]*>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/giu, (_match, hex, decimal) => {
      const point = Number.parseInt(hex ?? decimal, hex ? 16 : 10);
      return Number.isSafeInteger(point) ? String.fromCodePoint(point) : "";
    })
    .replace(/\s+/gu, " ")
    .trim();

  return stripped.length === 0 ? null : stripped.slice(0, 2_000);
}

function safeHttpsUrl(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;

  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function timestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  const raw = text(value);
  if (raw === null) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function segment(value: string): string {
  return encodeURIComponent(value.trim());
}

function metadata(
  values: Record<string, string | number | boolean | null | undefined>,
): AssetRegistryResult["metadata"] {
  return Object.fromEntries(
    Object.entries(values).filter((entry) => entry[1] !== undefined),
  ) as AssetRegistryResult["metadata"];
}

function provider(
  source: AssetRegistrySource,
  label: string,
  search: (query: string, limit: number) => Promise<AssetRegistryResult[]>,
): AssetRegistryProvider {
  return { source, label, search };
}

function wordpressProvider(
  client: RegistryHttpClient,
  kind: "plugin" | "theme",
): AssetRegistryProvider {
  const isPlugin = kind === "plugin";
  const source = isPlugin ? "WORDPRESS_PLUGIN" : "WORDPRESS_THEME";
  const label = isPlugin ? "WordPress plugins" : "WordPress themes";

  return provider(source, label, async (query, limit) => {
    const endpoint = isPlugin ? "plugins" : "themes";
    const url = new URL(`https://api.wordpress.org/${endpoint}/info/1.2/`);
    url.searchParams.set("action", isPlugin ? "query_plugins" : "query_themes");
    url.searchParams.set("request[search]", query);
    url.searchParams.set("request[per_page]", String(limit));
    url.searchParams.set("request[fields][sections]", "0");

    const payload = record(await client.getJson(url));
    const rows = records(payload?.[isPlugin ? "plugins" : "themes"]);

    return rows.flatMap((row) => {
      const slug = text(row.slug);
      const name = plainText(row.name);
      if (slug === null || name === null) return [];

      const author = plainText(row.author);
      const sourceUrl = `https://wordpress.org/${isPlugin ? "plugins" : "themes"}/${segment(slug)}/`;

      return [
        {
          source,
          sourceLabel: label,
          externalId: slug,
          name,
          description: plainText(row.short_description ?? row.description),
          latestVersion: text(row.version),
          purl: `pkg:wordpress/${segment(slug)}`,
          vendorName: author,
          homepageUrl: safeHttpsUrl(row.homepage),
          sourceUrl,
          lastUpdatedAt: timestamp(row.last_updated),
          metadata: metadata({
            registry: "wordpress.org",
            extensionType: kind,
            author,
            activeInstalls: finiteNumber(row.active_installs),
            downloads: finiteNumber(row.downloaded),
            rating: finiteNumber(row.rating),
            requiresWordPress: text(row.requires),
            testedWordPress: text(row.tested),
            requiresPhp: text(row.requires_php),
          }),
        },
      ];
    });
  });
}

export function createDefaultRegistryProviders(
  client: RegistryHttpClient,
): AssetRegistryProvider[] {
  return [
    wordpressProvider(client, "plugin"),
    wordpressProvider(client, "theme"),
    provider("NPM", "npm", async (query, limit) => {
      const url = new URL("https://registry.npmjs.org/-/v1/search");
      url.searchParams.set("text", query);
      url.searchParams.set("size", String(limit));
      const payload = record(await client.getJson(url));

      return records(payload?.objects).flatMap((wrapper) => {
        const pkg = record(wrapper.package);
        const name = text(pkg?.name);
        if (name === null) return [];
        const publisher = record(pkg?.publisher);

        return [
          {
            source: "NPM",
            sourceLabel: "npm",
            externalId: name,
            name,
            description: plainText(pkg?.description),
            latestVersion: text(pkg?.version),
            purl: `pkg:npm/${name.split("/").map(segment).join("/")}`,
            vendorName: text(publisher?.username ?? publisher?.name),
            homepageUrl: safeHttpsUrl(
              pkg?.links && record(pkg.links)?.homepage,
            ),
            sourceUrl: `https://www.npmjs.com/package/${name.split("/").map(segment).join("/")}`,
            lastUpdatedAt: timestamp(pkg?.date),
            metadata: metadata({
              registry: "npmjs.com",
              publisher: text(publisher?.username ?? publisher?.name),
              score: finiteNumber(record(wrapper.score)?.final),
            }),
          },
        ];
      });
    }),
    provider("CRATES_IO", "crates.io", async (query, limit) => {
      const url = new URL("https://crates.io/api/v1/crates");
      url.searchParams.set("q", query);
      url.searchParams.set("per_page", String(limit));
      const payload = record(await client.getJson(url));

      return records(payload?.crates).flatMap((row) => {
        const name = text(row.id ?? row.name);
        if (name === null) return [];
        return [
          {
            source: "CRATES_IO",
            sourceLabel: "crates.io",
            externalId: name,
            name,
            description: plainText(row.description),
            latestVersion: text(row.newest_version ?? row.max_version),
            purl: `pkg:cargo/${segment(name)}`,
            vendorName: null,
            homepageUrl: safeHttpsUrl(row.homepage),
            sourceUrl: `https://crates.io/crates/${segment(name)}`,
            lastUpdatedAt: timestamp(row.updated_at),
            metadata: metadata({
              registry: "crates.io",
              downloads: finiteNumber(row.downloads),
              repository: safeHttpsUrl(row.repository),
            }),
          },
        ];
      });
    }),
    provider("PACKAGIST", "Packagist", async (query, limit) => {
      const url = new URL("https://packagist.org/search.json");
      url.searchParams.set("q", query);
      url.searchParams.set("per_page", String(limit));
      const payload = record(await client.getJson(url));

      return records(payload?.results).flatMap((row) => {
        const name = text(row.name);
        if (name === null) return [];
        return [
          {
            source: "PACKAGIST",
            sourceLabel: "Packagist",
            externalId: name,
            name,
            description: plainText(row.description),
            latestVersion: null,
            purl: `pkg:composer/${name.split("/").map(segment).join("/")}`,
            vendorName: name.includes("/")
              ? (name.split("/")[0] ?? null)
              : null,
            homepageUrl: safeHttpsUrl(row.url),
            sourceUrl: `https://packagist.org/packages/${name.split("/").map(segment).join("/")}`,
            lastUpdatedAt: null,
            metadata: metadata({
              registry: "packagist.org",
              downloads: finiteNumber(row.downloads),
              favers: finiteNumber(row.favers),
              repository: safeHttpsUrl(row.repository),
            }),
          },
        ];
      });
    }),
    provider("RUBYGEMS", "RubyGems", async (query, limit) => {
      const url = new URL("https://rubygems.org/api/v1/search.json");
      url.searchParams.set("query", query);
      const payload = await client.getJson(url);

      return records(payload)
        .slice(0, limit)
        .flatMap((row) => {
          const name = text(row.name);
          if (name === null) return [];
          return [
            {
              source: "RUBYGEMS",
              sourceLabel: "RubyGems",
              externalId: name,
              name,
              description: plainText(row.info),
              latestVersion: text(row.version),
              purl: `pkg:gem/${segment(name)}`,
              vendorName: text(row.authors),
              homepageUrl: safeHttpsUrl(row.homepage_uri),
              sourceUrl: `https://rubygems.org/gems/${segment(name)}`,
              lastUpdatedAt: timestamp(row.version_created_at),
              metadata: metadata({
                registry: "rubygems.org",
                authors: text(row.authors),
                downloads: finiteNumber(row.downloads),
                sourceCode: safeHttpsUrl(row.source_code_uri),
              }),
            },
          ];
        });
    }),
    provider("NUGET", "NuGet", async (query, limit) => {
      const url = new URL("https://azuresearch-usnc.nuget.org/query");
      url.searchParams.set("q", query);
      url.searchParams.set("take", String(limit));
      url.searchParams.set("prerelease", "true");
      const payload = record(await client.getJson(url));

      return records(payload?.data).flatMap((row) => {
        const name = text(row.id);
        if (name === null) return [];
        const authors = Array.isArray(row.authors)
          ? row.authors.map(text).filter(Boolean).join(", ")
          : text(row.authors);
        return [
          {
            source: "NUGET",
            sourceLabel: "NuGet",
            externalId: name,
            name,
            description: plainText(row.description),
            latestVersion: text(row.version),
            purl: `pkg:nuget/${segment(name)}`,
            vendorName: authors || null,
            homepageUrl: safeHttpsUrl(row.projectUrl),
            sourceUrl: `https://www.nuget.org/packages/${segment(name)}`,
            lastUpdatedAt: timestamp(row.published),
            metadata: metadata({
              registry: "nuget.org",
              authors: authors || null,
              downloads: finiteNumber(row.totalDownloads),
            }),
          },
        ];
      });
    }),
    provider("MAVEN_CENTRAL", "Maven Central", async (query, limit) => {
      const url = new URL("https://search.maven.org/solrsearch/select");
      url.searchParams.set("q", query);
      url.searchParams.set("rows", String(limit));
      url.searchParams.set("wt", "json");
      const payload = record(await client.getJson(url));
      const response = record(payload?.response);

      return records(response?.docs).flatMap((row) => {
        const group = text(row.g);
        const artifact = text(row.a);
        if (group === null || artifact === null) return [];
        const id = `${group}:${artifact}`;
        return [
          {
            source: "MAVEN_CENTRAL",
            sourceLabel: "Maven Central",
            externalId: id,
            name: artifact,
            description: null,
            latestVersion: text(row.latestVersion),
            purl: `pkg:maven/${segment(group)}/${segment(artifact)}`,
            vendorName: group,
            homepageUrl: null,
            sourceUrl: `https://central.sonatype.com/artifact/${segment(group)}/${segment(artifact)}`,
            lastUpdatedAt: timestamp(row.timestamp),
            metadata: metadata({
              registry: "central.sonatype.com",
              group,
              versionCount: finiteNumber(row.versionCount),
            }),
          },
        ];
      });
    }),
  ];
}
