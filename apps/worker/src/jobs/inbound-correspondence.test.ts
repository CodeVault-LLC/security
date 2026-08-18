import { describe, expect, test } from "vitest";

import { parseInboundMessage } from "./inbound-correspondence.js";

describe("hostile inbound correspondence", () => {
  test("never exposes active HTML or fetches remote images", async () => {
    const raw = new TextEncoder().encode(
      'From: Vendor <security@example.test>\r\nTo: researcher@example.test\r\nSubject: Update\r\nMessage-ID: <reply@example.test>\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Status <strong>update</strong></p><script>steal()</script><img src="https://attacker.invalid/pixel">',
    );
    const parsed = await parseInboundMessage(raw, {
      providerMessageId: "gmail-1",
    });
    expect(parsed.bodyText).toContain("Status update");
    expect(parsed.bodyText).not.toContain("steal");
    expect(JSON.stringify(parsed)).not.toContain("https://attacker.invalid");
    expect(parsed).not.toHaveProperty("html");
  });

  test("treats attachment filenames as data and removes traversal", async () => {
    const raw = new TextEncoder().encode(
      'From: security@example.test\r\nTo: researcher@example.test\r\nSubject: File\r\nMessage-ID: <file@example.test>\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\nSee file\r\n--x\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="../../payload.exe"\r\nContent-Transfer-Encoding: base64\r\n\r\nYWJj\r\n--x--\r\n',
    );
    const parsed = await parseInboundMessage(raw, {
      providerMessageId: "gmail-2",
    });
    expect(parsed.attachments[0]?.filename).toBe("payload.exe");
    expect(parsed.attachments[0]?.content).toEqual(
      new Uint8Array([97, 98, 99]),
    );
  });

  test("keeps OpenPGP replies encrypted and never labels ciphertext plaintext", async () => {
    const raw = new TextEncoder().encode(
      'From: security@example.test\r\nTo: researcher@example.test\r\nSubject: Encrypted\r\nMessage-ID: <pgp@example.test>\r\nContent-Type: multipart/encrypted; protocol="application/pgp-encrypted"; boundary=pgp\r\n\r\n--pgp\r\nContent-Type: application/pgp-encrypted\r\n\r\nVersion: 1\r\n--pgp\r\nContent-Type: application/octet-stream\r\n\r\n-----BEGIN PGP MESSAGE-----\r\nciphertext\r\n-----END PGP MESSAGE-----\r\n--pgp--\r\n',
    );
    const parsed = await parseInboundMessage(raw, {
      providerMessageId: "gmail-3",
    });
    expect(parsed.encrypted).toBe(true);
    expect(parsed.bodyText).toBeNull();
  });

  test("rejects oversized and malformed messages with bounded errors", async () => {
    await expect(
      parseInboundMessage(new Uint8Array(36 * 1024 * 1024), {
        providerMessageId: "gmail-big",
      }),
    ).rejects.toThrow("too large");
    await expect(
      parseInboundMessage(new TextEncoder().encode("not an email"), {
        providerMessageId: "gmail-bad",
      }),
    ).rejects.toThrow("required envelope");
  });
});
