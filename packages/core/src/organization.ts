import type { UserRole } from "./permissions.js";

/** Authority is granted by the caller's sole active organization membership. */
export interface OrganizationActor {
  userId: string;
  organizationId: string;
  role: UserRole;
  disabled: boolean;
}

export function isActiveOrganizationMember(actor: OrganizationActor): boolean {
  return !actor.disabled;
}

export function canAdministerOrganization(actor: OrganizationActor): boolean {
  return isActiveOrganizationMember(actor) && actor.role === "ADMIN";
}

/**
 * Checks the server-recorded MFA timestamp against a bounded organization
 * policy. Future timestamps fail closed so clock errors cannot extend trust.
 */
export function hasRecentMfa(
  verifiedAt: string | null,
  recentMfaMinutes: number,
  now: Date = new Date(),
): boolean {
  if (
    verifiedAt === null ||
    !Number.isInteger(recentMfaMinutes) ||
    recentMfaMinutes < 5 ||
    recentMfaMinutes > 30
  ) {
    return false;
  }

  const verifiedAtMs = Date.parse(verifiedAt);
  const nowMs = now.getTime();

  if (!Number.isFinite(verifiedAtMs) || verifiedAtMs > nowMs) {
    return false;
  }

  return nowMs - verifiedAtMs <= recentMfaMinutes * 60_000;
}
