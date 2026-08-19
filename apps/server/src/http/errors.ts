import {
  DomainError,
  isDomainError,
  type ErrorCategory,
} from "@codevault/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { translateDatabaseError } from "./database-errors.js";

/**
 * Error handling.
 *
 * The API answers with a category, a sentence a person can read, and a request
 * ID. It never returns a stack trace, a driver message or a constraint name: an
 * error body is an information-disclosure surface like any other response.
 */

interface FastifyValidationError {
  validation?: unknown;
  statusCode?: number;
  code?: string;
  message?: string;
}

function categoryForFastifyError(error: FastifyValidationError): ErrorCategory {
  if (error.validation !== undefined) {
    return "VALIDATION";
  }

  if (error.statusCode === 429) {
    return "RATE_LIMITED";
  }

  if (error.statusCode === 404) {
    return "NOT_FOUND";
  }

  if (error.statusCode !== undefined && error.statusCode < 500) {
    return "VALIDATION";
  }

  return "SERVER_ERROR";
}

const SAFE_MESSAGES: Record<ErrorCategory, string> = {
  VALIDATION: "The request was not valid.",
  PERMISSION_DENIED: "You do not have access to this resource.",
  SESSION_EXPIRED: "Your session has expired. Sign in again.",
  MFA_REAUTH_REQUIRED: "Recent multi-factor authentication is required.",
  NOT_FOUND: "The requested item was not found.",
  CONFLICT: "The data changed since you loaded it.",
  PROVIDER_UNAVAILABLE: "The provider is unavailable.",
  AI_OUTPUT_INVALID: "The AI response could not be used.",
  JOB_FAILED: "A background job failed.",
  UPLOAD_FAILED: "The upload could not be completed.",
  EXPORT_BLOCKED: "The export was blocked.",
  RATE_LIMITED: "Too many attempts. Try again shortly.",
  SERVER_ERROR: "Something went wrong on the server.",
};

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
      const requestId = request.requestId;

      if (isDomainError(error)) {
        request.log.info(
          { requestId, category: error.category, message: error.message },
          "domain error",
        );

        return reply.status(error.statusCode).send({
          error: {
            category: error.category,
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details }),
            requestId,
          },
        });
      }

      // A constraint violation is a client mistake, not a server fault. It is
      // translated here so every route gets the behaviour without each one
      // wrapping its own queries in a try/catch.
      const translated = translateDatabaseError(error);

      if (translated !== null) {
        request.log.info(
          { requestId, category: translated.category },
          "database constraint rejected the request",
        );

        return reply.status(translated.statusCode).send({
          error: {
            category: translated.category,
            message: translated.message,
            requestId,
          },
        });
      }

      const fastifyError = error as FastifyValidationError;
      const category = categoryForFastifyError(fastifyError);
      const statusCode = fastifyError.statusCode ?? 500;

      if (category === "SERVER_ERROR") {
        // Full detail goes to the operator's log; the client gets a sentence.
        request.log.error({ requestId, err: error }, "unhandled server error");
      } else {
        request.log.info(
          { requestId, code: fastifyError.code },
          "request rejected",
        );
      }

      const message =
        category === "VALIDATION" && typeof fastifyError.message === "string"
          ? sanitiseValidationMessage(fastifyError.message)
          : SAFE_MESSAGES[category];

      return reply.status(statusCode).send({
        error: { category, message, requestId },
      });
    },
  );

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) =>
    reply.status(404).send({
      error: {
        category: "NOT_FOUND" satisfies ErrorCategory,
        message: SAFE_MESSAGES.NOT_FOUND,
        requestId: request.requestId,
      },
    }),
  );
}

/**
 * Keeps the useful part of a schema-validation message.
 *
 * "body/title must NOT have fewer than 1 characters" helps a researcher fix the
 * request; anything longer is truncated rather than echoed wholesale.
 */
function sanitiseValidationMessage(message: string): string {
  const trimmed = message.trim();

  if (trimmed.length === 0) {
    return SAFE_MESSAGES.VALIDATION;
  }

  return trimmed.length > 300 ? `${trimmed.slice(0, 297)}...` : trimmed;
}

export { DomainError };
