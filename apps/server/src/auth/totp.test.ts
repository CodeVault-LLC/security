import { describe, expect, it } from "vitest";

import {
  createTotpEnrollment,
  generateTotpAt,
  validateTotpAt,
} from "./totp.js";

const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const RFC_VECTORS = [
  [59, "287082"],
  [1_111_111_109, "081804"],
  [1_111_111_111, "050471"],
  [1_234_567_890, "005924"],
  [2_000_000_000, "279037"],
] as const;

describe("TOTP", () => {
  it.each(RFC_VECTORS)("matches RFC 6238 SHA-1 at %i", (unixTime, token) => {
    expect(generateTotpAt(RFC_SECRET, unixTime * 1_000)).toBe(token);
  });

  it("returns the absolute matched counter and bounds the window", () => {
    const now = 1_700_000_000_000;
    const token = generateTotpAt(RFC_SECRET, now + 30_000);

    expect(validateTotpAt(RFC_SECRET, token, now)).toBe(
      Math.floor(now / 30_000) + 1,
    );
    expect(validateTotpAt(RFC_SECRET, token, now - 30_000)).toBeNull();
  });

  it.each(["", "12345", "1234567", "abcdef", "１２３４５６"])(
    "rejects malformed tokens: %s",
    (token) => {
      expect(validateTotpAt(RFC_SECRET, token, Date.now())).toBeNull();
    },
  );

  it("creates a unique 20-byte fixed-policy enrollment", () => {
    const first = createTotpEnrollment("CodeVault", "person@example.test");
    const second = createTotpEnrollment("CodeVault", "person@example.test");

    expect(first.manualSecret).not.toBe(second.manualSecret);
    expect(first.secretBytes).toHaveLength(20);
    expect(first.provisioningUri).toContain("algorithm=SHA1");
    expect(first.provisioningUri).toContain("digits=6");
    expect(first.provisioningUri).toContain("period=30");
  });
});
