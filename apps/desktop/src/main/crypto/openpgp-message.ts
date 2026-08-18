import { createHash } from "node:crypto";

import MailComposer from "nodemailer/lib/mail-composer/index.js";
import {
  createMessage,
  encrypt,
  readKey,
  readPrivateKey,
  type PrivateKey,
} from "openpgp";

export interface MimeAttachment {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  sha256: string;
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
