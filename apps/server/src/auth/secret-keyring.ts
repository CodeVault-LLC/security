import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export interface EncryptionKey {
  id: string;
  key: Uint8Array;
}

export interface SecretEnvelope {
  keyId: string;
  nonce: string;
  ciphertext: string;
  authTag: string;
}

const KEY_ID = /^[a-zA-Z0-9._-]{1,32}$/;
const BASE64_32_BYTES = /^[A-Za-z0-9+/]{43}=$/;
const RECOVERY_INFO = Buffer.from("codevault/recovery-code/v1", "utf8");

function configurationError(): Error {
  return new Error("MFA key configuration is invalid.");
}

function decodeKey(encoded: string): Buffer {
  if (!BASE64_32_BYTES.test(encoded)) {
    throw configurationError();
  }

  const decoded = Buffer.from(encoded, "base64");
  if (decoded.byteLength !== 32 || decoded.toString("base64") !== encoded) {
    throw configurationError();
  }

  return decoded;
}

export class SecretKeyring {
  readonly #keys: ReadonlyMap<string, Buffer>;
  readonly activeKeyId: string;

  constructor(entries: readonly EncryptionKey[]) {
    if (entries.length === 0) {
      throw configurationError();
    }

    const keys = new Map<string, Buffer>();
    for (const entry of entries) {
      if (
        !KEY_ID.test(entry.id) ||
        entry.key.byteLength !== 32 ||
        keys.has(entry.id)
      ) {
        throw configurationError();
      }
      keys.set(entry.id, Buffer.from(entry.key));
    }

    this.activeKeyId = entries[0]!.id;
    this.#keys = keys;
  }

  encrypt(
    plaintext: string | Uint8Array,
    aad: string,
    keyId = this.activeKeyId,
  ): SecretEnvelope {
    const key = this.#key(keyId);
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(
        typeof plaintext === "string" ? Buffer.from(plaintext) : plaintext,
      ),
      cipher.final(),
    ]);

    return {
      keyId,
      nonce: nonce.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
    };
  }

  decrypt(envelope: SecretEnvelope, aad: string): Buffer {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.#key(envelope.keyId),
      Buffer.from(envelope.nonce, "base64"),
    );
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));

    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
  }

  digestRecoveryCode(code: string, keyId = this.activeKeyId): string {
    const digestKey = Buffer.from(
      hkdfSync("sha256", this.#key(keyId), Buffer.alloc(0), RECOVERY_INFO, 32),
    );

    return createHmac("sha256", digestKey).update(code, "utf8").digest("hex");
  }

  verifyRecoveryCode(code: string, keyId: string, expected: string): boolean {
    let actual: Buffer;
    let stored: Buffer;
    try {
      actual = Buffer.from(this.digestRecoveryCode(code, keyId), "hex");
      stored = Buffer.from(expected, "hex");
    } catch {
      return false;
    }

    return (
      actual.byteLength === stored.byteLength && timingSafeEqual(actual, stored)
    );
  }

  #key(keyId: string): Buffer {
    const key = this.#keys.get(keyId);
    if (key === undefined) {
      throw new Error("MFA key version is unavailable.");
    }

    return key;
  }
}

export function parseMfaKeyring(
  raw: string,
  production = process.env.NODE_ENV === "production",
): SecretKeyring {
  try {
    const parts = raw.split(",");
    if (raw.length === 0 || parts.some((part) => part.trim() !== part)) {
      throw configurationError();
    }

    const entries = parts.map((part): EncryptionKey => {
      const separator = part.indexOf(":");
      if (separator <= 0 || part.indexOf(":", separator + 1) !== -1) {
        throw configurationError();
      }
      const id = part.slice(0, separator);
      const key = decodeKey(part.slice(separator + 1));
      if (production && key.every((byte) => byte === 0)) {
        throw configurationError();
      }

      return { id, key };
    });

    return new SecretKeyring(entries);
  } catch {
    throw configurationError();
  }
}
