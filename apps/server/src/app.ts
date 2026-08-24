import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify, { type FastifyInstance } from "fastify";

import { uuidv7 } from "@codevault/core/crypto";
import { createDatabase, schema, type DatabaseHandle } from "@codevault/db";
import { eq } from "drizzle-orm";

import { bearerTokenFrom } from "./auth/tokens.js";
import { resolveSession, touchSession } from "./auth/session.js";
import type { ServerConfig } from "./config.js";
import { registerErrorHandler } from "./http/errors.js";
import { registerRoutes } from "./routes.js";
import { createAuditWriter, type AuditWriter } from "./services/audit.js";
import { createEventBroker, type EventBroker } from "./services/events.js";
import { createJobQueue, type JobQueue } from "./services/jobs.js";
import { loadCaseAccess } from "./services/case-access.js";
import { createObjectStorage, type ObjectStorage } from "./services/storage.js";
import { MailProviderRegistry } from "./modules/mail/provider-registry.js";
import { createGmailProvider } from "./modules/mail/gmail-provider.js";
import { SafeRegistryHttpClient } from "./modules/registries/http-client.js";
import { createDefaultRegistryProviders } from "./modules/registries/providers.js";
import { AssetRegistry } from "./modules/registries/registry.js";
import { canReadCase } from "@codevault/core";

import "./plugins/types.js";
import { API_VERSION, SERVER_VERSION } from "./version.js";

/**
 * Application assembly.
 *
 * Dependencies are injected rather than imported as singletons, so a test can
 * build the whole API against a throwaway database and a fake object store.
 */

export interface BuildAppOptions {
  config: ServerConfig;
  /** Supplied by tests; otherwise a pool is created from the config. */
  dbHandle?: DatabaseHandle;
  storage?: ObjectStorage;
  events?: EventBroker;
  jobs?: JobQueue;
  audit?: AuditWriter;
  mailProviders?: MailProviderRegistry;
  assetRegistry?: AssetRegistry;
}

/** Routes reachable without a session. Everything else requires one. */
const PUBLIC_ROUTES = new Set([
  "POST:/v1/auth/login/start",
  "POST:/v1/auth/login/complete",
  "POST:/v1/auth/enrollment/start",
  "POST:/v1/auth/enrollment/confirm",
  "POST:/v1/invitations/inspect",
  "POST:/v1/invitations/enrollment/start",
  "POST:/v1/invitations/enrollment/confirm",
  "POST:/v1/auth/recovery/start",
  "POST:/v1/auth/recovery/confirm",
  "GET:/health",
  "GET:/v1/mail/gmail/callback",
  "POST:/v1/mail/gmail/pubsub",
]);

export async function buildApp(
  options: BuildAppOptions,
): Promise<FastifyInstance> {
  const { config } = options;

  const app = Fastify({
    logger: {
      level: config.server.logLevel,
      redact: {
        // Credentials must not reach the log even at trace level.
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "body.password",
          "body.token",
          "body.totp",
          "body.challengeToken",
          "body.enrollmentToken",
          "body.recoveryCode",
          "body.manualSecret",
        ],
        censor: "[redacted]",
      },
    },
    // The desktop client uploads directly to object storage, so no request body
    // ever needs to be large.
    bodyLimit: 2 * 1024 * 1024,
    genReqId: () => uuidv7(),
  }).withTypeProvider<TypeBoxTypeProvider>();

  const dbHandle =
    options.dbHandle ??
    createDatabase({
      connectionString: config.database.connectionString,
      maxConnections: config.database.maxConnections,
      ssl: config.database.ssl,
    });

  const events = options.events ?? createEventBroker();
  const jobs =
    options.jobs ??
    createJobQueue({ connectionString: config.database.connectionString });

  app.decorate("config", config);
  app.decorate("dbHandle", dbHandle);
  app.decorate("db", dbHandle.db);
  app.decorate("storage", options.storage ?? createObjectStorage(config));
  app.decorate("events", events);
  app.decorate("jobs", jobs);
  app.decorate("audit", options.audit ?? createAuditWriter());
  const mailProviders = options.mailProviders ?? new MailProviderRegistry();
  if (config.gmail.enabled && mailProviders.get("gmail") === null) {
    mailProviders.register(createGmailProvider(config.gmail));
  }
  app.decorate("mailProviders", mailProviders);
  app.decorate(
    "assetRegistry",
    options.assetRegistry ??
      new AssetRegistry(
        createDefaultRegistryProviders(new SafeRegistryHttpClient()),
      ),
  );

  // Event delivery is filtered by the same case rules as the REST API, so a
  // subscriber is never told that a restricted case changed.
  events.setVisibilityFilter(async (userId, caseId) => {
    if (caseId === null) {
      return true;
    }

    const record = await loadCaseAccess(dbHandle.db, caseId);

    if (record === null) {
      return false;
    }

    const [rows] = await dbHandle.db
      .select({
        id: schema.users.id,
        organizationId: schema.organizationMemberships.organizationId,
        role: schema.organizationMemberships.role,
        disabled: schema.users.disabled,
      })
      .from(schema.users)
      .innerJoin(
        schema.organizationMemberships,
        eq(schema.organizationMemberships.userId, schema.users.id),
      )
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (rows === undefined) {
      return false;
    }

    return canReadCase(
      {
        id: rows.id,
        userId: rows.id,
        organizationId: rows.organizationId,
        role: rows.role,
        disabled: rows.disabled,
      },
      record.context,
    );
  });

  await app.register(cors, {
    origin:
      config.server.corsOrigins.length === 0
        ? false
        : config.server.corsOrigins,
    credentials: false,
  });

  await app.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: "1 minute",
  });

  app.addHook("onRequest", async (request) => {
    request.requestId = String(request.id);
    request.principal = null;
  });

  /**
   * Authentication.
   *
   * Runs for every route except the small public set. Resolving the token also
   * confirms the user is still enabled, so disabling an account takes effect on
   * that account's very next request.
   */
  app.addHook("onRequest", async (request, reply) => {
    const routeKey = `${request.method}:${request.routeOptions.url ?? request.url}`;

    if (PUBLIC_ROUTES.has(routeKey)) {
      return;
    }

    const token = bearerTokenFrom(request.headers.authorization);

    if (token === null) {
      return reply.status(401).send({
        error: {
          category: "PERMISSION_DENIED",
          message: "Authentication is required.",
          requestId: request.requestId,
        },
      });
    }

    const principal = await resolveSession(app.db, token);

    if (principal === null) {
      return reply.status(401).send({
        error: {
          category: "SESSION_EXPIRED",
          message: "Your session has expired. Sign in again.",
          requestId: request.requestId,
        },
      });
    }

    request.principal = principal;

    return undefined;
  });

  app.addHook("onResponse", async (request) => {
    const principal = request.principal;

    if (principal !== null) {
      await touchSession(app.db, principal.session.id).catch(() => undefined);
    }
  });

  registerErrorHandler(app);

  app.get("/health", async () => ({
    status: "ok",
    apiVersion: API_VERSION,
    serverVersion: SERVER_VERSION,
  }));

  await registerRoutes(app);

  return app;
}
