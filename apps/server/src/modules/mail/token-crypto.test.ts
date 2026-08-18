import { describe, expect, test } from "vitest";
import { randomBytes } from "node:crypto";

import {
  decryptSecret,
  encryptSecret,
  parseTokenKeyring,
  type SecretContext,
} from "./token-crypto.js";

const context: SecretContext = {
  provider: "gmail",
  connectionId: "0198c391-a536-7000-8000-000000000001",
  userId: "0198c391-a536-7000-8000-000000000002",
};

describe("mail token encryption", () => {
  test("round trips with the active version and authenticated context", () => {
    const keyring = {
      activeVersion: 2,
      keys: new Map([
        [1, randomBytes(32)],
        [2, randomBytes(32)],
      ]),
    };

    const envelope = encryptSecret("refresh-token", keyring, context);

    expect(envelope.keyVersion).toBe(2);
    expect(decryptSecret(envelope, keyring, context)).toBe("refresh-token");
  });

  test("rejects ciphertext moved to another user or connection", () => {
    const keyring = { activeVersion: 1, keys: new Map([[1, randomBytes(32)]]) };
    const envelope = encryptSecret("refresh-token", keyring, context);

    expect(() =>
      decryptSecret(envelope, keyring, {
        ...context,
        userId: crypto.randomUUID(),
      }),
    ).toThrow();
    expect(() =>
      decryptSecret(envelope, keyring, {
        ...context,
        connectionId: crypto.randomUUID(),
      }),
    ).toThrow();
  });

  test("detects tampering and decrypts old key versions", () => {
    const oldKey = randomBytes(32);
    const currentKey = randomBytes(32);
    const oldKeyring = { activeVersion: 1, keys: new Map([[1, oldKey]]) };
    const envelope = encryptSecret("refresh-token", oldKeyring, context);
    const rotated = {
      activeVersion: 2,
      keys: new Map([
        [1, oldKey],
        [2, currentKey],
      ]),
    };

    expect(decryptSecret(envelope, rotated, context)).toBe("refresh-token");
    const tampered = {
      ...envelope,
      ciphertext: new Uint8Array(envelope.ciphertext),
    };
    tampered.ciphertext[0] = (tampered.ciphertext[0] ?? 0) ^ 1;
    expect(() => decryptSecret(tampered, rotated, context)).toThrow();
  });

  test("parses a versioned keyring without accepting weak keys", () => {
    const first = randomBytes(32).toString("base64");
    const second = randomBytes(32).toString("base64");
    const parsed = parseTokenKeyring(`1:${first},2:${second}`, 2);

    expect(parsed.activeVersion).toBe(2);
    expect(parsed.keys.size).toBe(2);
    expect(() =>
      parseTokenKeyring(`1:${randomBytes(16).toString("base64")}`, 1),
    ).toThrow("32 bytes");
  });
});
