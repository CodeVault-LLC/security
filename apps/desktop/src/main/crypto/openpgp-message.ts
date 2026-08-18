import { createHash } from "node:crypto";

import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { simpleParser } from "mailparser";
import {
  createMessage,
  decrypt,
  decryptKey,
  encrypt,
  readKey,
  readPrivateKey,
  readMessage,
  type PrivateKey,
} from "openpgp";

export interface MimeAttachment {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  sha256: string;
}

export interface DecryptedPgpMimeMessage {
  bodyText: string;
  attachmentCount: number;
}

/** Decrypts one RFC 3156 payload locally and returns text only, never HTML. */
export async function decryptPgpMimeMessage(
  raw: Uint8Array,
  privateKey: string | PrivateKey,
): Promise<DecryptedPgpMimeMessage> {
  if (raw.byteLength > 100 * 1024 * 1024) {
    throw new Error("Encrypted message is too large to decrypt safely.");
  }
  const text = Buffer.from(raw).toString("utf8");
  const begin = text.indexOf("-----BEGIN PGP MESSAGE-----");
  const endMarker = "-----END PGP MESSAGE-----";
  const end = text.indexOf(endMarker, begin);
  if (
    begin < 0 ||
    end < begin ||
    text.indexOf("-----BEGIN PGP MESSAGE-----", begin + 1) >= 0
  ) {
    throw new Error(
      "The message does not contain exactly one OpenPGP payload.",
    );
  }
  const opened = await decrypt({
    message: await readMessage({
      armoredMessage: text.slice(begin, end + endMarker.length),
    }),
    decryptionKeys:
      typeof privateKey === "string"
        ? await readPrivateKey({ armoredKey: privateKey })
        : privateKey,
    format: "binary",
  });
  const parsed = await simpleParser(Buffer.from(opened.data), {
    skipHtmlToText: false,
    skipTextToHtml: true,
    skipImageLinks: true,
    skipTextLinks: true,
    maxHtmlLengthToParse: 1_000_000,
  });
  return {
    bodyText: (parsed.text ?? "").trim().slice(0, 1_000_000),
    attachmentCount: parsed.attachments.length,
  };
}

/** Unlocks an armored private key without retaining or returning a passphrase. */
export async function unlockPrivateKey(
  armoredPrivateKey: string,
  passphrase?: string,
): Promise<PrivateKey> {
  const privateKey = await readPrivateKey({ armoredKey: armoredPrivateKey });
  if (privateKey.isDecrypted()) return privateKey;
  if (passphrase === undefined || passphrase.length === 0) {
    throw new Error("This OpenPGP private key requires a passphrase.");
  }
  try {
    return await decryptKey({ privateKey, passphrase });
  } catch {
    throw new Error("The OpenPGP private-key passphrase was not accepted.");
  }
}

export interface BuildPgpMimeInput {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string;
  attachments: MimeAttachment[];
  cryptoMode: "PLAIN" | "ENCRYPTED" | "SIGNED_AND_ENCRYPTED";
  recipientPublicKeys: string[];
  signingPrivateKey?: string | PrivateKey | null;
  messageId: string;
  threading?: {
    inReplyTo: string;
    references: string[];
  } | null;
  date?: Date;
}

export interface SealedMimeMessage {
  raw: Uint8Array;
  messageId: string;
  sha256: string;
}

function header(value: string): string {
  if (/\r|\n/.test(value))
    throw new Error("MIME headers cannot contain line breaks.");
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function crlf(value: string): string {
  return value.replace(/\r?\n/g, "\r\n");
}

async function innerEntity(input: BuildPgpMimeInput): Promise<Uint8Array> {
  const composer = new MailComposer({
    text: input.bodyText,
    attachments: input.attachments.map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.mimeType,
      content: Buffer.from(attachment.bytes),
      headers: { "X-CodeVault-SHA256": attachment.sha256 },
    })),
  });
  const built = await composer.compile().build();
  return new TextEncoder().encode(crlf(built.toString("utf8")));
}

function outerHeaders(input: BuildPgpMimeInput): string[] {
  return [
    `From: ${header(input.from)}`,
    `To: ${input.to.map(header).join(", ")}`,
    ...(input.cc.length === 0
      ? []
      : [`Cc: ${input.cc.map(header).join(", ")}`]),
    `Subject: ${header(input.subject)}`,
    `Date: ${(input.date ?? new Date()).toUTCString()}`,
    `Message-ID: ${header(input.messageId)}`,
    ...(input.threading === undefined || input.threading === null
      ? []
      : [
          `In-Reply-To: ${header(input.threading.inReplyTo)}`,
          `References: ${input.threading.references.map(header).join(" ")}`,
        ]),
    "MIME-Version: 1.0",
  ];
}

/** Builds RFC 3156 PGP/MIME; the visible subject is deliberately outside PGP. */
export async function buildPgpMimeMessage(
  input: BuildPgpMimeInput,
): Promise<SealedMimeMessage> {
  const inner = await innerEntity(input);
  let raw: Uint8Array;

  if (input.cryptoMode === "PLAIN") {
    const built = await new MailComposer({
      from: input.from,
      to: input.to,
      cc: input.cc,
      subject: input.subject,
      messageId: input.messageId,
      ...(input.threading === undefined || input.threading === null
        ? {}
        : {
            inReplyTo: input.threading.inReplyTo,
            references: input.threading.references,
          }),
      date: input.date ?? new Date(),
      text: input.bodyText,
      attachments: input.attachments.map((attachment) => ({
        filename: attachment.filename,
        contentType: attachment.mimeType,
        content: Buffer.from(attachment.bytes),
        headers: { "X-CodeVault-SHA256": attachment.sha256 },
      })),
    })
      .compile()
      .build();
    raw = new TextEncoder().encode(crlf(built.toString("utf8")));
  } else {
    if (input.recipientPublicKeys.length === 0) {
      throw new Error("Encrypted PGP/MIME requires a recipient public key.");
    }
    const encryptionKeys = await Promise.all(
      input.recipientPublicKeys.map((armoredKey) => readKey({ armoredKey })),
    );
    const signingKeys =
      input.cryptoMode !== "SIGNED_AND_ENCRYPTED"
        ? undefined
        : typeof input.signingPrivateKey === "string"
          ? await readPrivateKey({ armoredKey: input.signingPrivateKey })
          : (input.signingPrivateKey ?? undefined);
    if (
      input.cryptoMode === "SIGNED_AND_ENCRYPTED" &&
      signingKeys === undefined
    ) {
      throw new Error("Signed encryption requires a local signing key.");
    }
    const armored = await encrypt({
      message: await createMessage({ binary: inner }),
      encryptionKeys,
      ...(signingKeys === undefined ? {} : { signingKeys }),
      format: "armored",
      date: input.date ?? new Date(),
    });
    const boundary = `codevault-${createHash("sha256").update(input.messageId).digest("hex").slice(0, 32)}`;
    const lines = [
      ...outerHeaders(input),
      `Content-Type: multipart/encrypted; protocol="application/pgp-encrypted"; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: application/pgp-encrypted",
      "Content-Transfer-Encoding: 7bit",
      "",
      "Version: 1",
      "",
      `--${boundary}`,
      'Content-Type: application/octet-stream; name="encrypted.asc"',
      "Content-Disposition: inline; filename=encrypted.asc",
      "Content-Transfer-Encoding: 7bit",
      "",
      crlf(armored),
      `--${boundary}--`,
      "",
    ];
    raw = new TextEncoder().encode(lines.join("\r\n"));
  }

  return {
    raw,
    messageId: input.messageId,
    sha256: createHash("sha256").update(raw).digest("hex"),
  };
}
