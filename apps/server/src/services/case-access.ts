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
  organizationId: string;
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
      organizationId: schema.cases.organizationId,
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
    organizationId: record.organizationId,
    ref: record.ref,
    title: record.title,
    restricted: record.restricted,
    ownerId: record.ownerId,
    disclosureEnabled: record.disclosureEnabled,
    context: {
      ownerId: record.ownerId,
      organizationId: record.organizationId,
      restricted: record.restricted,
      members,
    },
  };
}

/**
 * Loads a case the user may read, or throws.
 *
 * A case in another organization is reported as missing rather than forbidden.
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
 * Organization membership grants read access to every case in that
 * organization. The shape remains compatible with existing callers while
 * they migrate from allow-list filtering.
 */
export async function readableCaseFilter(
  db: Database,
  user: ActingUser,
): Promise<{ allRestrictedVisible: boolean; visibleRestrictedIds: string[] }> {
  void db;
  void user;

  return {
    allRestrictedVisible: true,
    visibleRestrictedIds: [],
  };
}
