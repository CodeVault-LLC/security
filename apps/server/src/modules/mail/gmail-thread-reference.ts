import type { ProviderMessageMetadata } from "./provider.js";

const THREAD_ID = /^[A-Za-z0-9_-]{1,500}$/;
const EMAIL = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+/gi;

export interface GmailThreadMessagePreview {
  providerMessageId: string;
  direction: "OUTBOUND" | "INBOUND";
  from: string;
  to: string[];
  subject: string;
  occurredAt: string | null;
}

export function parseGmailThreadReference(reference: string): string {
  const trimmed = reference.trim();
  if (THREAD_ID.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Enter a Gmail thread URL or thread ID.");
  }
  if (url.protocol !== "https:" || url.hostname !== "mail.google.com") {
    throw new Error("The thread URL must come from mail.google.com.");
  }
  throw new Error(
    "Gmail browser links cannot identify an API thread. Search sent Gmail and choose a result.",
  );
}

function header(
  metadata: ProviderMessageMetadata,
  name: string,
  fallback = "",
): string {
  const value = metadata.headers.find(
    (item) => item.name.toLowerCase() === name.toLowerCase(),
  )?.value;
  if (value === undefined || /[\r\n\0]/.test(value)) return fallback;
  return value.slice(0, 998);
}

function addresses(value: string): string[] {
  return [...value.matchAll(EMAIL)].map((match) => match[0]!.toLowerCase());
}

function timestamp(value: string): string | null {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
}

export function previewGmailMessage(
  metadata: ProviderMessageMetadata,
  mailboxAddress: string,
): GmailThreadMessagePreview {
  const fromHeader = header(metadata, "from", "(unknown sender)");
  const fromAddresses = addresses(fromHeader);
  const direction =
    metadata.labelIds.includes("SENT") ||
    fromAddresses.includes(mailboxAddress.toLowerCase())
      ? "OUTBOUND"
      : "INBOUND";

  return {
    providerMessageId: metadata.id,
    direction,
    from: fromHeader.slice(0, 998),
    to: addresses(header(metadata, "to")).slice(0, 100),
    subject: header(metadata, "subject", "(no subject)").slice(0, 300),
    occurredAt: timestamp(header(metadata, "date")),
  };
}

export function gmailThreadWarnings(input: {
  messages: GmailThreadMessagePreview[];
  mailboxAddress: string;
  routeRecipients: string[];
}): string[] {
  const expected = new Set(
    input.routeRecipients.map((value) => value.toLowerCase()),
  );
  const participants = new Set(
    input.messages.flatMap((message) => [
      ...addresses(message.from),
      ...message.to,
    ]),
  );
  participants.delete(input.mailboxAddress.toLowerCase());

  if (
    expected.size === 0 ||
    ![...expected].some((value) => participants.has(value))
  ) {
    return [
      "The thread participants do not match the saved vendor email route. Review them before linking.",
    ];
  }
  const unexpected = [...participants].filter((value) => !expected.has(value));
  return unexpected.length === 0
    ? []
    : [
        `The thread includes participants outside the saved vendor email route: ${unexpected.slice(0, 5).join(", ")}. Review them before linking.`,
      ];
}
