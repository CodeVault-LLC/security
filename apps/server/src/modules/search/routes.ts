import type { AppInstance } from "../../http/app-instance.js";
import { sql } from "drizzle-orm";

import {
  SearchQuery,
  SearchResponse,
  type SearchGroup,
  type SearchHit,
} from "@codevault/contracts";
import { isSha256, isValidCveId, parseReference } from "@codevault/core";

import { actingUser } from "../../http/guards.js";
import { readableCaseIdsSubquery } from "../findings/queries.js";

/**
 * Global search.
 *
 * Ranking is deliberately explicit rather than a single blended relevance
 * number: an exact reference, CVE or file digest is what the researcher typed
 * on purpose, and it outranks every text match. Fuzzy name matching exists for
 * the cases where they half-remember a product name.
 */

const EXACT_SCORE = 1_000;
const IDENTIFIER_SCORE = 900;
const HASH_SCORE = 950;

export async function registerSearchRoutes(app: AppInstance): Promise<void> {
  app.get(
    "/v1/search",
    { schema: { querystring: SearchQuery, response: { 200: SearchResponse } } },
    async (request) => {
      const user = actingUser(request);
      const started = Date.now();
      const term = request.query.q.trim();
      const limit = request.query.limit ?? 30;
      const requestedGroups = request.query.groups;
      const scope = readableCaseIdsSubquery(user.organizationId);

      const wanted = (group: SearchGroup): boolean =>
        requestedGroups === undefined || requestedGroups.includes(group);

      const groups: SearchResponse["groups"] = [];

      const reference = parseReference(term);
      const looksLikeHash = isSha256(term);
      const looksLikeCve = isValidCveId(term);
      const pattern = `%${term}%`;
      const tsQuery = sql`websearch_to_tsquery('english', ${term})`;

      if (wanted("CASES")) {
        const rows = await app.db.execute<{
          id: string;
          ref: string;
          title: string;
          snippet: string | null;
          updated_at: string;
          rank: number;
        }>(sql`
          SELECT c.id, c.ref, c.title,
                 left(coalesce(c.summary, ''), 200) AS snippet,
                 c.updated_at,
                 CASE
                   WHEN upper(c.ref) = upper(${term}) THEN ${EXACT_SCORE}
                   ELSE ts_rank(c.search_vector, ${tsQuery}) + similarity(c.title, ${term})
                 END AS rank
          FROM cases c
          WHERE c.id IN ${scope}
            AND (
              upper(c.ref) = upper(${term})
              OR c.search_vector @@ ${tsQuery}
              OR c.title ILIKE ${pattern}
            )
          ORDER BY rank DESC
          LIMIT ${limit}
        `);

        groups.push({
          group: "CASES",
          total: rows.rows.length,
          hits: rows.rows.map((row) => ({
            group: "CASES" as const,
            id: row.id,
            ref: row.ref,
            title: row.title,
            snippet: row.snippet,
            score: Number(row.rank),
            matchKind:
              reference?.kind === "case" && Number(row.rank) >= EXACT_SCORE
                ? ("EXACT_REFERENCE" as const)
                : ("FULL_TEXT" as const),
            caseId: row.id,
            severity: null,
            updatedAt: row.updated_at,
          })),
        });
      }

      if (wanted("FINDINGS")) {
        const rows = await app.db.execute<{
          id: string;
          ref: string;
          title: string;
          snippet: string | null;
          case_id: string;
          severity: string | null;
          updated_at: string;
          rank: number;
          matched_identifier: boolean;
        }>(sql`
          SELECT f.id, f.ref, f.title,
                 left(coalesce(f.summary_markdown, ''), 200) AS snippet,
                 f.case_id, f.severity, f.updated_at,
                 EXISTS (
                   SELECT 1 FROM finding_identifiers fi
                   WHERE fi.finding_id = f.id AND upper(fi.value) = upper(${term})
                 ) AS matched_identifier,
                 CASE
                   WHEN upper(f.ref) = upper(${term}) THEN ${EXACT_SCORE}
                   WHEN EXISTS (
                     SELECT 1 FROM finding_identifiers fi
                     WHERE fi.finding_id = f.id AND upper(fi.value) = upper(${term})
                   ) THEN ${IDENTIFIER_SCORE}
                   ELSE ts_rank(f.search_vector, ${tsQuery}) + similarity(f.title, ${term})
                 END AS rank
          FROM findings f
          WHERE f.case_id IN ${scope}
            AND (
              upper(f.ref) = upper(${term})
              OR f.search_vector @@ ${tsQuery}
              OR f.title ILIKE ${pattern}
              OR EXISTS (
                SELECT 1 FROM finding_identifiers fi
                WHERE fi.finding_id = f.id AND upper(fi.value) = upper(${term})
              )
            )
          ORDER BY rank DESC
          LIMIT ${limit}
        `);

        groups.push({
          group: "FINDINGS",
          total: rows.rows.length,
          hits: rows.rows.map((row) => ({
            group: "FINDINGS" as const,
            id: row.id,
            ref: row.ref,
            title: row.title,
            snippet: row.snippet,
            score: Number(row.rank),
            matchKind: row.matched_identifier
              ? ("EXACT_IDENTIFIER" as const)
              : Number(row.rank) >= EXACT_SCORE
                ? ("EXACT_REFERENCE" as const)
                : ("FULL_TEXT" as const),
            caseId: row.case_id,
            severity: row.severity as SearchHit["severity"],
            updatedAt: row.updated_at,
          })),
        });
      }

      if (wanted("ASSETS")) {
        const rows = await app.db.execute<{
          id: string;
          ref: string;
          name: string;
          snippet: string | null;
          updated_at: string;
          rank: number;
          matched_identifier: boolean;
        }>(sql`
          SELECT a.id, a.ref, a.name,
                 concat_ws(
                   ' · ',
                   coalesce(v.name, a.legacy_vendor_name),
                   a.version
                 ) AS snippet,
                 a.updated_at,
                 EXISTS (
                   SELECT 1 FROM asset_identifiers ai
                   WHERE ai.asset_id = a.id AND ai.value = ${term}
                 ) AS matched_identifier,
                 CASE
                   WHEN upper(a.ref) = upper(${term}) THEN ${EXACT_SCORE}
                   WHEN EXISTS (
                     SELECT 1 FROM asset_identifiers ai
                     WHERE ai.asset_id = a.id AND ai.value = ${term}
                   ) THEN ${IDENTIFIER_SCORE}
                   ELSE ts_rank(a.search_vector, ${tsQuery})
                     + greatest(
                         similarity(a.name, ${term}),
                         similarity(coalesce(v.name, a.legacy_vendor_name, ''), ${term})
                       )
                 END AS rank
          FROM assets a
          LEFT JOIN vendors v ON v.id = a.vendor_id
          WHERE upper(a.ref) = upper(${term})
             OR a.search_vector @@ ${tsQuery}
             OR a.name ILIKE ${pattern}
             OR v.name ILIKE ${pattern}
             OR similarity(a.name, ${term}) > 0.3
             OR similarity(coalesce(v.name, a.legacy_vendor_name, ''), ${term}) > 0.3
             OR EXISTS (
               SELECT 1 FROM asset_identifiers ai
               WHERE ai.asset_id = a.id AND ai.value = ${term}
             )
          ORDER BY rank DESC
          LIMIT ${limit}
        `);

        groups.push({
          group: "ASSETS",
          total: rows.rows.length,
          hits: rows.rows.map((row) => ({
            group: "ASSETS" as const,
            id: row.id,
            ref: row.ref,
            title: row.name,
            snippet: row.snippet,
            score: Number(row.rank),
            matchKind: row.matched_identifier
              ? ("EXACT_IDENTIFIER" as const)
              : Number(row.rank) >= EXACT_SCORE
                ? ("EXACT_REFERENCE" as const)
                : ("FUZZY_NAME" as const),
            caseId: null,
            severity: null,
            updatedAt: row.updated_at,
          })),
        });
      }

      if (wanted("EVIDENCE")) {
        const rows = await app.db.execute<{
          id: string;
          ref: string;
          title: string;
          snippet: string | null;
          case_id: string;
          updated_at: string;
          rank: number;
          matched_hash: boolean;
        }>(sql`
          SELECT e.id, e.ref, e.title,
                 left(coalesce(e.description_markdown, ''), 200) AS snippet,
                 e.case_id, e.updated_at,
                 EXISTS (
                   SELECT 1 FROM evidence_artifacts ea
                   JOIN artifacts art ON art.id = ea.artifact_id
                   WHERE ea.evidence_id = e.id
                     AND (art.sha256 = lower(${term}) OR art.filename ILIKE ${pattern})
                 ) AS matched_hash,
                 CASE
                   WHEN upper(e.ref) = upper(${term}) THEN ${EXACT_SCORE}
                   WHEN EXISTS (
                     SELECT 1 FROM evidence_artifacts ea
                     JOIN artifacts art ON art.id = ea.artifact_id
                     WHERE ea.evidence_id = e.id AND art.sha256 = lower(${term})
                   ) THEN ${HASH_SCORE}
                   ELSE ts_rank(e.search_vector, ${tsQuery})
                 END AS rank
          FROM evidence e
          WHERE e.case_id IN ${scope}
            AND (
              upper(e.ref) = upper(${term})
              OR e.search_vector @@ ${tsQuery}
              OR e.title ILIKE ${pattern}
              OR EXISTS (
                SELECT 1 FROM evidence_artifacts ea
                JOIN artifacts art ON art.id = ea.artifact_id
                WHERE ea.evidence_id = e.id
                  AND (art.sha256 = lower(${term}) OR art.filename ILIKE ${pattern})
              )
            )
          ORDER BY rank DESC
          LIMIT ${limit}
        `);

        groups.push({
          group: "EVIDENCE",
          total: rows.rows.length,
          hits: rows.rows.map((row) => ({
            group: "EVIDENCE" as const,
            id: row.id,
            ref: row.ref,
            title: row.title,
            snippet: row.snippet,
            score: Number(row.rank),
            matchKind:
              looksLikeHash && row.matched_hash
                ? ("HASH" as const)
                : Number(row.rank) >= EXACT_SCORE
                  ? ("EXACT_REFERENCE" as const)
                  : ("FULL_TEXT" as const),
            caseId: row.case_id,
            severity: null,
            updatedAt: row.updated_at,
          })),
        });
      }

      if (wanted("REPORTS")) {
        const rows = await app.db.execute<{
          id: string;
          ref: string;
          title: string;
          snippet: string | null;
          case_id: string;
          updated_at: string;
          rank: number;
        }>(sql`
          SELECT r.id, r.ref, r.title,
                 left(coalesce(
                   (SELECT string_agg(rs.title, ', ' ORDER BY rs.position)
                    FROM report_sections rs
                    WHERE rs.report_id = r.id AND rs.search_vector @@ ${tsQuery}),
                   ''), 200) AS snippet,
                 r.case_id, r.updated_at,
                 CASE
                   WHEN upper(r.ref) = upper(${term}) THEN ${EXACT_SCORE}
                   ELSE coalesce((
                     SELECT max(ts_rank(rs.search_vector, ${tsQuery}))
                     FROM report_sections rs WHERE rs.report_id = r.id
                   ), 0)
                 END AS rank
          FROM reports r
          WHERE r.case_id IN ${scope}
            AND (
              upper(r.ref) = upper(${term})
              OR r.title ILIKE ${pattern}
              OR EXISTS (
                SELECT 1 FROM report_sections rs
                WHERE rs.report_id = r.id AND rs.search_vector @@ ${tsQuery}
              )
            )
          ORDER BY rank DESC
          LIMIT ${limit}
        `);

        groups.push({
          group: "REPORTS",
          total: rows.rows.length,
          hits: rows.rows.map((row) => ({
            group: "REPORTS" as const,
            id: row.id,
            ref: row.ref,
            title: row.title,
            snippet: row.snippet,
            score: Number(row.rank),
            matchKind:
              Number(row.rank) >= EXACT_SCORE
                ? ("EXACT_REFERENCE" as const)
                : ("FULL_TEXT" as const),
            caseId: row.case_id,
            severity: null,
            updatedAt: row.updated_at,
          })),
        });
      }

      // A typed CVE or digest is an unambiguous intent; its group is floated to
      // the top so the palette's first row is the thing the user was after.
      const ordered = groups.sort((left, right) => {
        const priority = (group: SearchGroup): number => {
          if (looksLikeCve && group === "FINDINGS") {
            return 0;
          }

          if (looksLikeHash && group === "EVIDENCE") {
            return 0;
          }

          return 1;
        };

        return priority(left.group) - priority(right.group);
      });

      return {
        query: term,
        groups: ordered.filter((group) => group.hits.length > 0),
        tookMs: Date.now() - started,
      };
    },
  );
}
