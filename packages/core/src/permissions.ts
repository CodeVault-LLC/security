import {
  canAdministerOrganization,
  type OrganizationActor,
} from "./organization.js";

/**
 * Authorization rules.
 *
 * These functions are pure so they can be exhaustively tested, and they are
 * called on the server only. The desktop client may use them to hide controls,
 * but hiding a button is never the enforcement point.
 */

export const USER_ROLES = ["ADMIN", "MEMBER", "VIEWER"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const CASE_CAPABILITIES = [
  "READ",
  "WRITE",
  "APPROVAL",
  "DISCLOSURE",
] as const;

export type CaseCapability = (typeof CASE_CAPABILITIES)[number];

export interface ActingUser extends OrganizationActor {
  /** Compatibility alias for case ownership columns. */
  id: string;
}

export interface CaseAccessContext {
  /** Case owner, who retains every case capability subject to global role policy. */
  ownerId: string;
  /** The organization that owns the case. */
  organizationId: string;
  /** Presentation metadata only; every case requires an explicit grant. */
  restricted: boolean;
  /** Explicit capability grants, keyed by user ID. */
  members: ReadonlyMap<string, ReadonlySet<CaseCapability>>;
}

export function isActive(user: ActingUser): boolean {
  return !user.disabled;
}

export function isAdmin(user: ActingUser): boolean {
  return isActive(user) && user.role === "ADMIN";
}

/** Global capability to author research data, before per-case rules apply. */
export function canWriteAnything(user: ActingUser): boolean {
  if (!isActive(user)) {
    return false;
  }

  return user.role === "ADMIN" || user.role === "MEMBER";
}

export function canReadCase(
  user: ActingUser,
  context: CaseAccessContext,
): boolean {
  if (!isActive(user) || user.organizationId !== context.organizationId) {
    return false;
  }

  if (user.id === context.ownerId) {
    return true;
  }

  return context.members.get(user.id)?.has("READ") ?? false;
}

function canPerformCaseAction(
  user: ActingUser,
  context: CaseAccessContext,
  capability: Exclude<CaseCapability, "READ">,
): boolean {
  if (!canReadCase(user, context) || !canWriteAnything(user)) {
    return false;
  }

  if (user.id === context.ownerId) {
    return true;
  }

  return context.members.get(user.id)?.has(capability) ?? false;
}

export function canWriteCase(
  user: ActingUser,
  context: CaseAccessContext,
): boolean {
  return canPerformCaseAction(user, context, "WRITE");
}

export function canApproveCase(
  user: ActingUser,
  context: CaseAccessContext,
): boolean {
  return canPerformCaseAction(user, context, "APPROVAL");
}

export function canDiscloseCase(
  user: ActingUser,
  context: CaseAccessContext,
): boolean {
  return canPerformCaseAction(user, context, "DISCLOSURE");
}

/** Only administrators manage users, invitations and system settings. */
export function canAdministerWorkspace(user: ActingUser): boolean {
  return canAdministerOrganization(user);
}

/**
 * Report approval.
 *
 * Policy packs may additionally require the approver to differ from the last
 * editor; that check needs the report's history and lives in the reports
 * module, layered on top of this one.
 */
export function canApproveReport(
  user: ActingUser,
  context: CaseAccessContext,
): boolean {
  return canApproveCase(user, context);
}

export function canManageCaseMembers(
  user: ActingUser,
  context: CaseAccessContext,
): boolean {
  if (!canReadCase(user, context) || !canWriteAnything(user)) {
    return false;
  }

  if (user.id === context.ownerId) {
    return true;
  }

  return isAdmin(user) && canReadCase(user, context);
}

/**
 * Two-person approval, as required by the Critical Zero-Day and Program policy
 * packs. The approver must not be the person who last edited the content.
 */
export function satisfiesSeparationOfDuties(
  approverId: string,
  lastEditorId: string | null,
): boolean {
  if (lastEditorId === null) {
    return true;
  }

  return approverId !== lastEditorId;
}
