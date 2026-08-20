import { createHash } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";
import {
  decrypt,
  generateKey,
  readMessage,
  readPrivateKey,
  readKey,
} from "openpgp";

import {
  buildPgpMimeMessage,
  decryptPgpMimeMessage,
  unlockPrivateKey,
} from "./openpgp-message.js";

let vendorPublicKey: string;
let vendorPrivateKey: string;
let researcherPublicKey: string;
let researcherPrivateKey: string;
let encryptedResearcherPrivateKey: string;

beforeAll(async () => {
  const keyCreationTime = new Date("2026-08-17T12:00:00.000Z");
  const vendor = await generateKey({
    type: "ecc",
    curve: "curve25519Legacy",
    userIDs: [{ name: "Vendor PSIRT", email: "security@vendor.test" }],
    format: "armored",
    date: keyCreationTime,
  });
  vendorPublicKey = vendor.publicKey;
  vendorPrivateKey = vendor.privateKey;
  const researcher = await generateKey({
    type: "ecc",
    curve: "curve25519Legacy",
    userIDs: [{ name: "Researcher", email: "researcher@codevault.test" }],
    format: "armored",
    date: keyCreationTime,
  });
  researcherPublicKey = researcher.publicKey;
  researcherPrivateKey = researcher.privateKey;
  const encryptedResearcher = await generateKey({
    type: "ecc",
    curve: "curve25519Legacy",
    userIDs: [{ name: "Encrypted Researcher", email: "secure@codevault.test" }],
    passphrase: "correct test passphrase",
    format: "armored",
    date: keyCreationTime,
  });
  encryptedResearcherPrivateKey = encryptedResearcher.privateKey;
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

  it("decrypts an inbound PGP/MIME body locally without returning HTML", async () => {
    const sealed = await buildPgpMimeMessage({
      from: "security@vendor.test",
      to: ["researcher@codevault.test"],
      cc: [],
      subject: "Encrypted vendor reply",
      bodyText: "Confidential remediation details.",
      attachments: [],
      cryptoMode: "ENCRYPTED",
      recipientPublicKeys: [researcherPublicKey],
      messageId: "<vendor-reply@vendor.test>",
    });
    const opened = await decryptPgpMimeMessage(
      sealed.raw,
      researcherPrivateKey,
    );
    expect(opened.bodyText).toBe("Confidential remediation details.");
    expect(opened.attachmentCount).toBe(0);
  });

  it("adds RFC reply headers without changing the visible thread subject", async () => {
    const sealed = await buildPgpMimeMessage({
      from: "researcher@codevault.test",
      to: ["security@vendor.test"],
      cc: [],
      subject: "Re: Existing private thread",
      bodyText: "Requested detail.",
      attachments: [],
      cryptoMode: "PLAIN",
      recipientPublicKeys: [],
      messageId: "<follow-up@codevault.local>",
      threading: {
        inReplyTo: "<vendor-reply@vendor.test>",
        references: ["<initial@codevault.local>", "<vendor-reply@vendor.test>"],
      },
    });
    const raw = Buffer.from(sealed.raw).toString("utf8");
    expect(raw).toContain("Subject: Re: Existing private thread");
    expect(raw).toContain("In-Reply-To: <vendor-reply@vendor.test>");
    expect(raw).toContain(
      "References: <initial@codevault.local> <vendor-reply@vendor.test>",
    );
  });

  it("unlocks an encrypted private key in memory and rejects a wrong passphrase", async () => {
    const unlocked = await unlockPrivateKey(
      encryptedResearcherPrivateKey,
      "correct test passphrase",
    );
    expect(unlocked.isDecrypted()).toBe(true);
    await expect(
      unlockPrivateKey(encryptedResearcherPrivateKey, "wrong passphrase"),
    ).rejects.toThrow("not accepted");
  });
});
