import {
  canAdministerWorkspace,
  canWriteAnything,
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
  const { user } = principalOf(request);

  return { id: user.id, role: user.role, disabled: user.disabled };
}

export function requireAdmin(request: FastifyRequest): ActingUser {
  const user = actingUser(request);

  if (!canAdministerWorkspace(user)) {
    throw permissionDenied("This action requires an administrator.");
  }

  return user;
}

/** Blocks viewers from any mutation before per-case rules are consulted. */
export function requireAuthor(request: FastifyRequest): ActingUser {
  const user = actingUser(request);

  if (!canWriteAnything(user)) {
    throw permissionDenied("Your account has read-only access.");
  }

  return user;
}
