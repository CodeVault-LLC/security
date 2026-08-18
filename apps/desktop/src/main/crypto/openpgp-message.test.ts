import { createHash } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";
import {
  decrypt,
  generateKey,
  readMessage,
  readPrivateKey,
  readKey,
} from "openpgp";

import { buildPgpMimeMessage } from "./openpgp-message.js";

let vendorPublicKey: string;
let vendorPrivateKey: string;
let researcherPublicKey: string;
let researcherPrivateKey: string;

beforeAll(async () => {
  const vendor = await generateKey({
    type: "ecc",
    curve: "curve25519Legacy",
    userIDs: [{ name: "Vendor PSIRT", email: "security@vendor.test" }],
    format: "armored",
  });
  vendorPublicKey = vendor.publicKey;
  vendorPrivateKey = vendor.privateKey;
  const researcher = await generateKey({
    type: "ecc",
    curve: "curve25519Legacy",
    userIDs: [{ name: "Researcher", email: "researcher@codevault.test" }],
    format: "armored",
  });
  researcherPublicKey = researcher.publicKey;
  researcherPrivateKey = researcher.privateKey;
});

describe("PGP/MIME sealing", () => {
  it("encrypts the MIME entity, keeps the subject outside, and preserves attachment bytes", async () => {
    const attachment = new TextEncoder().encode("exact attachment bytes");
    const sealed = await buildPgpMimeMessage({
      from: "researcher@codevault.test",
      to: ["security@vendor.test"],
      cc: [],
      subject: "CASE-2026-0001 security report",
      bodyText: "Please find the security report attached.",
      attachments: [
        {
          filename: "report.txt",
          mimeType: "text/plain",
          bytes: attachment,
          sha256: createHash("sha256").update(attachment).digest("hex"),
        },
      ],
      cryptoMode: "SIGNED_AND_ENCRYPTED",
      recipientPublicKeys: [vendorPublicKey],
      signingPrivateKey: researcherPrivateKey,
      messageId: "<submission-1@codevault.local>",
      date: new Date("2026-08-18T12:00:00.000Z"),
    });

    const raw = new TextDecoder().decode(sealed.raw);
    expect(raw).toContain("Subject: CASE-2026-0001 security report");
    expect(raw).toContain('protocol="application/pgp-encrypted"');
    expect(raw).not.toContain("exact attachment bytes");
    expect(raw).not.toContain("Please find the security report attached.");
    expect(raw).not.toMatch(/(^|[^\r])\n/);

    const armor = raw.slice(
      raw.indexOf("-----BEGIN PGP MESSAGE-----"),
      raw.indexOf("-----END PGP MESSAGE-----") +
        "-----END PGP MESSAGE-----".length,
    );
    const opened = await decrypt({
      message: await readMessage({ armoredMessage: armor }),
      decryptionKeys: await readPrivateKey({ armoredKey: vendorPrivateKey }),
      verificationKeys: await readKey({ armoredKey: researcherPublicKey }),
      format: "binary",
      date: new Date("2026-08-18T12:00:00.000Z"),
    });
    await expect(opened.signatures[0]?.verified).resolves.toBe(true);
    const inner = Buffer.from(opened.data).toString("utf8");
    expect(inner).not.toContain("CASE-2026-0001 security report");
    expect(inner).toContain(Buffer.from(attachment).toString("base64"));
  });
});
