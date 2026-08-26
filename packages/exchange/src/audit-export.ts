import type { AuditEvent } from "@codevault/contracts";

const AUDIT_COLUMNS = [
  "event_id",
  "occurred_at",
  "action",
  "actor_name",
  "actor_email",
  "entity_type",
  "entity_id",
  "case_id",
  "request_id",
  "session_id",
  "ai_run_id",
  "before",
  "after",
] as const;

/**
 * Produce an RFC 4180 CSV projection of an immutable audit event set.
 *
 * Object keys are recursively sorted to keep exports byte-stable. Every cell
 * is guarded against spreadsheet formula interpretation because actor and
 * entity metadata can contain user-controlled text.
 */
export function exportAuditEventsCsv(events: readonly AuditEvent[]): string {
  const rows = events.map((event) =>
    [
      event.id,
      event.occurredAt,
      event.action,
      event.actor?.displayName ?? "system",
      event.actor?.email ?? "",
      event.entityType,
      event.entityId ?? "",
      event.caseId ?? "",
      event.requestId ?? "",
      event.sessionId ?? "",
      event.aiRunId ?? "",
      canonicalJson(event.before),
      canonicalJson(event.after),
    ]
      .map(csvCell)
      .join(","),
  );

  return `${AUDIT_COLUMNS.join(",")}\r\n${rows.join("\r\n")}${
    rows.length === 0 ? "" : "\r\n"
  }`;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "";
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonValue(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, item]) => `${JSON.stringify(key)}:${canonicalJsonValue(item)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalJsonValue(value: unknown): string {
  const encoded = canonicalJson(value);
  return value === null ? "null" : encoded;
}

function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  return /[",\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
