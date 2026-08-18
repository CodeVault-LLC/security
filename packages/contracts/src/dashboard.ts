import { Type, type Static } from "@sinclair/typebox";

import {
  ActorSummary,
  enumOf,
  HumanReference,
  PaginationQuery,
  SeveritySchema,
  Timestamp,
  Uuid,
} from "./common.js";

/**
 * Dashboard and activity contracts.
 *
 * The dashboard answers "what needs me?" and "what moved?". Severity totals are
 * available, but as a small secondary widget rather than the point of the page.
 */

export const ATTENTION_ITEM_KINDS = [
  "VENDOR_RESPONSE_DUE",
  "DISCLOSURE_DATE_APPROACHING",
  "CRITICAL_PRIVATE_FINDING",
  "AWAITING_PEER_REVIEW",
  "REPORT_AWAITING_APPROVAL",
  "STALE_AFFECTED_VERSIONS",
  "PRIOR_ART_NOT_RUN",
  "FAILED_BACKGROUND_JOB",
  "PENDING_AI_PROPOSALS",
  "SUBMISSION_NEEDS_REVIEW",
  "VENDOR_REPLY_NEEDS_REVIEW",
  "VENDOR_INFORMATION_REQUEST_PENDING",
  "VENDOR_ACKNOWLEDGEMENT_OVERDUE",
  "VENDOR_UPDATE_OVERDUE",
  "GMAIL_RECONNECT_REQUIRED",
  "SUBMISSION_SEND_FAILED",
] as const;

export type AttentionItemKind = (typeof ATTENTION_ITEM_KINDS)[number];

export const AttentionItem = Type.Object({
  kind: enumOf(ATTENTION_ITEM_KINDS),
  entityType: Type.String({ maxLength: 40 }),
  entityId: Uuid,
  ref: HumanReference,
  title: Type.String(),
  detail: Type.Union([Type.String(), Type.Null()]),
  dueAt: Type.Union([Timestamp, Type.Null()]),
  severity: Type.Union([SeveritySchema, Type.Null()]),
  caseId: Type.Union([Uuid, Type.Null()]),
});

export type AttentionItem = Static<typeof AttentionItem>;

export const CHANGE_ITEM_KINDS = [
  "NEW_FINDING",
  "REMEDIATION_CHANGED",
  "VENDOR_ACKNOWLEDGED",
  "PATCH_VERIFIED",
  "CVE_ASSIGNED",
  "INTELLIGENCE_UPDATED",
  "REPORT_APPROVED",
  "REPORT_EXPORTED",
] as const;

export const ChangeItem = Type.Object({
  kind: enumOf(CHANGE_ITEM_KINDS),
  entityType: Type.String({ maxLength: 40 }),
  entityId: Uuid,
  ref: HumanReference,
  title: Type.String(),
  detail: Type.Union([Type.String(), Type.Null()]),
  actor: Type.Union([ActorSummary, Type.Null()]),
  occurredAt: Timestamp,
  caseId: Type.Union([Uuid, Type.Null()]),
});

export type ChangeItem = Static<typeof ChangeItem>;

export const DashboardResponse = Type.Object({
  needsAttention: Type.Array(AttentionItem),
  whatChanged: Type.Array(ChangeItem),
  /** Compact secondary widget; deliberately not the headline. */
  severityTotals: Type.Object({
    critical: Type.Integer({ minimum: 0 }),
    high: Type.Integer({ minimum: 0 }),
    medium: Type.Integer({ minimum: 0 }),
    low: Type.Integer({ minimum: 0 }),
    none: Type.Integer({ minimum: 0 }),
    unscored: Type.Integer({ minimum: 0 }),
  }),
  openCaseCount: Type.Integer({ minimum: 0 }),
  generatedAt: Timestamp,
});

export type DashboardResponse = Static<typeof DashboardResponse>;

export const AuditEvent = Type.Object({
  id: Uuid,
  action: Type.String({ maxLength: 80 }),
  entityType: Type.String({ maxLength: 40 }),
  entityId: Type.Union([Type.String({ maxLength: 100 }), Type.Null()]),
  caseId: Type.Union([Uuid, Type.Null()]),
  actor: Type.Union([ActorSummary, Type.Null()]),
  sessionId: Type.Union([Uuid, Type.Null()]),
  requestId: Type.Union([Type.String(), Type.Null()]),
  aiRunId: Type.Union([Uuid, Type.Null()]),
  /** Changed fields only; full snapshots are kept out of the audit log. */
  before: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  after: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  occurredAt: Timestamp,
});

export type AuditEvent = Static<typeof AuditEvent>;

export const ListAuditQuery = Type.Object({
  ...PaginationQuery.properties,
  caseId: Type.Optional(Uuid),
  entityType: Type.Optional(Type.String({ maxLength: 40 })),
  entityId: Type.Optional(Type.String({ maxLength: 100 })),
  actorId: Type.Optional(Uuid),
  action: Type.Optional(Type.String({ maxLength: 80 })),
});

export type ListAuditQuery = Static<typeof ListAuditQuery>;
