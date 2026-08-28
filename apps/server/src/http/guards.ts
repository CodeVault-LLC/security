import {
  canAdministerOrganization,
  canWriteAnything,
  DomainError,
  hasRecentMfa,
  permissionDenied,
  type ActingUser,
} from "@codevault/core";
import type { FastifyRequest } from "fastify";

import type { AuthenticatedPrincipal } from "../auth/session.js";

/**
 * Route guards.
 *
 * These read the principal the authentication hook attached. They never accept
 * a user or role from the request body: the client's opinion about who it is
 * has no standing.
 */

export function principalOf(request: FastifyRequest): AuthenticatedPrincipal {
  const principal = request.principal;

  if (principal === null) {
    // Reaching here means a route was registered without the auth hook.
    throw permissionDenied("Authentication is required.");
  }

  return principal;
}

export function actingUser(request: FastifyRequest): ActingUser {
  const { organization, user } = principalOf(request);

  return {
    id: user.id,
    userId: user.id,
    organizationId: organization.id,
    role: user.role,
    disabled: user.disabled,
  };
}

export function requireInteractiveSession(
  request: FastifyRequest,
): AuthenticatedPrincipal {
  const principal = principalOf(request);
  if (principal.authentication.kind !== "SESSION") {
    throw permissionDenied("This action requires an interactive session.");
  }
  return principal;
}

export function requireOrganizationMember(request: FastifyRequest): ActingUser {
  return actingUser(request);
}

export function requireOrganizationAdmin(request: FastifyRequest): ActingUser {
  const user = actingUser(request);

  if (!canAdministerOrganization(user)) {
    throw permissionDenied("This action requires an administrator.");
  }

  return user;
}

/** Backwards-compatible name while route modules move under organization APIs. */
export const requireAdmin = requireOrganizationAdmin;

export function requireRecentMfa(request: FastifyRequest): ActingUser {
  const principal = principalOf(request);

  if (!principal.organization.policy.mfaRequired) {
    return actingUser(request);
  }

  if (
    (principal.organization.policy.phishingResistantMfaRequired &&
      principal.user.role === "ADMIN" &&
      principal.session.mfaMethod !== "WEBAUTHN") ||
    !hasRecentMfa(
      principal.session.mfaVerifiedAt,
      principal.organization.policy.recentMfaMinutes,
    )
  ) {
    throw new DomainError(
      "MFA_REAUTH_REQUIRED",
      principal.organization.policy.phishingResistantMfaRequired &&
        principal.user.role === "ADMIN"
        ? "A recent security-key verification is required."
        : "Recent multi-factor authentication is required.",
      principal.organization.policy.phishingResistantMfaRequired &&
        principal.user.role === "ADMIN"
        ? { details: { requiredMethod: "WEBAUTHN" } }
        : undefined,
    );
  }

  return actingUser(request);
}

export function requireRecentPhishingResistantMfa(
  request: FastifyRequest,
): ActingUser {
  const principal = requireInteractiveSession(request);
  if (
    principal.session.mfaMethod !== "WEBAUTHN" ||
    !hasRecentMfa(
      principal.session.mfaVerifiedAt,
      principal.organization.policy.recentMfaMinutes,
    )
  ) {
    throw new DomainError(
      "MFA_REAUTH_REQUIRED",
      "A recent security-key verification is required.",
      { details: { requiredMethod: "WEBAUTHN" } },
    );
  }
  return actingUser(request);
}

export function requireOrganizationAdminWithRecentMfa(
  request: FastifyRequest,
): ActingUser {
  const admin = requireOrganizationAdmin(request);
  requireRecentMfa(request);
  return admin;
}

/** Blocks viewers from any mutation before per-case rules are consulted. */
export function requireAuthor(request: FastifyRequest): ActingUser {
  const user = actingUser(request);

  if (!canWriteAnything(user)) {
    throw permissionDenied("Your account has read-only access.");
  }

  return user;
}
