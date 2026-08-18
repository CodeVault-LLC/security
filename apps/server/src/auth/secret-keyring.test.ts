import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { parseMfaKeyring, SecretKeyring } from "./secret-keyring.js";

const encoded = (byte: number): string =>
  Buffer.alloc(32, byte).toString("base64");

describe("SecretKeyring", () => {
  it("binds AES-GCM ciphertext to its AAD", () => {
    const keyring = new SecretKeyring([
      { id: "v2", key: randomBytes(32) },
      { id: "v1", key: randomBytes(32) },
    ]);
    const envelope = keyring.encrypt("top secret", "totp:user-a");

    expect(keyring.decrypt(envelope, "totp:user-a").toString()).toBe(
      "top secret",
    );
    expect(() => keyring.decrypt(envelope, "totp:user-b")).toThrow();
  });

  it("encrypts with the first key and decrypts older key versions", () => {
    const old = new SecretKeyring([{ id: "v1", key: Buffer.alloc(32, 1) }]);
    const envelope = old.encrypt("rotatable", "test:aad");
    const rotated = parseMfaKeyring(`v2:${encoded(2)},v1:${encoded(1)}`, false);

    expect(rotated.activeKeyId).toBe("v2");
    expect(rotated.decrypt(envelope, "test:aad").toString()).toBe("rotatable");
  });

  it.each([
    "",
    `v1:${encoded(1)},v1:${encoded(2)}`,
    "v1:not-base64",
    `bad id:${encoded(1)}`,
    `v1:${Buffer.alloc(31).toString("base64")}`,
  ])("rejects malformed keyring input without echoing it: %s", (raw) => {
    expect(() => parseMfaKeyring(raw, false)).toThrowError(
      /MFA key configuration/,
    );
    try {
      parseMfaKeyring(raw, false);
    } catch (error) {
      if (raw.length > 0) {
        expect(String(error)).not.toContain(raw);
      }
    }
  });

  it("derives stable, key-versioned recovery digests", () => {
    const keyring = parseMfaKeyring(`v1:${encoded(7)}`, false);
    const first = keyring.digestRecoveryCode("recovery-code", "v1");

    expect(first).toBe(keyring.digestRecoveryCode("recovery-code", "v1"));
    expect(keyring.verifyRecoveryCode("recovery-code", "v1", first)).toBe(true);
    expect(keyring.verifyRecoveryCode("different", "v1", first)).toBe(false);
  });
});
