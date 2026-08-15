import type { PriorArtProvider, PriorArtProviderResult } from "@codevault/core";
import { titleSimilarity } from "@codevault/core";

/**
 * External prior-art providers.
 *
 * Each adapter is a pure lookup that returns what a source said, together with
 * the exact query used and the time it ran. It never decides whether a finding
 * is novel — that is a person's conclusion, recorded separately.
 *
 * A provider that is not configured is skipped and the check records that it
 * was skipped, because "we did not look there" and "we looked and found
 * nothing" are different claims.
 */

export interface ProviderConfig {
  nvdApiKey: string | null;
  githubAdvisoryToken: string | null;
  userAgent: string;
  /** Milliseconds before a single provider request is abandoned. */
  timeoutMs: number;
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function truncate(value: string, length = 600): string {
  const collapsed = value.replace(/\s+/g, " ").trim();

  return collapsed.length <= length
    ? collapsed
    : `${collapsed.slice(0, length - 1)}…`;
}

/**
 * NVD.
 *
 * Queried by keyword over the CVE corpus. An API key is optional but raises the
 * rate limit substantially, and without one the adapter still runs.
 */
export function createNvdProvider(config: ProviderConfig): PriorArtProvider {
  return {
    id: "NVD",
    displayName: "NVD CVE database",

    supports(query) {
      return query.identity.product.length > 0 || query.cveIds.length > 0;
    },

    async search(query) {
      const terms = [query.identity.vendor, query.identity.product]
        .filter((term) => term.length > 0)
        .join(" ");

      const url = new URL("https://services.nvd.nist.gov/rest/json/cves/2.0");

      url.searchParams.set("keywordSearch", terms);
      url.searchParams.set("resultsPerPage", String(Math.min(query.limit, 50)));

      const headers: Record<string, string> = {
        "user-agent": config.userAgent,
        accept: "application/json",
      };

      if (config.nvdApiKey !== null) {
        headers.apiKey = config.nvdApiKey;
      }

      const payload = await fetchJson(
        url.toString(),
        headers,
        config.timeoutMs,
      );
      const retrievedAt = new Date().toISOString();
      const vulnerabilities = extractArray(payload, "vulnerabilities");
      const results: PriorArtProviderResult[] = [];

      for (const entry of vulnerabilities) {
        const cve = readObject(entry, "cve");

        if (cve === null) {
          continue;
        }

        const id = readString(cve, "id") ?? "";
        const descriptions = extractArray(cve, "descriptions");
        const english = descriptions.find(
          (item) => readString(item, "lang") === "en",
        );
        const summary =
          english === undefined ? "" : (readString(english, "value") ?? "");

        results.push({
          provider: "NVD",
          externalId: id,
          title: truncate(summary, 160),
          url: `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(id)}`,
          publisher: "NVD",
          publishedAt: readString(cve, "published"),
          affectedIdentity: terms,
          summary: truncate(summary),
          query: url.toString(),
          retrievedAt,
          localSimilarity: titleSimilarity(query.title, summary),
        });
      }

      return results;
    },
  };
}

/**
 * OSV.
 *
 * Only usable when the asset carries a PURL, which is exactly when it is most
 * accurate: an ecosystem and package name rather than a fuzzy product string.
 */
export function createOsvProvider(config: ProviderConfig): PriorArtProvider {
  return {
    id: "OSV",
    displayName: "OSV package advisories",

    supports(query) {
      return (
        query.identity.ecosystem !== null && query.identity.packageName !== null
      );
    },

    async search(query) {
      const ecosystem = query.identity.ecosystem;
      const packageName = query.identity.packageName;

      if (ecosystem === null || packageName === null) {
        return [];
      }

      const body = JSON.stringify({
        package: { name: packageName, ecosystem: osvEcosystem(ecosystem) },
      });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      let payload: unknown;

      try {
        const response = await fetch("https://api.osv.dev/v1/query", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": config.userAgent,
          },
          body,
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }

        payload = await response.json();
      } finally {
        clearTimeout(timer);
      }

      const retrievedAt = new Date().toISOString();
      const vulns = extractArray(payload, "vulns");

      return vulns.slice(0, query.limit).map((entry) => {
        const id = readString(entry, "id") ?? "";
        const summary =
          readString(entry, "summary") ?? readString(entry, "details") ?? "";

        return {
          provider: "OSV",
          externalId: id,
          title: truncate(summary, 160),
          url: `https://osv.dev/vulnerability/${encodeURIComponent(id)}`,
          publisher: "OSV",
          publishedAt: readString(entry, "published"),
          affectedIdentity: `${ecosystem}/${packageName}`,
          summary: truncate(summary),
          query: `POST https://api.osv.dev/v1/query ${body}`,
          retrievedAt,
          localSimilarity: titleSimilarity(query.title, summary),
        };
      });
    },
  };
}

/**
 * GitHub Security Advisories.
 *
 * Requires a token; skipped when none is configured.
 */
export function createGithubAdvisoryProvider(
  config: ProviderConfig,
): PriorArtProvider {
  return {
    id: "GHSA",
    displayName: "GitHub Security Advisories",

    supports(query) {
      return (
        config.githubAdvisoryToken !== null && query.identity.product.length > 0
      );
    },

    async search(query) {
      const token = config.githubAdvisoryToken;

      if (token === null) {
        return [];
      }

      const url = new URL("https://api.github.com/advisories");

      url.searchParams.set(
        "affects",
        query.identity.packageName ?? query.identity.product,
      );
      url.searchParams.set("per_page", String(Math.min(query.limit, 50)));

      const payload = await fetchJson(
        url.toString(),
        {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "user-agent": config.userAgent,
          "x-github-api-version": "2022-11-28",
        },
        config.timeoutMs,
      );

      const retrievedAt = new Date().toISOString();

      if (!Array.isArray(payload)) {
        return [];
      }

      return payload.map((entry) => {
        const id = readString(entry, "ghsa_id") ?? "";
        const summary = readString(entry, "summary") ?? "";

        return {
          provider: "GHSA",
          externalId: id,
          title: truncate(summary, 160),
          url:
            readString(entry, "html_url") ??
            `https://github.com/advisories/${id}`,
          publisher: "GitHub",
          publishedAt: readString(entry, "published_at"),
          affectedIdentity:
            query.identity.packageName ?? query.identity.product,
          summary: truncate(readString(entry, "description") ?? summary),
          query: url.toString(),
          retrievedAt,
          localSimilarity: titleSimilarity(query.title, summary),
        };
      });
    },
  };
}

/** Maps a PURL type onto OSV's ecosystem naming. */
function osvEcosystem(purlType: string): string {
  const mapping: Record<string, string> = {
    npm: "npm",
    pypi: "PyPI",
    gem: "RubyGems",
    cargo: "crates.io",
    golang: "Go",
    maven: "Maven",
    nuget: "NuGet",
    composer: "Packagist",
    deb: "Debian",
    apk: "Alpine",
    rpm: "Rocky Linux",
  };

  return mapping[purlType] ?? purlType;
}

function readObject(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return (value as Record<string, unknown>)[key] ?? null;
}

function readString(value: unknown, key: string): string | null {
  const field = readObject(value, key);

  return typeof field === "string" ? field : null;
}

function extractArray(value: unknown, key: string): unknown[] {
  const field = readObject(value, key);

  return Array.isArray(field) ? field : [];
}

export function createProviders(config: ProviderConfig): PriorArtProvider[] {
  return [
    createNvdProvider(config),
    createOsvProvider(config),
    createGithubAdvisoryProvider(config),
  ];
}
