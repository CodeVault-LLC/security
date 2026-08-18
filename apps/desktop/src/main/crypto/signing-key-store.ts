import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app, safeStorage } from "electron";
import { readPrivateKey } from "openpgp";

export interface SigningKeySummary {
  fingerprint: string;
  userIds: string[];
  createdAt: string;
  expiresAt: string | null;
  encrypted: boolean;
  persistent: boolean;
}

interface StoredKey extends SigningKeySummary {
  armoredKey: string;
}

export interface SigningKeyStore {
  list(): Promise<SigningKeySummary[]>;
  importArmored(
    armoredKey: string,
    persist: boolean,
  ): Promise<SigningKeySummary>;
  remove(fingerprint: string): Promise<void>;
  armored(fingerprint: string): Promise<string | null>;
  persistenceAvailable(): boolean;
}

export interface SigningKeyStoreOptions {
  directory?: string;
  encryptionAvailable?: () => boolean;
  selectedBackend?: () => string;
  encrypt?: (value: string) => Buffer;
  decrypt?: (value: Buffer) => string;
}

function defaultPersistenceAvailable(options: SigningKeyStoreOptions): boolean {
  const available =
    options.encryptionAvailable?.() ?? safeStorage.isEncryptionAvailable();
  if (!available) return false;
  const backend =
    options.selectedBackend?.() ?? safeStorage.getSelectedStorageBackend();
  return backend !== "basic_text";
}

/** Private keys never cross the preload bridge; only metadata does. */
export function createSigningKeyStore(
  options: SigningKeyStoreOptions = {},
): SigningKeyStore {
  const directory = options.directory ?? join(app.getPath("userData"), "keys");
  const file = join(directory, "signing-keys.enc");
  const sessionKeys = new Map<string, StoredKey>();
  const persistenceAvailable = () => defaultPersistenceAvailable(options);
  const encryptValue =
    options.encrypt ?? ((value: string) => safeStorage.encryptString(value));
  const decryptValue =
    options.decrypt ?? ((value: Buffer) => safeStorage.decryptString(value));

  const readPersistent = async (): Promise<StoredKey[]> => {
    if (!persistenceAvailable()) return [];
    try {
      const decrypted = decryptValue(await readFile(file));
      const parsed = JSON.parse(decrypted) as unknown;
      return Array.isArray(parsed) ? (parsed as StoredKey[]) : [];
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  };
  const writePersistent = async (keys: StoredKey[]): Promise<void> => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(file, encryptValue(JSON.stringify(keys)), { mode: 0o600 });
  };

  return {
    persistenceAvailable,
    async list() {
      const persistent = await readPersistent();
      const combined = new Map(persistent.map((key) => [key.fingerprint, key]));
      for (const key of sessionKeys.values())
        combined.set(key.fingerprint, key);
      return [...combined.values()].map(
        ({ armoredKey: _armoredKey, ...summary }) => summary,
      );
    },
    async importArmored(armoredKey, persist) {
      const key = await readPrivateKey({ armoredKey });
      const expiration = await key.getExpirationTime();
      const stored: StoredKey = {
        fingerprint: key.getFingerprint().toUpperCase(),
        userIds: key.getUserIDs(),
        createdAt: key.getCreationTime().toISOString(),
        expiresAt: expiration instanceof Date ? expiration.toISOString() : null,
        encrypted: !key.isDecrypted(),
        persistent: persist && persistenceAvailable(),
        armoredKey,
      };
      if (persist && !persistenceAvailable()) {
        throw new Error(
          "Secure key persistence is unavailable on this workstation.",
        );
      }
      if (stored.persistent) {
        const keys = await readPersistent();
        await writePersistent([
          ...keys.filter((item) => item.fingerprint !== stored.fingerprint),
          stored,
        ]);
      } else {
        sessionKeys.set(stored.fingerprint, stored);
      }
      const { armoredKey: _armoredKey, ...summary } = stored;
      return summary;
    },
    async remove(fingerprint) {
      const normalized = fingerprint.toUpperCase();
      sessionKeys.delete(normalized);
      if (!persistenceAvailable()) return;
      const remaining = (await readPersistent()).filter(
        (key) => key.fingerprint !== normalized,
      );
      if (remaining.length === 0) await rm(file, { force: true });
      else await writePersistent(remaining);
    },
    async armored(fingerprint) {
      const normalized = fingerprint.toUpperCase();
      const session = sessionKeys.get(normalized);
      if (session !== undefined) return session.armoredKey;
      return (
        (await readPersistent()).find((key) => key.fingerprint === normalized)
          ?.armoredKey ?? null
      );
    },
  };
}
