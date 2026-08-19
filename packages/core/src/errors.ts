/**
 * Domain error categories.
 *
 * The desktop client renders one of these categories, never a stack trace.
 * Server handlers map every failure onto a category so the UI can explain what
 * happened without the API leaking implementation detail.
 */

export const ERROR_CATEGORIES = [
  "VALIDATION",
  "PERMISSION_DENIED",
  "SESSION_EXPIRED",
  "MFA_REAUTH_REQUIRED",
  "NOT_FOUND",
  "CONFLICT",
  "PROVIDER_UNAVAILABLE",
  "AI_OUTPUT_INVALID",
  "JOB_FAILED",
  "UPLOAD_FAILED",
  "EXPORT_BLOCKED",
  "RATE_LIMITED",
  "SERVER_ERROR",
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

const CATEGORY_STATUS: Record<ErrorCategory, number> = {
  VALIDATION: 400,
  PERMISSION_DENIED: 403,
  SESSION_EXPIRED: 401,
  MFA_REAUTH_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PROVIDER_UNAVAILABLE: 503,
  AI_OUTPUT_INVALID: 422,
  JOB_FAILED: 500,
  UPLOAD_FAILED: 400,
  EXPORT_BLOCKED: 422,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
};

export interface DomainErrorOptions {
  /** Machine-readable detail the client may render inline, never free-form. */
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class DomainError extends Error {
  readonly category: ErrorCategory;
  readonly statusCode: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    category: ErrorCategory,
    message: string,
    options: DomainErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? {} : { cause: options.cause });

    this.name = "DomainError";
    this.category = category;
    this.statusCode = CATEGORY_STATUS[category];
    this.details = options.details;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

export function validationError(
  message: string,
  details?: Record<string, unknown>,
): DomainError {
  return new DomainError("VALIDATION", message, details ? { details } : {});
}

export function permissionDenied(
  message = "You do not have access to this resource.",
): DomainError {
  return new DomainError("PERMISSION_DENIED", message);
}

export function notFound(entity: string): DomainError {
  // Restricted cases are reported as missing rather than forbidden so the API
  // does not confirm the existence of research the caller may not know about.
  return new DomainError("NOT_FOUND", `${entity} was not found.`);
}

export function conflict(
  message: string,
  details?: Record<string, unknown>,
): DomainError {
  return new DomainError("CONFLICT", message, details ? { details } : {});
}

export function exportBlocked(
  message: string,
  details?: Record<string, unknown>,
): DomainError {
  return new DomainError("EXPORT_BLOCKED", message, details ? { details } : {});
}

export function providerUnavailable(message: string): DomainError {
  return new DomainError("PROVIDER_UNAVAILABLE", message);
}

export function aiOutputInvalid(
  message: string,
  details?: Record<string, unknown>,
): DomainError {
  return new DomainError(
    "AI_OUTPUT_INVALID",
    message,
    details ? { details } : {},
  );
}
