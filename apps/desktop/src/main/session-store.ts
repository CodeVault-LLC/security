import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { app, safeStorage } from "electron";

/**
 * Session token storage.
 *
 * The raw bearer token lives in the main process and is never handed to the
 * renderer. On disk it is encrypted with the platform keystore through
 * `safeStorage`.
 *
 * On Linux, `safeStorage` falls back to a "basic text" backend when no keyring
 * is available. That backend encrypts with a hard-coded key, which is not
 * encryption in any sense that matters here. In that case CodeVault refuses to
 * persist the token at all: the researcher signs in again next launch, and an
 * embargoed-case session is not left sitting in a file that anyone can read.
 */

export type StorageBackendStatus =
  | { available: true; persistent: true; backend: string }
  | { available: true; persistent: false; backend: string; reason: string }
  | { available: false; persistent: false; reason: string };

export interface StoredSession {
  token: string;
  serverUrl: string;
  expiresAt: string;
  userId: string;
}

/** Backends that do not actually protect the token at rest. */
const INSECURE_LINUX_BACKENDS = new Set(["basic_text", "unknown"]);

export function describeStorageBackend(): StorageBackendStatus {
  if (!safeStorage.isEncryptionAvailable()) {
    return {
      available: false,
      persistent: false,
      reason:
        "The operating system did not offer a credential store, so the session cannot be saved.",
    };
  }

  if (process.platform !== "linux") {
    return {
      available: true,
      persistent: true,
      backend: process.platform === "darwin" ? "keychain" : "dpapi",
    };
  }

  const backend = safeStorage.getSelectedStorageBackend();

  if (INSECURE_LINUX_BACKENDS.has(backend)) {
    return {
      available: true,
      persistent: false,
      backend,
      reason:
        "No system keyring is available, so the session would be stored with a " +
        "well-known key. CodeVault Security will keep you signed in for this session only.",
    };
  }

  return { available: true, persistent: true, backend };
}

export interface SessionStore {
  /** Current session, if one is held in memory. */
  current(): StoredSession | null;
  /** Stores a session, persisting it only when the backend is trustworthy. */
  save(
    session: StoredSession,
    persist?: boolean,
  ): Promise<StorageBackendStatus>;
  /** Loads a persisted session, if any survived the last shutdown. */
  restore(): Promise<StoredSession | null>;
  clear(): Promise<void>;
  status(): StorageBackendStatus;
}

export interface SessionStoreOptions {
  /** Overridden in tests; defaults to the Electron user-data directory. */
  filePath?: string;
}

export function createSessionStore(
  options: SessionStoreOptions = {},
): SessionStore {
  const filePath =
    options.filePath ?? join(app.getPath("userData"), "session.enc");
  let session: StoredSession | null = null;
  let status = describeStorageBackend();

  return {
    current() {
      return session;
    },

    status() {
      return status;
    },

    async save(next, persist = true) {
      session = next;
      status = describeStorageBackend();

      if (!persist || !status.available || !status.persistent) {
        // Deliberately not written to disk. The token stays in memory for this
        // run and is gone when the process exits.
        await rm(filePath, { force: true });

        return status;
      }

      const encrypted = safeStorage.encryptString(JSON.stringify(next));

      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, encrypted, { mode: 0o600 });

      return status;
    },

    async restore() {
      status = describeStorageBackend();

      if (!status.available || !status.persistent) {
        return null;
      }

      try {
        const encrypted = await readFile(filePath);
        const decrypted = safeStorage.decryptString(encrypted);
        const parsed: unknown = JSON.parse(decrypted);

        if (!isStoredSession(parsed)) {
          await rm(filePath, { force: true });

          return null;
        }

        if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
          await rm(filePath, { force: true });

          return null;
        }

        session = parsed;

        return parsed;
      } catch {
        // A token that cannot be decrypted is a token from another machine,
        // another user account or a corrupted file. It is removed rather than
        // reported: there is nothing the researcher can do about it.
        await rm(filePath, { force: true });

        return null;
      }
    },

    async clear() {
      session = null;
      await rm(filePath, { force: true });
    },
  };
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.token === "string" &&
    typeof candidate.serverUrl === "string" &&
    typeof candidate.expiresAt === "string" &&
    typeof candidate.userId === "string"
  );
}
