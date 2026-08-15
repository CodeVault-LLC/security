import type { Database, DatabaseHandle } from "@codevault/db";
import type { FastifyRequest } from "fastify";

import type { ServerConfig } from "../config.js";
import type { AuthenticatedPrincipal } from "../auth/session.js";
import type { AuditWriter } from "../services/audit.js";
import type { EventBroker } from "../services/events.js";
import type { JobQueue } from "../services/jobs.js";
import type { ObjectStorage } from "../services/storage.js";

/**
 * Fastify augmentation.
 *
 * Everything a route handler needs is reached through the request or the
 * instance. Route modules never import a module-level singleton, which is what
 * makes the whole app constructible in a test with substituted dependencies.
 */

declare module "fastify" {
  interface FastifyInstance {
    config: ServerConfig;
    dbHandle: DatabaseHandle;
    db: Database;
    storage: ObjectStorage;
    events: EventBroker;
    jobs: JobQueue;
    audit: AuditWriter;
  }

  interface FastifyRequest {
    /** Present only after the authentication hook has run. */
    principal: AuthenticatedPrincipal | null;
    requestId: string;
  }
}

/** A request that has passed authentication. */
export type AuthenticatedRequest = FastifyRequest & {
  principal: AuthenticatedPrincipal;
};
