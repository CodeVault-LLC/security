import type { Database } from "@codevault/db";
import { schema } from "@codevault/db";
import { eq } from "drizzle-orm";

/**
 * Audit writer.
 *
 * Audit rows are inserted in the same transaction as the change they describe,
 * so an audited mutation either happens with its record or not at all. The
 * table itself rejects UPDATE and DELETE, so history cannot be edited later.
 */

export interface AuditContext {
  organizationId?: string;
  actorId: string | null;
  sessionId: string | null;
  requestId: string | null;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string | null;
  caseId?: string | null;
  aiRunId?: string | null;
  /** Changed fields only. Whole-record snapshots are deliberately avoided. */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export interface AuditWriter {
  write(db: Database, context: AuditContext, entry: AuditEntry): Promise<void>;
}

/**
 * Fields that must never reach the audit log even as a "changed field".
 *
 * A state change is worth recording; the secret that changed is not.
 */
const REDACTED_FIELDS = new Set([
  "accesstoken",
  "armoredkey",
  "authorization",
  "bodymarkdown",
  "bodytext",
  "clientsecret",
  "ciphertext",
  "cookie",
  "coordinationnotes",
  "manifest",
  "manualfields",
  "mimeraw",
  "oauthcode",
  "passphrase",
  "password",
  "passwordhash",
  "privatekey",
  "rawbody",
  "refreshtoken",
  "secret",
  "secretaccesskey",
  "setcookie",
  "subject",
  "token",
  "tokenhash",
]);

function normalizedFieldName(field: string): string {
  return field.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/g, "");
}

function redactAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactAuditValue);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  const result: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    result[key] = REDACTED_FIELDS.has(normalizedFieldName(key))
      ? "[redacted]"
      : redactAuditValue(nestedValue);
  }

  return result;
}

export function redactAuditPayload(
  payload: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (payload === null || payload === undefined) {
    return null;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    result[key] = REDACTED_FIELDS.has(normalizedFieldName(key))
      ? "[redacted]"
      : redactAuditValue(value);
  }

  return result;
}

export function createAuditWriter(): AuditWriter {
  return {
    async write(db, context, entry) {
      let organizationId = context.organizationId;

      if (
        organizationId === undefined &&
        entry.caseId !== undefined &&
        entry.caseId !== null
      ) {
        const [researchCase] = await db
          .select({ organizationId: schema.cases.organizationId })
          .from(schema.cases)
          .where(eq(schema.cases.id, entry.caseId))
          .limit(1);
        organizationId = researchCase?.organizationId;
      }

      if (organizationId === undefined && context.actorId !== null) {
        const [membership] = await db
          .select({
            organizationId: schema.organizationMemberships.organizationId,
          })
          .from(schema.organizationMemberships)
          .where(eq(schema.organizationMemberships.userId, context.actorId))
          .limit(1);
        organizationId = membership?.organizationId;
      }

      if (organizationId === undefined) {
        const [organization] = await db
          .select({ id: schema.organizations.id })
          .from(schema.organizations)
          .limit(1);
        organizationId = organization?.id;
      }

      // Before first bootstrap there is no security boundary to own an event.
      if (organizationId === undefined) {
        return;
      }

      await db.insert(schema.auditEvents).values({
        organizationId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        caseId: entry.caseId ?? null,
        actorId: context.actorId,
        sessionId: context.sessionId,
        requestId: context.requestId,
        aiRunId: entry.aiRunId ?? null,
        before: redactAuditPayload(entry.before),
        after: redactAuditPayload(entry.after),
      });
    },
  };
}

/** Computes the changed-field pair for an update, ignoring untouched fields. */
export function diffForAudit<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};

  for (const [key, nextValue] of Object.entries(after)) {
    if (nextValue === undefined) {
      continue;
    }

    const previousValue = before[key];

    if (Object.is(previousValue, nextValue)) {
      continue;
    }

    changedBefore[key] = previousValue;
    changedAfter[key] = nextValue;
  }

  return { before: changedBefore, after: changedAfter };
}
