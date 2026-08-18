import path from "node:path";

import { simpleParser, type AddressObject } from "mailparser";

const MAX_RAW_BYTES = 35 * 1024 * 1024;
const MAX_BODY_CHARACTERS = 1_000_000;
const MAX_ATTACHMENTS = 100;

export interface ParsedInboundAttachment {
  filename: string;
  contentType: string;
  content: Uint8Array;
}

export interface ParsedInboundMessage {
  rfcMessageId: string;
  inReplyTo: string | null;
  references: string[];
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string | null;
  encrypted: boolean;
  receivedAt: string;
  attachments: ParsedInboundAttachment[];
}

function addresses(
  value: AddressObject | AddressObject[] | undefined,
): string[] {
  const objects =
    value === undefined ? [] : Array.isArray(value) ? value : [value];
  return objects.flatMap((object) =>
    object.value.flatMap((entry) => {
      const address = entry.address?.trim().toLowerCase();
      return address !== undefined &&
        address.length <= 320 &&
        /^[^\s@\r\n]+@[^\s@\r\n]+$/.test(address)
        ? [address]
        : [];
    }),
  );
}

function safeHeader(value: string | undefined, fallback: string): string {
  if (value === undefined || /[\r\n\0]/.test(value)) return fallback;
  return value.slice(0, 998);
}

function safeMessageId(
  value: string | undefined,
  providerMessageId: string,
): string {
  if (value !== undefined && /^<[^<>\r\n]{1,996}>$/.test(value)) return value;
  const safeProviderId = providerMessageId
    .replace(/[^A-Za-z0-9._-]/g, "")
    .slice(0, 200);
  return `<gmail-${safeProviderId || "unknown"}@provider.invalid>`;
}

function safeFilename(value: string | undefined, index: number): string {
  const normalized = (value ?? `attachment-${index + 1}`).replaceAll("\\", "/");
  const basename = path.posix
    .basename(normalized)
    // eslint-disable-next-line no-control-regex -- hostile MIME filenames may contain controls
    .replace(/[\u0000-\u001f\u007f]/g, "_");
  return (basename || `attachment-${index + 1}`).slice(0, 200);
}

export async function parseInboundMessage(
  raw: Uint8Array,
  context: { providerMessageId: string },
): Promise<ParsedInboundMessage> {
  if (raw.byteLength === 0 || raw.byteLength > MAX_RAW_BYTES) {
    throw new Error("Inbound message is empty or too large.");
  }
  const leadingHeaders =
    Buffer.from(raw.subarray(0, Math.min(raw.byteLength, 128 * 1024)))
      .toString("latin1")
      .split("\r\n\r\n", 1)[0]
      ?.replace(/\r\n[ \t]+/g, " ")
      .toLowerCase() ?? "";
  const encrypted =
    /content-type:\s*multipart\/encrypted\b/.test(leadingHeaders) &&
    /protocol\s*=\s*["']?application\/pgp-encrypted/.test(leadingHeaders);
  const parsed = await simpleParser(Buffer.from(raw), {
    skipHtmlToText: false,
    skipTextToHtml: true,
    skipImageLinks: true,
    skipTextLinks: true,
    maxHtmlLengthToParse: MAX_BODY_CHARACTERS,
  });
  const from = addresses(parsed.from)[0];
  const to = addresses(parsed.to);
  if (from === undefined || to.length === 0) {
    throw new Error("Inbound message is missing a required envelope address.");
  }
  if (parsed.attachments.length > MAX_ATTACHMENTS) {
    throw new Error("Inbound message has too many attachments.");
  }
  const references = (
    Array.isArray(parsed.references)
      ? parsed.references
      : parsed.references === undefined
        ? []
        : [parsed.references]
  ).filter((value): value is string => /^<[^<>\r\n]{1,996}>$/.test(value));
  const inReplyTo = Array.isArray(parsed.inReplyTo)
    ? parsed.inReplyTo[0]
    : parsed.inReplyTo;
  const body = encrypted
    ? null
    : (parsed.text ?? "")
        // html-to-text represents image-only sources as bracketed URLs. Drop
        // those standalone tracking-pixel remnants while preserving ordinary
        // links that appear in prose or in a real text/plain part.
        .replace(/(?:^|\n)\s*\[https?:\/\/[^\]\n]+\]\s*(?=\n|$)/gi, "\n")
        .trim()
        .slice(0, MAX_BODY_CHARACTERS);

  return {
    rfcMessageId: safeMessageId(parsed.messageId, context.providerMessageId),
    inReplyTo:
      inReplyTo !== undefined && /^<[^<>\r\n]{1,996}>$/.test(inReplyTo)
        ? inReplyTo
        : null,
    references,
    from,
    to,
    cc: addresses(parsed.cc),
    subject: safeHeader(parsed.subject, "(no subject)"),
    bodyText: body,
    encrypted,
    receivedAt: (parsed.date ?? new Date()).toISOString(),
    attachments: encrypted
      ? []
      : parsed.attachments.map((attachment, index) => ({
          filename: safeFilename(attachment.filename, index),
          contentType: safeHeader(
            attachment.contentType,
            "application/octet-stream",
          ).slice(0, 200),
          content: new Uint8Array(attachment.content),
        })),
  };
}
