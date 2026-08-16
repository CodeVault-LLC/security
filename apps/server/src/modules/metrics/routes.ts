import type { AppInstance } from "../../http/app-instance.js";
import { sql, type SQL } from "drizzle-orm";

import {
  AssetDetailMetricsResponse,
  AssetMetricsResponse,
  DISCLOSURE_STAGES,
  ErrorResponse,
  IdParam,
  MetricsQuery,
  MetricsResponse,
  type AssetFindingCount,
  type CweCount,
  type DisclosureStage,
  type MetricBucket,
  type MetricWindow,
  type SeverityTotals,
  type StageDuration,
  type TrendPoint,
} from "@codevault/contracts";
import {
  ASSET_KINDS,
  DISCLOSURE_STATES,
  PRIOR_ART_STATES,
  VALIDATION_STATES,
  type AssetKind,
  type DisclosureState,
  type PriorArtState,
  type ValidationState,
} from "@codevault/core";

import { actingUser } from "../../http/guards.js";
import { readableCaseIdsSubquery } from "../findings/queries.js";

/**
 * Metrics routes.
 *
 * Every query here is scoped through `readableCaseIdsSubquery`, the same
 * subquery the dashboard and findings modules use. That is the single property
 * this module lives or dies by: an aggregate is an information leak if it
 * counts rows the caller cannot open. A total is not less sensitive than the
 * records behind it — sometimes it is more, because it cannot be redacted.
 *
 * Distributions report current totals and ignore the window. "How many findings
 * are critical" is not a question about the last ninety days, and windowing it
 * would quietly answer a different question than the one the label asks.
 */

/** How many days each window covers. `all` is unbounded. */
const WINDOW_DAYS: Record<Exclude<MetricWindow, "all">, number> = {
  "30d": 30,
  "90d": 90,
  "365d": 365,
};

/**
 * Trend granularity per window.
 *
 * Chosen so a trend never emits more than about fifty points, which is roughly
 * where a 2px line in a dashboard-sized card stops being readable.
 */
const WINDOW_BUCKETS: Record<MetricWindow, MetricBucket> = {
  "30d": "day",
  "90d": "week",
  "365d": "week",
  all: "month",
};

/**
 * The event pairs each disclosure stage measures.
 *
 * A case missing either end is excluded from that stage rather than counted as
 * zero, which is why every stage carries its own sample size.
 */
const STAGE_EVENTS: Record<DisclosureStage, { from: string; to: string }> = {
  DISCOVERY_TO_CONTACT: { from: "DISCOVERED", to: "VENDOR_CONTACTED" },
  CONTACT_TO_ACKNOWLEDGEMENT: {
    from: "VENDOR_CONTACTED",
    to: "VENDOR_ACKNOWLEDGED",
  },
  ACKNOWLEDGEMENT_TO_FIX: {
    from: "VENDOR_ACKNOWLEDGED",
    to: "PATCH_VERIFIED",
  },
};

/**
 * Below this many cases a median is not reported on the dashboard tile.
 *
 * The tile has no room to print a sample size, and a median over two cases
 * shown without one reads as a rate.
 */
const MIN_HEADLINE_SAMPLE = 3;

const emptySeverity = (): SeverityTotals => ({
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  none: 0,
  unscored: 0,
});

/** Folds a `severity, count` result set into the totals object. */
function foldSeverity(
  rows: readonly { severity: string | null; count: number }[],
): SeverityTotals {
  const totals = emptySeverity();

  for (const row of rows) {
    const count = Number(row.count);

    switch (row.severity) {
      case "CRITICAL":
        totals.critical += count;
        break;
      case "HIGH":
        totals.high += count;
        break;
      case "MEDIUM":
        totals.medium += count;
        break;
      case "LOW":
        totals.low += count;
        break;
      case "NONE":
        totals.none += count;
        break;
      default:
        totals.unscored += count;
        break;
    }
  }

  return totals;
}

/**
 * Counts per state, in the vocabulary's own order and including zeroes.
 *
 * A state the database has never seen still appears with a count of zero. An
 * absent bar and a bar of zero mean different things, and only one of them is
 * true.
 */
function foldStates<T extends string>(
  states: readonly T[],
  rows: readonly { state: string | null; count: number }[],
): { state: T; count: number }[] {
  const counts = new Map<string, number>();

  for (const row of rows) {
    if (row.state !== null) {
      counts.set(row.state, Number(row.count));
    }
  }

  return states.map((state) => ({ state, count: counts.get(state) ?? 0 }));
}

/** The interval a window covers, or null for `all`. */
function windowInterval(window: MetricWindow): SQL | null {
  if (window === "all") {
    return null;
  }

  return sql`${`${WINDOW_DAYS[window]} days`}::interval`;
}

export async function registerMetricsRoutes(app: AppInstance): Promise<void> {
  app.get(
    "/v1/metrics",
    {
      schema: {
        querystring: MetricsQuery,
        response: { 200: MetricsResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      const scope = readableCaseIdsSubquery(user.id);
      const window = request.query.window ?? "90d";
      const bucket = WINDOW_BUCKETS[window];
      const interval = windowInterval(window);

      const severityRows = await app.db.execute<{
        severity: string | null;
        count: number;
      }>(sql`
        SELECT f.severity, count(*)::int AS count
        FROM findings f
        WHERE f.case_id IN ${scope}
        GROUP BY f.severity
      `);

      const validationRows = await app.db.execute<{
        state: string | null;
        count: number;
      }>(sql`
        SELECT f.validation_state AS state, count(*)::int AS count
        FROM findings f
        WHERE f.case_id IN ${scope}
        GROUP BY f.validation_state
      `);

      const disclosureRows = await app.db.execute<{
        state: string | null;
        count: number;
      }>(sql`
        SELECT f.disclosure_state AS state, count(*)::int AS count
        FROM findings f
        WHERE f.case_id IN ${scope}
        GROUP BY f.disclosure_state
      `);

      const priorArtRows = await app.db.execute<{
        state: string | null;
        count: number;
      }>(sql`
        SELECT f.prior_art_state AS state, count(*)::int AS count
        FROM findings f
        WHERE f.case_id IN ${scope}
        GROUP BY f.prior_art_state
      `);

      /*
       * Intake trend.
       *
       * The generated series is the left side of the join so a period with no
       * activity emits a zero rather than vanishing. A missing bucket makes a
       * line chart lie: it draws straight across the gap, turning a quiet month
       * into a gentle slope.
       */
      const trendRows = await app.db.execute<{
        bucket_start: string;
        opened: number;
        published: number;
      }>(sql`
        WITH bounds AS (
          SELECT
            ${
              interval === null
                ? sql`coalesce(
                    date_trunc(${bucket}, (SELECT min(f.created_at) FROM findings f WHERE f.case_id IN ${scope})),
                    date_trunc(${bucket}, now())
                  )`
                : sql`date_trunc(${bucket}, now() - ${interval})`
            } AS start_at,
            date_trunc(${bucket}, now()) AS end_at
        ),
        periods AS (
          SELECT generate_series(
            (SELECT start_at FROM bounds),
            (SELECT end_at FROM bounds),
            ${sql.raw(`'1 ${bucket}'::interval`)}
          ) AS bucket_start
        )
        SELECT
          p.bucket_start,
          count(DISTINCT opened.id)::int AS opened,
          count(DISTINCT published.id)::int AS published
        FROM periods p
        LEFT JOIN findings opened
          ON opened.case_id IN ${scope}
         AND date_trunc(${bucket}, opened.created_at) = p.bucket_start
        LEFT JOIN findings published
          ON published.case_id IN ${scope}
         AND published.disclosure_state = 'PUBLIC'
         AND date_trunc(${bucket}, published.updated_at) = p.bucket_start
        GROUP BY p.bucket_start
        ORDER BY p.bucket_start
      `);

      const trend: TrendPoint[] = trendRows.rows.map((row) => ({
        bucketStart: new Date(row.bucket_start).toISOString(),
        opened: Number(row.opened),
        published: Number(row.published),
      }));

      /*
       * Stage durations.
       *
       * Paired per case on the earliest occurrence of each event: a case with
       * two `VENDOR_CONTACTED` entries was contacted once and corrected once,
       * and the first is the one that started the clock.
       */
      const stages: StageDuration[] = [];

      for (const stage of DISCLOSURE_STAGES) {
        const pair = STAGE_EVENTS[stage];

        const durations = await app.db.execute<{
          p50: number | null;
          p90: number | null;
          sample: number;
        }>(sql`
          WITH paired AS (
            SELECT
              e.case_id,
              min(e.occurred_at) FILTER (WHERE e.type = ${pair.from}) AS started_at,
              min(e.occurred_at) FILTER (WHERE e.type = ${pair.to}) AS ended_at
            FROM disclosure_events e
            WHERE e.case_id IN ${scope}
            GROUP BY e.case_id
          ),
          spans AS (
            SELECT extract(epoch FROM (ended_at - started_at)) / 86400 AS days
            FROM paired
            WHERE started_at IS NOT NULL
              AND ended_at IS NOT NULL
              AND ended_at >= started_at
              ${interval === null ? sql`` : sql`AND ended_at > now() - ${interval}`}
          )
          SELECT
            percentile_cont(0.5) WITHIN GROUP (ORDER BY days) AS p50,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY days) AS p90,
            count(*)::int AS sample
          FROM spans
        `);

        const row = durations.rows[0];
        const sampleSize = Number(row?.sample ?? 0);

        stages.push({
          stage,
          p50Days: sampleSize === 0 ? null : Number(row?.p50 ?? 0),
          p90Days: sampleSize === 0 ? null : Number(row?.p90 ?? 0),
          sampleSize,
        });
      }

      /*
       * Weakness classes.
       *
       * `cwe_ids` is a JSON array, so a finding tagged with three classes counts
       * once against each. The tail past the top ten arrives as a single
       * `Other` row — a ninth and tenth colour would be indistinguishable from
       * the first eight anyway.
       */
      const cweRows = await app.db.execute<{
        cwe_id: string;
        count: number;
      }>(sql`
        SELECT cwe.value AS cwe_id, count(*)::int AS count
        FROM findings f
        CROSS JOIN LATERAL jsonb_array_elements_text(f.cwe_ids) AS cwe(value)
        WHERE f.case_id IN ${scope}
        GROUP BY cwe.value
        ORDER BY count DESC, cwe.value
      `);

      const cwe: CweCount[] = cweRows.rows
        .slice(0, 10)
        .map((row) => ({ cweId: row.cwe_id, count: Number(row.count) }));

      const tail = cweRows.rows
        .slice(10)
        .reduce((sum, row) => sum + Number(row.count), 0);

      if (tail > 0) {
        cwe.push({ cweId: "Other", count: tail });
      }

      const topAssets = await loadTopAssets(app, scope);

      const totalsRow = await app.db.execute<{
        findings: number;
        confirmed: number;
        published: number;
        criticals_unfixed: number;
      }>(sql`
        SELECT
          count(*)::int AS findings,
          count(*) FILTER (WHERE f.validation_state = 'CONFIRMED')::int AS confirmed,
          count(*) FILTER (WHERE f.disclosure_state = 'PUBLIC')::int AS published,
          count(*) FILTER (
            WHERE f.severity = 'CRITICAL'
              AND f.remediation_state NOT IN ('FIXED', 'FIX_VERIFIED', 'NOT_APPLICABLE')
          )::int AS criticals_unfixed
        FROM findings f
        WHERE f.case_id IN ${scope}
      `);

      const openCases = await app.db.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM cases c
        WHERE c.id IN ${scope} AND c.status = 'OPEN'
      `);

      const acknowledgement = stages.find(
        (stage) => stage.stage === "CONTACT_TO_ACKNOWLEDGEMENT",
      );

      const totals = totalsRow.rows[0];

      return {
        window,
        bucket,
        totals: {
          findings: Number(totals?.findings ?? 0),
          confirmed: Number(totals?.confirmed ?? 0),
          published: Number(totals?.published ?? 0),
          openCases: Number(openCases.rows[0]?.count ?? 0),
          criticalsUnfixed: Number(totals?.criticals_unfixed ?? 0),
          medianAcknowledgementDays:
            acknowledgement === undefined ||
            acknowledgement.sampleSize < MIN_HEADLINE_SAMPLE
              ? null
              : acknowledgement.p50Days,
        },
        severity: foldSeverity(severityRows.rows),
        validation: foldStates<ValidationState>(
          VALIDATION_STATES,
          validationRows.rows,
        ),
        disclosure: foldStates<DisclosureState>(
          DISCLOSURE_STATES,
          disclosureRows.rows,
        ),
        priorArt: foldStates<PriorArtState>(
          PRIOR_ART_STATES,
          priorArtRows.rows,
        ),
        trend,
        stages,
        cwe,
        topAssets,
        generatedAt: new Date().toISOString(),
      };
    },
  );

  app.get(
    "/v1/metrics/assets",
    { schema: { response: { 200: AssetMetricsResponse } } },
    async (request) => {
      const user = actingUser(request);
      const scope = readableCaseIdsSubquery(user.id);

      /*
       * Findings per asset kind.
       *
       * The asset count is unscoped because assets are workspace-wide, but the
       * finding count is scoped — otherwise the two columns would disagree
       * about which findings exist, and the one that leaked would be the count.
       */
      const kindRows = await app.db.execute<{
        kind: string;
        asset_count: number;
        finding_count: number;
      }>(sql`
        SELECT
          a.kind,
          count(DISTINCT a.id)::int AS asset_count,
          count(DISTINCT f.id)::int AS finding_count
        FROM assets a
        LEFT JOIN finding_assets fa ON fa.asset_id = a.id
        LEFT JOIN findings f ON f.id = fa.finding_id AND f.case_id IN ${scope}
        GROUP BY a.kind
      `);

      const byKindCounts = new Map(
        kindRows.rows.map((row) => [
          row.kind,
          {
            assetCount: Number(row.asset_count),
            findingCount: Number(row.finding_count),
          },
        ]),
      );

      const byKind = ASSET_KINDS.map((kind: AssetKind) => ({
        kind,
        assetCount: byKindCounts.get(kind)?.assetCount ?? 0,
        findingCount: byKindCounts.get(kind)?.findingCount ?? 0,
      }));

      const coverage = await app.db.execute<{
        total: number;
        with_identifier: number;
        with_primary: number;
      }>(sql`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE ids.any_identifier)::int AS with_identifier,
          count(*) FILTER (WHERE ids.any_primary)::int AS with_primary
        FROM assets a
        LEFT JOIN LATERAL (
          SELECT
            count(*) > 0 AS any_identifier,
            count(*) FILTER (WHERE i.primary) > 0 AS any_primary
          FROM asset_identifiers i
          WHERE i.asset_id = a.id
        ) ids ON true
      `);

      const coverageRow = coverage.rows[0];

      return {
        byKind,
        topAssets: await loadTopAssets(app, scope),
        identifierCoverage: {
          total: Number(coverageRow?.total ?? 0),
          withIdentifier: Number(coverageRow?.with_identifier ?? 0),
          withPrimary: Number(coverageRow?.with_primary ?? 0),
        },
        generatedAt: new Date().toISOString(),
      };
    },
  );

  app.get(
    "/v1/assets/:id/metrics",
    {
      schema: {
        params: IdParam,
        response: { 200: AssetDetailMetricsResponse, 404: ErrorResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      const scope = readableCaseIdsSubquery(user.id);
      const assetId = request.params.id;
      const bucket: MetricBucket = "week";

      const severityRows = await app.db.execute<{
        severity: string | null;
        count: number;
      }>(sql`
        SELECT f.severity, count(*)::int AS count
        FROM findings f
        JOIN finding_assets fa ON fa.finding_id = f.id
        WHERE fa.asset_id = ${assetId} AND f.case_id IN ${scope}
        GROUP BY f.severity
      `);

      const trendRows = await app.db.execute<{
        bucket_start: string;
        opened: number;
      }>(sql`
        WITH periods AS (
          SELECT generate_series(
            date_trunc(${bucket}, now() - '90 days'::interval),
            date_trunc(${bucket}, now()),
            '1 week'::interval
          ) AS bucket_start
        )
        SELECT p.bucket_start, count(f.id)::int AS opened
        FROM periods p
        LEFT JOIN finding_assets fa ON fa.asset_id = ${assetId}
        LEFT JOIN findings f
          ON f.id = fa.finding_id
         AND f.case_id IN ${scope}
         AND date_trunc(${bucket}, f.created_at) = p.bucket_start
        GROUP BY p.bucket_start
        ORDER BY p.bucket_start
      `);

      const ranges = await app.db.execute<{
        total: number;
        verified: number;
        inferred_unverified: number;
      }>(sql`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE ar.verified_at IS NOT NULL)::int AS verified,
          count(*) FILTER (
            WHERE ar.status = 'INFERRED_AFFECTED' AND ar.verified_at IS NULL
          )::int AS inferred_unverified
        FROM affected_ranges ar
        JOIN findings f ON f.id = ar.finding_id
        WHERE ar.asset_id = ${assetId} AND f.case_id IN ${scope}
      `);

      const severity = foldSeverity(severityRows.rows);
      const rangeRow = ranges.rows[0];

      return {
        bucket,
        total: Object.values(severity).reduce((sum, count) => sum + count, 0),
        severity,
        trend: trendRows.rows.map((row) => ({
          bucketStart: new Date(row.bucket_start).toISOString(),
          opened: Number(row.opened),
          published: 0,
        })),
        affectedRanges: {
          total: Number(rangeRow?.total ?? 0),
          verified: Number(rangeRow?.verified ?? 0),
          inferredUnverified: Number(rangeRow?.inferred_unverified ?? 0),
        },
        generatedAt: new Date().toISOString(),
      };
    },
  );
}

/**
 * The assets carrying the most findings, with their severity composition.
 *
 * Shared by the workspace and asset metrics so the two screens cannot disagree
 * about which asset is worst.
 */
async function loadTopAssets(
  app: AppInstance,
  scope: SQL,
): Promise<AssetFindingCount[]> {
  const rows = await app.db.execute<{
    asset_id: string;
    ref: string;
    name: string;
    kind: string;
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    none: number;
    unscored: number;
  }>(sql`
    SELECT
      a.id AS asset_id, a.ref, a.name, a.kind,
      count(f.id)::int AS total,
      count(*) FILTER (WHERE f.severity = 'CRITICAL')::int AS critical,
      count(*) FILTER (WHERE f.severity = 'HIGH')::int AS high,
      count(*) FILTER (WHERE f.severity = 'MEDIUM')::int AS medium,
      count(*) FILTER (WHERE f.severity = 'LOW')::int AS low,
      count(*) FILTER (WHERE f.severity = 'NONE')::int AS none,
      count(*) FILTER (WHERE f.severity IS NULL)::int AS unscored
    FROM assets a
    JOIN finding_assets fa ON fa.asset_id = a.id
    JOIN findings f ON f.id = fa.finding_id
    WHERE f.case_id IN ${scope}
    GROUP BY a.id, a.ref, a.name, a.kind
    HAVING count(f.id) > 0
    ORDER BY count(f.id) DESC, a.name
    LIMIT 10
  `);

  return rows.rows.map((row) => ({
    assetId: row.asset_id,
    ref: row.ref,
    name: row.name,
    kind: row.kind as AssetKind,
    total: Number(row.total),
    severity: {
      critical: Number(row.critical),
      high: Number(row.high),
      medium: Number(row.medium),
      low: Number(row.low),
      none: Number(row.none),
      unscored: Number(row.unscored),
    },
  }));
}
