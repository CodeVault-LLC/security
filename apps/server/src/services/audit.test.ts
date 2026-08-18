import { describe, expect, it } from "vitest";

import { redactAuditPayload } from "./audit.js";

describe("audit payload redaction", () => {
  it("redacts confidential values recursively without hiding safe identifiers", () => {
    expect(
      redactAuditPayload({
        fingerprint: "0123456789ABCDEF",
        accessToken: "access-secret",
        nested: {
          refresh_token: "refresh-secret",
          oauth: [{ clientSecret: "client-secret" }],
          publicKeyFingerprint: "FEDCBA9876543210",
        },
        rawBody: "confidential zero-day report",
        passphrase: "correct horse battery staple",
        armoredKey: "-----BEGIN PGP PRIVATE KEY BLOCK-----",
      }),
    ).toEqual({
      fingerprint: "0123456789ABCDEF",
      accessToken: "[redacted]",
      nested: {
        refresh_token: "[redacted]",
        oauth: [{ clientSecret: "[redacted]" }],
        publicKeyFingerprint: "FEDCBA9876543210",
      },
      rawBody: "[redacted]",
      passphrase: "[redacted]",
      armoredKey: "[redacted]",
    });
  });

  it("does not mutate the caller's payload", () => {
    const nested = { authorization: "Bearer secret" };
    const payload = { nested };

    redactAuditPayload(payload);

    expect(payload).toEqual({ nested: { authorization: "Bearer secret" } });
  });
});
