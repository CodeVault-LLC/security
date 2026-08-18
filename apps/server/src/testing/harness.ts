import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { generateOpaqueToken, uuidv7 } from "@codevault/core/crypto";
import type { UserRole } from "@codevault/core";
import { createDatabase, schema, type DatabaseHandle } from "@codevault/db";

import { buildApp } from "../app.js";
import { hashPassword } from "../auth/password.js";
import { hashToken } from "../auth/tokens.js";
import { loadConfig, type ServerConfig } from "../config.js";
import { createEventBroker } from "../services/events.js";
import type { JobQueue } from "../services/jobs.js";
import { seedBuiltIns } from "../startup/seed.js";
import type {
  CompletedPart,
  ObjectStorage,
  PresignedUpload,
  StoredObjectInfo,
} from "../services/storage.js";

/**
 * Integration test harness.
 *
 * Builds the real application against a real PostgreSQL, with object storage
 * and the job queue substituted in memory. The point is to exercise the actual
 * routes, hooks and SQL — a security test that runs against a mocked database
 * proves very little about a system whose access control is partly SQL.
 */

export interface TestHarness {
  app: FastifyInstance;
  dbHandle: DatabaseHandle;
  storage: FakeStorage;
  jobs: FakeJobQueue;
  config: ServerConfig;
  organizationId: string;
  /** Creates a user and returns a usable bearer token. */
  createUser(options?: CreateUserOptions): Promise<TestUser>;
  /** Issues a session for an existing user. */
  issueSession(userId: string, expiresAt?: Date): Promise<string>;
  close(): Promise<void>;
}

export interface CreateUserOptions {
  role?: UserRole;
  disabled?: boolean;
  password?: string;
  email?: string;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: UserRole;
  organizationId: string;
  token: string;
  headers: Record<string, string>;
}

export const TEST_PASSWORD = "correct-horse-battery-staple";

export interface FakeStorage extends ObjectStorage {
  objects: Map<string, Uint8Array>;
  /** Forces `head` to report a different size, for upload-integrity tests. */
  reportedSizeOverride: number | null;
}

export interface FakeJobQueue extends JobQueue {
  sent: Array<{ queue: string; data: unknown }>;
}

export function createFakeStorage(): FakeStorage {
  const objects = new Map<string, Uint8Array>();

  const storage: FakeStorage = {
    objects,
    reportedSizeOverride: null,

    async createUpload(
      objectKey,
      _contentType,
      sizeBytes,
    ): Promise<PresignedUpload> {
      return {
        strategy: "SINGLE",
        url: `memory://${objectKey}`,
        multipartUploadId: null,
        partUrls: [],
        partSizeBytes: sizeBytes,
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      };
    },

    async completeMultipartUpload(
      _objectKey: string,
      _uploadId: string,
      _parts: readonly CompletedPart[],
    ) {
      // Nothing to assemble in memory.
    },

    async abortMultipartUpload() {
      // Nothing to abort in memory.
    },

    async head(objectKey): Promise<StoredObjectInfo | null> {
      const stored = objects.get(objectKey);

      if (stored === undefined) {
        return null;
      }

      return {
        sizeBytes: storage.reportedSizeOverride ?? stored.byteLength,
        etag: `"${objectKey}"`,
      };
    },

    async createDownloadUrl(objectKey, filename) {
      return {
        url: `memory://${objectKey}?filename=${encodeURIComponent(filename)}`,
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      };
    },

    async putObject(objectKey, body) {
      objects.set(objectKey, body);
    },

    async getObject(objectKey) {
      const stored = objects.get(objectKey);

      if (stored === undefined) {
        throw new Error(`No object at ${objectKey}`);
      }

      return stored;
    },

    async deleteObject(objectKey) {
      objects.delete(objectKey);
    },
  };

  return storage;
}

export function createFakeJobQueue(): FakeJobQueue {
  const sent: Array<{ queue: string; data: unknown }> = [];

  return {
    sent,
    async start() {},
    async stop() {},
    async send(queue, data) {
      sent.push({ queue, data });

      return uuidv7();
    },
    instance() {
      throw new Error("The fake queue has no pg-boss instance.");
    },
  } as FakeJobQueue;
}

export async function createHarness(): Promise<TestHarness> {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined) {
    throw new Error("DATABASE_URL must be set for integration tests.");
  }

  const config: ServerConfig = {
    ...loadConfig({
      DATABASE_URL: connectionString,
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_BUCKET: "codevault-test",
      S3_ACCESS_KEY_ID: "test",
      S3_SECRET_ACCESS_KEY: "test",
      MFA_ENCRYPTION_KEYS: `test:${Buffer.alloc(32, 7).toString("base64")}`,
      LOG_LEVEL: process.env.CODEVAULT_TEST_LOG ?? "silent",
    }),
  };

  const dbHandle = createDatabase({ connectionString });
  const storage = createFakeStorage();
  const jobs = createFakeJobQueue();
  const [existingOrganization] = await dbHandle.db
    .select({ id: schema.organizations.id })
    .from(schema.organizations)
    .limit(1);
  const organizationId = existingOrganization?.id ?? uuidv7();

  if (existingOrganization === undefined) {
    const harnessAdministratorId = uuidv7();

    await dbHandle.db.transaction(async (tx) => {
      await tx.insert(schema.organizations).values({
        id: organizationId,
        name: "CodeVault Test Organization",
      });
      await tx
        .insert(schema.organizationSecurityPolicies)
        .values({ organizationId });
      await tx.insert(schema.users).values({
        id: harnessAdministratorId,
        email: `harness-admin-${harnessAdministratorId}@codevault.test`,
        displayName: "Harness Administrator",
        passwordHash: await hashPassword(TEST_PASSWORD),
      });
      await tx.insert(schema.organizationMemberships).values({
        organizationId,
        userId: harnessAdministratorId,
        role: "ADMIN",
      });
    });
  }

  const app = await buildApp({
    config,
    dbHandle,
    storage,
    jobs,
    events: createEventBroker(),
  });

  await app.ready();
  await seedBuiltIns(dbHandle.db);

  const issueSession = async (
    userId: string,
    expiresAt = new Date(Date.now() + 3_600_000),
  ): Promise<string> => {
    const token = generateOpaqueToken();

    await dbHandle.db.insert(schema.sessions).values({
      userId,
      tokenHash: hashToken(token),
      expiresAt: expiresAt.toISOString(),
      mfaVerifiedAt: new Date().toISOString(),
      mfaMethod: "TOTP",
    });

    return token;
  };

  return {
    app,
    dbHandle,
    storage,
    jobs,
    config,
    organizationId,

    async createUser(options: CreateUserOptions = {}): Promise<TestUser> {
      const password = options.password ?? TEST_PASSWORD;
      const email = options.email ?? `user-${uuidv7()}@codevault.test`;
      const role = options.role ?? "MEMBER";

      const created = await dbHandle.db.transaction(async (tx) => {
        const [account] = await tx
          .insert(schema.users)
          .values({
            email,
            displayName: `Test ${role}`,
            passwordHash: await hashPassword(password),
            disabled: options.disabled ?? false,
          })
          .returning({ id: schema.users.id });

        if (account === undefined) {
          throw new Error("Could not create the test user.");
        }

        await tx.insert(schema.organizationMemberships).values({
          organizationId,
          userId: account.id,
          role,
        });

        return account;
      });

      const token = await issueSession(created.id);

      return {
        id: created.id,
        email,
        password,
        role,
        organizationId,
        token,
        headers: { authorization: `Bearer ${token}` },
      };
    },

    issueSession,

    async close() {
      await app.close();
      await dbHandle.close();
    },
  };
}

/** Clears the login-throttle history so tests do not lock each other out. */
export async function clearLoginAttempts(handle: TestHarness): Promise<void> {
  await handle.dbHandle.db.execute(sql`DELETE FROM login_attempts`);
}
