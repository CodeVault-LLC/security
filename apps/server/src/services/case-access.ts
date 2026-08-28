import { eq } from "drizzle-orm";

import {
  canApproveCase,
  canDiscloseCase,
  canReadCase,
  canWriteCase,
  notFound,
  permissionDenied,
  type ActingUser,
  type CaseCapability,
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
      canWrite: schema.caseMembers.canWrite,
      canApprove: schema.caseMembers.canApprove,
      canDisclose: schema.caseMembers.canDisclose,
    })
    .from(schema.caseMembers)
    .where(eq(schema.caseMembers.caseId, caseId));

  const members = new Map<string, ReadonlySet<CaseCapability>>(
    memberRows.map((row) => {
      const capabilities = new Set<CaseCapability>(["READ"]);

      if (row.canWrite) capabilities.add("WRITE");
      if (row.canApprove) capabilities.add("APPROVAL");
      if (row.canDisclose) capabilities.add("DISCLOSURE");

      return [row.userId, capabilities];
    }),
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

export async function requireCaseApproval(
  db: Database,
  user: ActingUser,
  caseId: string,
): Promise<CaseAccessRecord> {
  const record = await requireCaseRead(db, user, caseId);

  if (!canApproveCase(user, record.context)) {
    throw permissionDenied("You do not have approval access to this case.");
  }

  return record;
}

export async function requireCaseDisclosure(
  db: Database,
  user: ActingUser,
  caseId: string,
): Promise<CaseAccessRecord> {
  const record = await requireCaseRead(db, user, caseId);

  if (!canDiscloseCase(user, record.context)) {
    throw permissionDenied("You do not have disclosure access to this case.");
  }

  return record;
}

/**
 * Compatibility helper for callers that need an in-memory restricted-case
 * filter. All cases now require explicit read clearance.
 */
export async function readableCaseFilter(
  db: Database,
  user: ActingUser,
): Promise<{ allRestrictedVisible: boolean; visibleRestrictedIds: string[] }> {
  const [memberRows, ownerRows] = await Promise.all([
    db
      .select({ caseId: schema.caseMembers.caseId })
      .from(schema.caseMembers)
      .where(eq(schema.caseMembers.userId, user.id)),
    db
      .select({ caseId: schema.cases.id })
      .from(schema.cases)
      .where(eq(schema.cases.ownerId, user.id)),
  ]);

  return {
    allRestrictedVisible: false,
    visibleRestrictedIds: [
      ...new Set([...memberRows, ...ownerRows].map((row) => row.caseId)),
    ],
  };
}
