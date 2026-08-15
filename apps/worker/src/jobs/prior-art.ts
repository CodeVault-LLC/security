import { eq, sql } from "drizzle-orm";

import {
  normalizeIdentity,
  type PriorArtProvider,
  type PriorArtQuery,
} from "@codevault/core";
import { schema } from "@codevault/db";

import type { WorkerContext } from "../context.js";
import { searchInternal } from "./prior-art/internal-search.js";
import { createProviders } from "./prior-art/providers.js";

/**
 * The prior-art check job.
 *
 * Stage A searches CodeVault's own corpus. Stage B queries each external
 * provider that is configured and applicable. Every result is stored with the
 * query that produced it and the moment it was retrieved, so the check can be
 * re-read months later and re-run for comparison.
 *
 * Stage C — AI synthesis — is not performed here. It runs on the researcher's
 * workstation through the desktop client, because that is where the AI provider
 * lives, and its output is attached to this check as advisory analysis.
 */

export interface PriorArtJobData {
  checkId: string;
  findingId: string;
  caseId: string;
  keywords: string[];
  skipAiSynthesis: boolean;
}

interface SourceRecord {
  provider: string;
  queries: string[];
  resultCount: number;
  error: string | null;
  retrievedAt: string | null;
}

/** Results per provider; enough to be useful, small enough to read. */
const RESULTS_PER_PROVIDER = 25;

export async function runPriorArtCheck(
  context: WorkerContext,
  data: PriorArtJobData,
): Promise<void> {
  const { db } = context;

  await db
    .update(schema.priorArtChecks)
    .set({ status: "RUNNING" })
    .where(eq(schema.priorArtChecks.id, data.checkId));

  try {
    const query = await buildQuery(context, data);
    const sources: SourceRecord[] = [];

    const internal = await searchInternal(db, data.findingId, query);

    sources.push({
      provider: "CODEVAULT",
      queries:
        internal.length > 0 ? [internal[0]?.query ?? ""] : ["internal search"],
      resultCount: internal.length,
      error: null,
      retrievedAt: new Date().toISOString(),
    });

    for (const match of internal) {
      await db.insert(schema.priorArtMatches).values({
        checkId: data.checkId,
        origin: "INTERNAL",
        provider: match.provider,
        externalId: match.externalId,
        matchedFindingId: match.findingId,
        title: match.title,
        url: match.url,
        publisher: match.publisher,
        publishedAt: match.publishedAt,
        affectedIdentity: match.affectedIdentity,
        summary: match.summary,
        query: match.query,
        retrievedAt: match.retrievedAt,
        similarity: match.localSimilarity,
      });
    }

    const providers = createProviders({
      nvdApiKey: context.config.priorArt.nvdApiKey,
      githubAdvisoryToken: context.config.priorArt.githubAdvisoryToken,
      userAgent: context.config.priorArt.userAgent,
      timeoutMs: 20_000,
    });

    for (const provider of providers) {
      await runProvider(context, data.checkId, provider, query, sources);
    }

    await db
      .update(schema.priorArtChecks)
      .set({
        status: "COMPLETED",
        sourcesChecked: sources,
        completedAt: sql`now()`,
      })
      .where(eq(schema.priorArtChecks.id, data.checkId));

    context.log(
      `prior-art check ${data.checkId} completed with ${sources.reduce(
        (total, source) => total + source.resultCount,
        0,
      )} candidate(s)`,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    await db
      .update(schema.priorArtChecks)
      .set({
        status: "FAILED",
        failureReason: message.slice(0, 500),
        completedAt: sql`now()`,
      })
      .where(eq(schema.priorArtChecks.id, data.checkId));

    throw error;
  }
}

/**
 * Runs one provider.
 *
 * A provider failure is recorded against that provider and does not fail the
 * check: partial coverage with an honest record of what was unreachable beats
 * no answer at all.
 */
async function runProvider(
  context: WorkerContext,
  checkId: string,
  provider: PriorArtProvider,
  query: PriorArtQuery,
  sources: SourceRecord[],
): Promise<void> {
  if (!provider.supports(query)) {
    sources.push({
      provider: provider.id,
      queries: [],
      resultCount: 0,
      error: "Not applicable to this finding, or not configured.",
      retrievedAt: null,
    });

    return;
  }

  try {
    const results = await provider.search(query);

    for (const result of results) {
      await context.db.insert(schema.priorArtMatches).values({
        checkId,
        origin: "EXTERNAL",
        provider: result.provider,
        externalId: result.externalId,
        title: result.title,
        url: result.url,
        publisher: result.publisher,
        publishedAt: result.publishedAt,
        affectedIdentity: result.affectedIdentity,
        summary: result.summary,
        query: result.query,
        retrievedAt: result.retrievedAt,
        similarity: result.localSimilarity,
      });
    }

    sources.push({
      provider: provider.id,
      queries: [...new Set(results.map((result) => result.query))],
      resultCount: results.length,
      error: null,
      retrievedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    sources.push({
      provider: provider.id,
      queries: [],
      resultCount: 0,
      error: message.slice(0, 300),
      retrievedAt: new Date().toISOString(),
    });

    context.log(`prior-art provider ${provider.id} failed: ${message}`);
  }
}

async function buildQuery(
  context: WorkerContext,
  data: PriorArtJobData,
): Promise<PriorArtQuery> {
  const { db } = context;

  const findings = await db
    .select({
      title: schema.findings.title,
      cweIds: schema.findings.cweIds,
    })
    .from(schema.findings)
    .where(eq(schema.findings.id, data.findingId))
    .limit(1);

  const finding = findings[0];

  if (finding === undefined) {
    throw new Error(`Finding ${data.findingId} no longer exists.`);
  }

  const assets = await db
    .select({
      name: schema.assets.name,
      vendor: schema.assets.vendor,
      assetId: schema.assets.id,
      primary: schema.findingAssets.primary,
    })
    .from(schema.findingAssets)
    .innerJoin(
      schema.assets,
      eq(schema.assets.id, schema.findingAssets.assetId),
    )
    .where(eq(schema.findingAssets.findingId, data.findingId));

  const primary = assets.find((asset) => asset.primary) ?? assets[0];

  const identifiers =
    primary === undefined
      ? []
      : await db
          .select({
            scheme: schema.assetIdentifiers.scheme,
            value: schema.assetIdentifiers.value,
          })
          .from(schema.assetIdentifiers)
          .where(eq(schema.assetIdentifiers.assetId, primary.assetId));

  const cves = await db
    .select({ value: schema.findingIdentifiers.value })
    .from(schema.findingIdentifiers)
    .where(
      sql`${schema.findingIdentifiers.findingId} = ${data.findingId}
          AND ${schema.findingIdentifiers.scheme} = 'CVE'`,
    );

  return {
    identity: normalizeIdentity({
      name: primary?.name ?? finding.title,
      vendor: primary?.vendor ?? null,
      identifiers,
    }),
    title: finding.title,
    cweIds: finding.cweIds,
    cveIds: cves.map((row) => row.value),
    keywords: data.keywords,
    limit: RESULTS_PER_PROVIDER,
  };
}
