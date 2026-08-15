import { eq } from "drizzle-orm";

import {
  canReadCase,
  canWriteCase,
  notFound,
  permissionDenied,
  type ActingUser,
  type CaseAccess,
  type CaseAccessContext,
} from "@codevault/core";
import type { Database } from "@codevault/db";
import { schema } from "@codevault/db";

/**
 * Case authorization.
 *
 * Every route that touches case-scoped data goes through here. Loading the
 * access context and evaluating it are separate steps so the rules stay pure
 * and testable, and so a caller cannot accidentally check a context it built
 * from client-supplied values.
 */

export interface CaseAccessRecord {
  caseId: string;
  ref: string;
  title: string;
  restricted: boolean;
  ownerId: string;
  disclosureEnabled: boolean;
  context: CaseAccessContext;
}

export async function loadCaseAccess(
  db: Database,
  caseId: string,
): Promise<CaseAccessRecord | null> {
  const rows = await db
    .select({
      id: schema.cases.id,
      ref: schema.cases.ref,
      title: schema.cases.title,
      ownerId: schema.cases.ownerId,
      restricted: schema.cases.restricted,
      disclosureEnabled: schema.cases.disclosureEnabled,
    })
    .from(schema.cases)
    .where(eq(schema.cases.id, caseId))
    .limit(1);

  const record = rows[0];

  if (record === undefined) {
    return null;
  }

  const memberRows = await db
    .select({
      userId: schema.caseMembers.userId,
      access: schema.caseMembers.access,
    })
    .from(schema.caseMembers)
    .where(eq(schema.caseMembers.caseId, caseId));

  const members = new Map<string, CaseAccess>(
    memberRows.map((row) => [row.userId, row.access]),
  );

  return {
    caseId: record.id,
    ref: record.ref,
    title: record.title,
    restricted: record.restricted,
    ownerId: record.ownerId,
    disclosureEnabled: record.disclosureEnabled,
    context: {
      ownerId: record.ownerId,
      restricted: record.restricted,
      members,
    },
  };
}

/**
 * Loads a case the user may read, or throws.
 *
 * A case the caller cannot see is reported as missing rather than forbidden:
 * confirming that `CASE-2026-0004` exists is itself a disclosure when the case
 * is an embargoed zero-day.
 */
export async function requireCaseRead(
  db: Database,
  user: ActingUser,
  caseId: string,
): Promise<CaseAccessRecord> {
  const record = await loadCaseAccess(db, caseId);

  if (record === null || !canReadCase(user, record.context)) {
    throw notFound("Case");
  }

  return record;
}

export async function requireCaseWrite(
  db: Database,
  user: ActingUser,
  caseId: string,
): Promise<CaseAccessRecord> {
  const record = await requireCaseRead(db, user, caseId);

  if (!canWriteCase(user, record.context)) {
    throw permissionDenied("You have read-only access to this case.");
  }

  return record;
}

/**
 * The set of case IDs a user may read.
 *
 * Used by list and search queries. Unrestricted cases are visible to everyone,
 * so the filter only has to enumerate the restricted ones the user is on.
 */
export async function readableCaseFilter(
  db: Database,
  user: ActingUser,
): Promise<{ allRestrictedVisible: boolean; visibleRestrictedIds: string[] }> {
  const memberships = await db
    .select({ caseId: schema.caseMembers.caseId })
    .from(schema.caseMembers)
    .where(eq(schema.caseMembers.userId, user.id));

  const owned = await db
    .select({ id: schema.cases.id })
    .from(schema.cases)
    .where(eq(schema.cases.ownerId, user.id));

  const visible = new Set<string>([
    ...memberships.map((row) => row.caseId),
    ...owned.map((row) => row.id),
  ]);

  return {
    // No role grants blanket access to restricted cases, administrators
    // included; the allow-list is the whole point of the flag.
    allRestrictedVisible: false,
    visibleRestrictedIds: [...visible],
  };
}
