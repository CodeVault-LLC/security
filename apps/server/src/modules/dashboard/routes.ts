import type { AppInstance } from "../../http/app-instance.js";
import { sql } from "drizzle-orm";

import {
  DashboardResponse,
  ListAuditQuery,
  AuditEvent,
  PaginatedResponse,
  type AttentionItem,
  type ChangeItem,
} from "@codevault/contracts";

import { actingUser } from "../../http/guards.js";
import { decodeCursor, pageSize, paginate } from "../../http/pagination.js";
import { readableCaseIdsSubquery } from "../findings/queries.js";

/**
 * Dashboard and activity routes.
 *
 * The dashboard answers "what needs me?" and "what moved?". Severity totals are
 * computed too, but they are a small secondary widget: a count of criticals
 * tells a researcher nothing they can act on this morning.
 */

const AuditListResponse = PaginatedResponse(AuditEvent);

/** How far ahead a date starts appearing in Needs Attention. */
const ATTENTION_WINDOW_DAYS = 14;

/** How far back What Changed looks. */
const CHANGE_WINDOW_DAYS = 14;

export async function registerDashboardRoutes(app: AppInstance): Promise<void> {
  app.get(
    "/v1/dashboard",
    { schema: { response: { 200: DashboardResponse } } },
    async (request) => {
      const user = actingUser(request);
      const scope = readableCaseIdsSubquery(user.id);
      const attention: AttentionItem[] = [];

      const disclosureDue = await app.db.execute<{
        case_id: string;
        ref: string;
        title: string;
        planned_disclosure_at: string | null;
        expected_response_at: string | null;
      }>(sql`
        SELECT c.id AS case_id, c.ref, c.title,
               e.planned_disclosure_at, e.expected_response_at
        FROM embargoes e
        JOIN cases c ON c.id = e.case_id
        WHERE c.id IN ${scope}
          AND c.status = 'OPEN'
          AND (
            (e.expected_response_at IS NOT NULL
              AND e.expected_response_at <= now() + ${`${ATTENTION_WINDOW_DAYS} days`}::interval)
            OR (e.planned_disclosure_at IS NOT NULL
              AND e.planned_disclosure_at <= now() + ${`${ATTENTION_WINDOW_DAYS} days`}::interval)
          )
      `);

      for (const row of disclosureDue.rows) {
        if (row.expected_response_at !== null) {
          attention.push({
            kind: "VENDOR_RESPONSE_DUE",
            entityType: "case",
            entityId: row.case_id,
            ref: row.ref,
            title: row.title,
            detail: "The expected vendor response date is due.",
            dueAt: row.expected_response_at,
            severity: null,
            caseId: row.case_id,
          });
        }

        if (row.planned_disclosure_at !== null) {
          attention.push({
            kind: "DISCLOSURE_DATE_APPROACHING",
            entityType: "case",
            entityId: row.case_id,
            ref: row.ref,
            title: row.title,
            detail: "The planned disclosure date is approaching.",
            dueAt: row.planned_disclosure_at,
            severity: null,
            caseId: row.case_id,
          });
        }
      }

      const criticalPrivate = await app.db.execute<{
        id: string;
        ref: string;
        title: string;
        case_id: string;
        severity: string;
      }>(sql`
        SELECT f.id, f.ref, f.title, f.case_id, f.severity
        FROM findings f
        WHERE f.case_id IN ${scope}
          AND f.severity IN ('CRITICAL', 'HIGH')
          AND f.disclosure_state = 'PRIVATE'
          AND f.validation_state IN ('REPRODUCED', 'PEER_REVIEWED', 'CONFIRMED')
        ORDER BY f.severity DESC, f.updated_at DESC
        LIMIT 20
      `);

      for (const row of criticalPrivate.rows) {
        attention.push({
          kind: "CRITICAL_PRIVATE_FINDING",
          entityType: "finding",
          entityId: row.id,
          ref: row.ref,
          title: row.title,
          detail:
            "Confirmed and severe, but the vendor has not been contacted.",
          dueAt: null,
          severity: row.severity as AttentionItem["severity"],
          caseId: row.case_id,
        });
      }

      const awaitingReview = await app.db.execute<{
        id: string;
        ref: string;
        title: string;
        case_id: string;
        severity: string | null;
      }>(sql`
        SELECT f.id, f.ref, f.title, f.case_id, f.severity
        FROM findings f
        WHERE f.case_id IN ${scope}
          AND f.validation_state = 'REPRODUCED'
        ORDER BY f.updated_at DESC
        LIMIT 20
      `);

      for (const row of awaitingReview.rows) {
        attention.push({
          kind: "AWAITING_PEER_REVIEW",
          entityType: "finding",
          entityId: row.id,
          ref: row.ref,
          title: row.title,
          detail: "Reproduced, waiting for a second pair of eyes.",
          dueAt: null,
          severity: row.severity as AttentionItem["severity"],
          caseId: row.case_id,
        });
      }

      const reportsWaiting = await app.db.execute<{
        id: string;
        ref: string;
        title: string;
        case_id: string;
      }>(sql`
        SELECT r.id, r.ref, r.title, r.case_id
        FROM reports r
        WHERE r.case_id IN ${scope}
          AND r.status = 'IN_REVIEW'
        ORDER BY r.updated_at DESC
        LIMIT 20
      `);

      for (const row of reportsWaiting.rows) {
        attention.push({
          kind: "REPORT_AWAITING_APPROVAL",
          entityType: "report",
          entityId: row.id,
          ref: row.ref,
          title: row.title,
          detail: "Every required section is written and review is pending.",
          dueAt: null,
          severity: null,
          caseId: row.case_id,
        });
      }

      const staleVersions = await app.db.execute<{
        id: string;
        ref: string;
        title: string;
        case_id: string;
      }>(sql`
        SELECT DISTINCT f.id, f.ref, f.title, f.case_id
        FROM findings f
        JOIN affected_ranges ar ON ar.finding_id = f.id
        WHERE f.case_id IN ${scope}
          AND ar.status = 'INFERRED_AFFECTED'
          AND ar.verified_at IS NULL
        LIMIT 20
      `);

      for (const row of staleVersions.rows) {
        attention.push({
          kind: "STALE_AFFECTED_VERSIONS",
          entityType: "finding",
          entityId: row.id,
          ref: row.ref,
          title: row.title,
          detail: "An affected-version range is inferred but never verified.",
          dueAt: null,
          severity: null,
          caseId: row.case_id,
        });
      }

      const unchecked = await app.db.execute<{
        id: string;
        ref: string;
        title: string;
        case_id: string;
        severity: string | null;
      }>(sql`
        SELECT f.id, f.ref, f.title, f.case_id, f.severity
        FROM findings f
        WHERE f.case_id IN ${scope}
          AND f.prior_art_state = 'UNCHECKED'
          AND f.validation_state <> 'DRAFT'
        ORDER BY f.updated_at DESC
        LIMIT 20
      `);

      for (const row of unchecked.rows) {
        attention.push({
          kind: "PRIOR_ART_NOT_RUN",
          entityType: "finding",
          entityId: row.id,
          ref: row.ref,
          title: row.title,
          detail: "Nobody has checked whether this is already known.",
          dueAt: null,
          severity: row.severity as AttentionItem["severity"],
          caseId: row.case_id,
        });
      }

      const failedChecks = await app.db.execute<{
        id: string;
        ref: string;
        title: string;
        case_id: string;
        failure_reason: string | null;
      }>(sql`
        SELECT pac.id, f.ref, f.title, f.case_id, pac.failure_reason
        FROM prior_art_checks pac
        JOIN findings f ON f.id = pac.finding_id
        WHERE f.case_id IN ${scope}
          AND pac.status = 'FAILED'
          AND pac.created_at > now() - ${`${CHANGE_WINDOW_DAYS} days`}::interval
        LIMIT 20
      `);

      for (const row of failedChecks.rows) {
        attention.push({
          kind: "FAILED_BACKGROUND_JOB",
          entityType: "prior_art_check",
          entityId: row.id,
          ref: row.ref,
          title: `Prior-art check failed: ${row.title}`,
          detail: row.failure_reason,
          dueAt: null,
          severity: null,
          caseId: row.case_id,
        });
      }

      const pendingProposals = await app.db.execute<{
        id: string;
        ref: string;
        title: string;
        case_id: string;
        pending: number;
      }>(sql`
        SELECT f.id, f.ref, f.title, f.case_id, count(p.id)::int AS pending
        FROM ai_proposals p
        JOIN ai_runs r ON r.id = p.run_id
        JOIN findings f ON f.id = r.target_id
        WHERE f.case_id IN ${scope} AND p.status = 'PENDING'
        GROUP BY f.id, f.ref, f.title, f.case_id
        LIMIT 20
      `);

      for (const row of pendingProposals.rows) {
        attention.push({
          kind: "PENDING_AI_PROPOSALS",
          entityType: "finding",
          entityId: row.id,
          ref: row.ref,
          title: row.title,
          detail: `${row.pending} AI proposal(s) waiting for review.`,
          dueAt: null,
          severity: null,
          caseId: row.case_id,
        });
      }

      const changes = await app.db.execute<{
        action: string;
        entity_type: string;
        entity_id: string | null;
        case_id: string | null;
        created_at: string;
        actor_id: string | null;
        actor_name: string | null;
        actor_email: string | null;
        ref: string | null;
        title: string | null;
      }>(sql`
        SELECT a.action, a.entity_type, a.entity_id, a.case_id, a.created_at,
               u.id AS actor_id, u.display_name AS actor_name, u.email AS actor_email,
               coalesce(f.ref, c.ref, r.ref) AS ref,
               coalesce(f.title, c.title, r.title) AS title
        FROM audit_events a
        LEFT JOIN users u ON u.id = a.actor_id
        LEFT JOIN findings f ON a.entity_type = 'finding' AND f.id::text = a.entity_id
        LEFT JOIN cases c ON a.entity_type = 'case' AND c.id::text = a.entity_id
        LEFT JOIN reports r ON a.entity_type = 'report' AND r.id::text = a.entity_id
        WHERE a.case_id IN ${scope}
          AND a.created_at > now() - ${`${CHANGE_WINDOW_DAYS} days`}::interval
          AND a.action IN (
            'finding.created', 'finding.state_changed', 'disclosure.event_recorded',
            'finding.identifier_added', 'report.approved', 'report.export_requested',
            'score.approved'
          )
        ORDER BY a.created_at DESC
        LIMIT 40
      `);

      const whatChanged: ChangeItem[] = changes.rows.map((row) => ({
        kind: changeKindFor(row.action),
        entityType: row.entity_type,
        entityId: row.entity_id ?? row.case_id ?? "",
        ref: row.ref ?? "—",
        title: row.title ?? describeAction(row.action),
        detail: describeAction(row.action),
        actor:
          row.actor_id === null ||
          row.actor_name === null ||
          row.actor_email === null
            ? null
            : {
                id: row.actor_id,
                displayName: row.actor_name,
                email: row.actor_email,
              },
        occurredAt: row.created_at,
        caseId: row.case_id,
      }));

      const totals = await app.db.execute<{
        severity: string | null;
        count: number;
      }>(sql`
        SELECT f.severity, count(*)::int AS count
        FROM findings f
        WHERE f.case_id IN ${scope}
        GROUP BY f.severity
      `);

      const severityTotals = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        none: 0,
        unscored: 0,
      };

      for (const row of totals.rows) {
        const count = Number(row.count);

        if (row.severity === "CRITICAL") {
          severityTotals.critical = count;
        } else if (row.severity === "HIGH") {
          severityTotals.high = count;
        } else if (row.severity === "MEDIUM") {
          severityTotals.medium = count;
        } else if (row.severity === "LOW") {
          severityTotals.low = count;
        } else if (row.severity === "NONE") {
          severityTotals.none = count;
        } else {
          severityTotals.unscored = count;
        }
      }

      const openCases = await app.db.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM cases c
        WHERE c.id IN ${scope} AND c.status = 'OPEN'
      `);

      return {
        needsAttention: attention,
        whatChanged,
        severityTotals,
        openCaseCount: Number(openCases.rows[0]?.count ?? 0),
        generatedAt: new Date().toISOString(),
      };
    },
  );

  app.get(
    "/v1/activity",
    {
      schema: {
        querystring: ListAuditQuery,
        response: { 200: AuditListResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      const size = pageSize(request.query.limit);
      const cursor = decodeCursor(request.query.cursor);
      const scope = readableCaseIdsSubquery(user.id);

      const rows = await app.db.execute<{
        id: string;
        action: string;
        entity_type: string;
        entity_id: string | null;
        case_id: string | null;
        session_id: string | null;
        request_id: string | null;
        ai_run_id: string | null;
        before: Record<string, unknown> | null;
        after: Record<string, unknown> | null;
        created_at: string;
        actor_id: string | null;
        actor_name: string | null;
        actor_email: string | null;
      }>(sql`
        SELECT a.*, u.id AS actor_id, u.display_name AS actor_name, u.email AS actor_email
        FROM audit_events a
        LEFT JOIN users u ON u.id = a.actor_id
        WHERE (a.case_id IS NULL OR a.case_id IN ${scope})
          ${request.query.caseId === undefined ? sql`` : sql`AND a.case_id = ${request.query.caseId}`}
          ${request.query.entityType === undefined ? sql`` : sql`AND a.entity_type = ${request.query.entityType}`}
          ${request.query.entityId === undefined ? sql`` : sql`AND a.entity_id = ${request.query.entityId}`}
          ${request.query.actorId === undefined ? sql`` : sql`AND a.actor_id = ${request.query.actorId}`}
          ${request.query.action === undefined ? sql`` : sql`AND a.action = ${request.query.action}`}
          ${
            cursor === null
              ? sql``
              : sql`AND (a.created_at < ${cursor.timestamp}
                     OR (a.created_at = ${cursor.timestamp} AND a.id < ${cursor.id}))`
          }
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${size + 1}
      `);

      const page = paginate(
        rows.rows.map((row) => ({ ...row, id: row.id })),
        size,
        (row) => row.created_at,
      );

      return {
        items: page.items.map((row) => ({
          id: row.id,
          action: row.action,
          entityType: row.entity_type,
          entityId: row.entity_id,
          caseId: row.case_id,
          actor:
            row.actor_id === null ||
            row.actor_name === null ||
            row.actor_email === null
              ? null
              : {
                  id: row.actor_id,
                  displayName: row.actor_name,
                  email: row.actor_email,
                },
          sessionId: row.session_id,
          requestId: row.request_id,
          aiRunId: row.ai_run_id,
          before: row.before,
          after: row.after,
          occurredAt: row.created_at,
        })),
        nextCursor: page.nextCursor,
      };
    },
  );
}

function changeKindFor(action: string): ChangeItem["kind"] {
  if (action === "finding.created") {
    return "NEW_FINDING";
  }

  if (action === "finding.state_changed") {
    return "REMEDIATION_CHANGED";
  }

  if (action === "finding.identifier_added") {
    return "CVE_ASSIGNED";
  }

  if (action === "report.approved") {
    return "REPORT_APPROVED";
  }

  if (action === "report.export_requested") {
    return "REPORT_EXPORTED";
  }

  if (action === "disclosure.event_recorded") {
    return "VENDOR_ACKNOWLEDGED";
  }

  return "INTELLIGENCE_UPDATED";
}

function describeAction(action: string): string {
  const descriptions: Record<string, string> = {
    "finding.created": "A finding was created.",
    "finding.state_changed": "A finding's state changed.",
    "finding.identifier_added": "An external identifier was recorded.",
    "score.approved": "A score was approved.",
    "report.approved": "A report was approved.",
    "report.export_requested": "A report export was requested.",
    "disclosure.event_recorded": "A disclosure event was recorded.",
  };

  return descriptions[action] ?? action;
}
