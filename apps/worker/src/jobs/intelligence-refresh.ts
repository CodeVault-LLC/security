import { and, eq, sql } from "drizzle-orm";

import { schema } from "@codevault/db";

import type { WorkerContext } from "../context.js";

/**
 * EPSS and KEV refresh.
 *
 * Both are retrieved facts, not calculations: each is stored with its source
 * and the moment it was fetched, and neither is ever folded into a CVSS score.
 * A researcher reading "EPSS 0.43" should always be able to see when that was
 * true, because next month it will not be.
 */

export interface IntelligenceRefreshJobData {
  findingId: string;
  cveIds: string[];
}

interface EpssRecord {
  cve: string;
  epss: number;
  percentile: number;
  date: string;
}

const EPSS_ENDPOINT = "https://api.first.org/data/v1/epss";
const KEV_ENDPOINT =
  "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";

const REQUEST_TIMEOUT_MS = 20_000;

export async function refreshIntelligence(
  context: WorkerContext,
  data: IntelligenceRefreshJobData,
): Promise<void> {
  if (data.cveIds.length === 0) {
    return;
  }

  const epss = await fetchEpss(context, data.cveIds);
  const kev = await fetchKevMembership(context, data.cveIds);
  const retrievedAt = new Date().toISOString();

  for (const cveId of data.cveIds) {
    const score = epss.get(cveId);

    if (score !== undefined) {
      await upsertIntelligenceScore(context, {
        findingId: data.findingId,
        scheme: "EPSS",
        score: score.epss,
        sourceName: `FIRST EPSS (model date ${score.date})`,
        metrics: { percentile: score.percentile, modelDate: score.date },
        retrievedAt,
      });
    }

    if (kev.has(cveId)) {
      await upsertIntelligenceScore(context, {
        findingId: data.findingId,
        scheme: "KEV",
        // KEV is a membership fact, not a magnitude; 1 records "listed".
        score: 1,
        sourceName: "CISA Known Exploited Vulnerabilities catalog",
        metrics: { listed: true, cveId },
        retrievedAt,
      });
    }
  }

  context.log(
    `intelligence refreshed for ${data.findingId}: ${epss.size} EPSS, ${kev.size} KEV`,
  );
}

interface IntelligenceScore {
  findingId: string;
  scheme: string;
  score: number;
  sourceName: string;
  metrics: Record<string, unknown>;
  retrievedAt: string;
}

/**
 * Records a retrieved value, superseding the previous one.
 *
 * Intelligence records are approved on arrival because there is nothing for a
 * human to judge: the claim is "this is what the source said at this time",
 * and it either was or was not.
 */
async function upsertIntelligenceScore(
  context: WorkerContext,
  input: IntelligenceScore,
): Promise<void> {
  const { db } = context;

  await db.transaction(async (tx) => {
    const owners = await tx
      .select({ ownerId: schema.findings.ownerId })
      .from(schema.findings)
      .where(eq(schema.findings.id, input.findingId))
      .limit(1);

    const ownerId = owners[0]?.ownerId;

    if (ownerId === undefined) {
      return;
    }

    await tx
      .update(schema.findingScores)
      .set({ reviewState: "SUPERSEDED" })
      .where(
        and(
          eq(schema.findingScores.findingId, input.findingId),
          eq(schema.findingScores.scheme, input.scheme),
          eq(schema.findingScores.reviewState, "APPROVED"),
        ),
      );

    await tx.insert(schema.findingScores).values({
      findingId: input.findingId,
      scheme: input.scheme,
      vector: null,
      score: input.score,
      severity: null,
      metrics: input.metrics,
      source: "EXTERNAL",
      reviewState: "APPROVED",
      sourceName: input.sourceName,
      retrievedAt: input.retrievedAt,
      createdBy: ownerId,
    });

    await tx
      .update(schema.findings)
      .set({ updatedAt: sql`now()` })
      .where(eq(schema.findings.id, input.findingId));
  });
}

async function fetchEpss(
  context: WorkerContext,
  cveIds: readonly string[],
): Promise<Map<string, EpssRecord>> {
  const results = new Map<string, EpssRecord>();
  const url = new URL(EPSS_ENDPOINT);

  url.searchParams.set("cve", cveIds.join(","));

  try {
    const payload = await fetchWithTimeout(url.toString(), {
      "user-agent": context.config.priorArt.userAgent,
      accept: "application/json",
    });

    const data = (payload as { data?: unknown }).data;

    if (!Array.isArray(data)) {
      return results;
    }

    for (const entry of data) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }

      const record = entry as Record<string, unknown>;
      const cve = typeof record.cve === "string" ? record.cve : null;

      if (cve === null) {
        continue;
      }

      results.set(cve.toUpperCase(), {
        cve,
        epss: Number(record.epss ?? 0),
        percentile: Number(record.percentile ?? 0),
        date: typeof record.date === "string" ? record.date : "unknown",
      });
    }
  } catch (error: unknown) {
    context.log(
      `EPSS refresh failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return results;
}

async function fetchKevMembership(
  context: WorkerContext,
  cveIds: readonly string[],
): Promise<Set<string>> {
  const wanted = new Set(cveIds.map((id) => id.toUpperCase()));
  const listed = new Set<string>();

  try {
    const payload = await fetchWithTimeout(KEV_ENDPOINT, {
      "user-agent": context.config.priorArt.userAgent,
      accept: "application/json",
    });

    const vulnerabilities = (payload as { vulnerabilities?: unknown })
      .vulnerabilities;

    if (!Array.isArray(vulnerabilities)) {
      return listed;
    }

    for (const entry of vulnerabilities) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }

      const id = (entry as Record<string, unknown>).cveID;

      if (typeof id === "string" && wanted.has(id.toUpperCase())) {
        listed.add(id.toUpperCase());
      }
    }
  } catch (error: unknown) {
    context.log(
      `KEV refresh failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return listed;
}

async function fetchWithTimeout(
  url: string,
  headers: Record<string, string>,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { headers, signal: controller.signal });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
