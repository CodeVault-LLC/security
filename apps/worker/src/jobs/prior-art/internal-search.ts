import { sql } from "drizzle-orm";

import type { PriorArtQuery, PriorArtProviderResult } from "@codevault/core";
import { titleSimilarity } from "@codevault/core";
import type { Database } from "@codevault/db";

/**
 * Stage A: deterministic internal search.
 *
 * Runs first and always, with no network and no AI. A researcher gets an answer
 * to "have we seen this before?" from their own corpus immediately, even when
 * every external provider is unconfigured or unreachable.
 */

export interface InternalMatch extends PriorArtProviderResult {
  findingId: string;
}

export async function searchInternal(
  db: Database,
  findingId: string,
  query: PriorArtQuery,
): Promise<InternalMatch[]> {
  const terms = [
    query.identity.product,
    query.identity.vendor,
    ...query.keywords,
  ]
    .filter((term) => term.length > 0)
    .join(" ");

  const textQuery = terms.length > 0 ? terms : query.title;
  const retrievedAt = new Date().toISOString();
  const queryDescription =
    `internal: fts(${textQuery}) + trigram(title) + cwe(${query.cweIds.join(",") || "none"})` +
    ` + identifiers(${query.cveIds.join(",") || "none"})`;

  const rows = await db.execute<{
    id: string;
    ref: string;
    title: string;
    summary: string | null;
    case_ref: string;
    created_at: string;
    rank: number;
  }>(sql`
    SELECT f.id, f.ref, f.title,
           left(coalesce(f.summary_markdown, ''), 400) AS summary,
           c.ref AS case_ref, f.created_at,
           GREATEST(
             ts_rank(f.search_vector, websearch_to_tsquery('english', ${textQuery})),
             similarity(f.title, ${query.title}),
             CASE
               WHEN EXISTS (
                 SELECT 1 FROM finding_identifiers fi
                 WHERE fi.finding_id = f.id
                   AND upper(fi.value) = ANY(${query.cveIds.map((id) => id.toUpperCase())}::text[])
               ) THEN 1.0
               ELSE 0
             END,
             CASE
               WHEN f.cwe_ids ?| ${query.cweIds}::text[] THEN 0.45
               ELSE 0
             END,
             CASE
               WHEN EXISTS (
                 SELECT 1 FROM finding_assets fa
                 JOIN assets a ON a.id = fa.asset_id
                 WHERE fa.finding_id = f.id
                   AND a.normalized_product = ${query.identity.product}
               ) THEN 0.6
               ELSE 0
             END
           ) AS rank
    FROM findings f
    JOIN cases c ON c.id = f.case_id
    WHERE f.id <> ${findingId}
    ORDER BY rank DESC
    LIMIT ${query.limit}
  `);

  return rows.rows
    // Below this the "match" is noise, and a prior-art tab full of noise is
    // one a researcher stops reading.
    .filter((row) => Number(row.rank) > 0.1)
    .map((row) => ({
      provider: "CODEVAULT",
      findingId: row.id,
      externalId: row.ref,
      title: row.title,
      url: `codevault://findings/${row.id}`,
      publisher: `CodeVault ${row.case_ref}`,
      publishedAt: row.created_at,
      affectedIdentity: query.identity.product,
      summary: row.summary ?? "",
      query: queryDescription,
      retrievedAt,
      localSimilarity: Math.max(
        Number(row.rank),
        titleSimilarity(query.title, row.title),
      ),
    }));
}
