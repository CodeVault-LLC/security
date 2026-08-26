import type { CorrespondenceMessage } from "@codevault/contracts";

export interface CorrespondenceTranscriptInput {
  submissionId: string;
  generatedAt: string;
  messages: readonly CorrespondenceMessage[];
  localPlaintext: Readonly<Record<string, string>>;
}

/** Builds a portable transcript without hiding unavailable encrypted bodies. */
export function buildCorrespondenceTranscript(
  input: CorrespondenceTranscriptInput,
): string {
  const parts = [
    "# Vendor correspondence transcript",
    `**Submission:** ${escapeInline(input.submissionId)}  \n**Generated:** ${escapeInline(input.generatedAt)}  \n**Messages:** ${input.messages.length}`,
  ];

  input.messages.forEach((message, index) => {
    const timestamp = message.receivedAt ?? message.sentAt ?? message.createdAt;
    const metadata = [
      ["Direction", titleCase(message.direction)],
      ["Timestamp", timestamp],
      ["Classification", titleCase(message.classification)],
      ["From", message.from],
      ["To", message.to.join(", ")],
      ...(message.cc.length === 0 ? [] : [["Cc", message.cc.join(", ")]]),
      ["Encrypted", message.encrypted ? "Yes" : "No"],
      ["Message ID", message.rfcMessageId],
    ];
    const body = input.localPlaintext[message.id] ?? message.bodyText;
    const bodyBlock =
      body === null
        ? "_Encrypted body not included. Decrypt it locally before exporting to include the plaintext._"
        : fencedPlaintext(body);
    const attachments =
      message.attachments.length === 0
        ? ""
        : `\n\n**Attachments**\n\n${message.attachments
            .map(
              (attachment) =>
                `- ${escapeInline(attachment.filename)} · ${attachment.sizeBytes} bytes · sha256 ${attachment.sha256.slice(0, 12)}`,
            )
            .join("\n")}`;

    parts.push(
      `## ${index + 1}. ${escapeInline(message.subject)}`,
      `${metadata
        .map(([label, value]) => `**${label}:** ${escapeInline(value ?? "")}`)
        .join("  \n")}\n\n**Body**\n\n${bodyBlock}${attachments}`,
    );
  });

  return `${parts.join("\n\n")}\n`;
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./u, (first) => first.toUpperCase());
}

function escapeInline(value: string): string {
  return value
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/([\\`*_[\]<>])/gu, "\\$1");
}

function fencedPlaintext(value: string): string {
  const delimiter = "`".repeat(Math.max(3, longestBacktickRun(value) + 1));
  return `${delimiter}text\n${value}\n${delimiter}`;
}

function longestBacktickRun(value: string): number {
  let longest = 0;
  let current = 0;

  for (const character of value) {
    if (character === "`") {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }

  return longest;
}
