import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth.js";
import { createdAt, primaryId } from "./columns.js";

/**
 * Audit log.
 *
 * Append-only by database grant, not merely by convention: the application role
 * is granted INSERT and SELECT on this table and nothing else, so there is no
 * code path — including a compromised one — that can rewrite history through
 * the normal API.
 */

export const auditEvents = pgTable(
  "audit_events",
  {
    id: primaryId(),
    /** Dotted action such as `finding.state_changed` or `report.exported`. */
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    caseId: uuid("case_id"),
    actorId: uuid("actor_id").references(() => users.id),
    sessionId: uuid("session_id"),
    requestId: text("request_id"),
    aiRunId: uuid("ai_run_id"),
    /** Changed fields only; whole-record snapshots are deliberately avoided. */
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    after: jsonb("after").$type<Record<string, unknown> | null>(),
    occurredAt: createdAt(),
  },
  (table) => [
    index("audit_events_entity_idx").on(
      table.entityType,
      table.entityId,
      table.occurredAt,
    ),
    index("audit_events_case_idx").on(table.caseId, table.occurredAt),
    index("audit_events_actor_idx").on(table.actorId, table.occurredAt),
    index("audit_events_action_idx").on(table.action, table.occurredAt),
  ],
);

export type AuditEventRow = typeof auditEvents.$inferSelect;
export type NewAuditEventRow = typeof auditEvents.$inferInsert;
