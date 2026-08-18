import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface TokenKeyring {
  activeVersion: number;
  keys: ReadonlyMap<number, Uint8Array>;
}

export interface SecretContext {
  provider: string;
  connectionId: string;
  userId: string;
}

export interface SecretEnvelope {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  authTag: Uint8Array;
  keyVersion: number;
}

function associatedData(context: SecretContext): Buffer {
  return Buffer.from(
    `codevault-mail-token-v1\0${context.provider}\0${context.connectionId}\0${context.userId}`,
    "utf8",
  );
}

function keyFor(keyring: TokenKeyring, version: number): Uint8Array {
  const key = keyring.keys.get(version);

  if (key === undefined) {
    throw new Error(`Mail token key version ${version} is unavailable.`);
  }

  if (key.byteLength !== 32) {
    throw new Error(
      `Mail token key version ${version} must be exactly 32 bytes.`,
    );
  }

  return key;
}

export function encryptSecret(
  plaintext: string,
  keyring: TokenKeyring,
  context: SecretContext,
): SecretEnvelope {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    keyFor(keyring, keyring.activeVersion),
    nonce,
  );
  cipher.setAAD(associatedData(context));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext,
    nonce,
    authTag: cipher.getAuthTag(),
    keyVersion: keyring.activeVersion,
  };
}

export function decryptSecret(
  envelope: SecretEnvelope,
  keyring: TokenKeyring,
  context: SecretContext,
): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyFor(keyring, envelope.keyVersion),
    envelope.nonce,
  );
  decipher.setAAD(associatedData(context));
  decipher.setAuthTag(envelope.authTag);

  return Buffer.concat([
    decipher.update(envelope.ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

export function parseTokenKeyring(
  serialized: string,
  activeVersion: number,
): TokenKeyring {
  const keys = new Map<number, Uint8Array>();

  for (const entry of serialized.split(",")) {
    const separator = entry.indexOf(":");
    const version = Number(entry.slice(0, separator));
    const encoded = entry.slice(separator + 1);

    if (
      separator < 1 ||
      !Number.isInteger(version) ||
      version < 1 ||
      encoded === ""
    ) {
      throw new Error(
        "MAIL_TOKEN_KEYRING must contain comma-separated version:base64 entries.",
      );
    }

    const key = Buffer.from(encoded, "base64");

    if (key.byteLength !== 32) {
      throw new Error(
        `Mail token key version ${version} must be exactly 32 bytes.`,
      );
    }

    if (keys.has(version)) {
      throw new Error(`Mail token key version ${version} is duplicated.`);
    }

    keys.set(version, key);
  }

  if (!keys.has(activeVersion)) {
    throw new Error(
      `Active mail token key version ${activeVersion} is unavailable.`,
    );
  }

  return { activeVersion, keys };
}
