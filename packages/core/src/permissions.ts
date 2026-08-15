/**
 * Authorization rules.
 *
 * These functions are pure so they can be exhaustively tested, and they are
 * called on the server only. The desktop client may use them to hide controls,
 * but hiding a button is never the enforcement point.
 */

export const USER_ROLES = ["ADMIN", "MEMBER", "VIEWER"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const CASE_ACCESS_LEVELS = ["READ", "WRITE"] as const;

export type CaseAccess = (typeof CASE_ACCESS_LEVELS)[number];

export interface ActingUser {
  id: string;
  role: UserRole;
  disabled: boolean;
}

export interface CaseAccessContext {
  /** Case owner, who always retains write access to their own case. */
  ownerId: string;
  /**
   * Restricted cases are visible only to explicitly listed members (and to
   * their owner). Unrestricted cases fall back to global role permissions.
   */
  restricted: boolean;
  /** Explicit membership grants, keyed by user ID. */
  members: ReadonlyMap<string, CaseAccess>;
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
  if (!isActive(user)) {
    return false;
  }

  if (user.id === context.ownerId) {
    return true;
  }

  if (context.members.has(user.id)) {
    return true;
  }

  if (context.restricted) {
    // A restricted case is invisible to everyone outside its allow-list,
    // administrators included: the point of the flag is to shrink the set of
    // people who can read an embargoed zero-day, not to document intent.
    return false;
  }

  return true;
}

export function canWriteCase(
  user: ActingUser,
  context: CaseAccessContext,
): boolean {
  if (!canReadCase(user, context)) {
    return false;
  }

  if (user.id === context.ownerId) {
    return true;
  }

  const membership = context.members.get(user.id);

  if (membership === "WRITE") {
    return true;
  }

  if (membership === "READ") {
    // An explicit READ grant is a deliberate downgrade and outranks the user's
    // global role for this case.
    return false;
  }

  return canWriteAnything(user);
}

/** Only administrators manage users, invitations and system settings. */
export function canAdministerWorkspace(user: ActingUser): boolean {
  return isAdmin(user);
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
  return canWriteCase(user, context);
}

export function canManageCaseMembers(
  user: ActingUser,
  context: CaseAccessContext,
): boolean {
  if (!isActive(user)) {
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
