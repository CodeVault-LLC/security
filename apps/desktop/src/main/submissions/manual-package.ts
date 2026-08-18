import { createHash, timingSafeEqual } from "node:crypto";

import { zipSync } from "fflate";

import type { SubmissionSealIntent } from "@codevault/contracts";

export interface CompleteManualSealRequest {
  intentId: string;
  sha256: string;
  sizeBytes: number;
  rfcMessageId: null;
}

export interface BuiltManualPackage {
  bytes: Uint8Array;
  sha256: string;
  packageId: string;
}

export interface BuildManualPackageOptions {
  intent: SubmissionSealIntent;
  fetchImpl: (
    input: string,
    init?: {
      method?: string;
      headers?: Record<string, string>;
      body?: Uint8Array;
    },
  ) => Promise<Response>;
  complete: (request: CompleteManualSealRequest) => Promise<{ id: string }>;
  /** Persists the exact bytes before their one-time intent is consumed. */
  beforeUpload?: (bytes: Uint8Array, sha256: string) => Promise<void>;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function digestMatches(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return (
    actualBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

function safeFilename(value: string): string {
  const normalized = value.normalize("NFKC").replaceAll("\\", "/");
  const basename = normalized.split("/").at(-1) ?? "attachment";
  const printable = [...basename]
    .map((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point <= 0x1f || point === 0x7f ? "_" : character;
    })
    .join("");
  const safe = printable.replace(/^\.+$/, "attachment").slice(0, 180);
  return safe.length === 0 ? "attachment" : safe;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Package data is not JSON-safe.");
  return encoded;
}

function submissionText(intent: SubmissionSealIntent): string {
  const fields = Object.entries(intent.manualFields)
    .map(([key, value]) => `## ${key}\n\n${value}`)
    .join("\n\n");
  return [
    intent.subject.length === 0 ? null : `# ${intent.subject}`,
    intent.bodyText,
    fields,
  ]
    .filter((value): value is string => value !== null && value.length > 0)
    .join("\n\n");
}

/**
 * Builds and uploads the exact manual bundle represented by a seal intent.
 *
 * Signed URLs are capabilities, not evidence: every download is checked
 * against the server-authenticated descriptor before it enters the archive,
 * and the server independently verifies the final upload before consuming the
 * one-time intent.
 */
export async function buildAndSealManualPackage(
  options: BuildManualPackageOptions,
): Promise<BuiltManualPackage> {
  const { intent, fetchImpl } = options;
  const entries: Record<string, Uint8Array> = {};
  const encoder = new TextEncoder();

  entries["submission.txt"] = encoder.encode(submissionText(intent));
  entries["manifest.json"] = encoder.encode(`${stableJson(intent.manifest)}\n`);

  for (const [key, value] of Object.entries(intent.manualFields)) {
    entries[`route-fields/${safeFilename(key)}.txt`] = encoder.encode(value);
  }

  for (const attachment of intent.attachments) {
    const response = await fetchImpl(attachment.downloadUrl);
    if (!response.ok) {
      throw new Error(`Could not download ${attachment.filename}.`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== attachment.sizeBytes) {
      throw new Error(
        `Attachment size verification failed for ${attachment.filename}.`,
      );
    }
    const actualDigest = sha256(bytes);
    if (!digestMatches(actualDigest, attachment.sha256)) {
      throw new Error(
        `Attachment digest verification failed for ${attachment.filename}.`,
      );
    }
    entries[
      `attachments/${attachment.artifactId}-${safeFilename(attachment.filename)}`
    ] = bytes;
  }

  entries["SHA256SUMS"] = encoder.encode(
    `${Object.entries(entries)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, bytes]) => `${sha256(bytes)}  ${path}`)
      .join("\n")}\n`,
  );

  const bytes = zipSync(entries, {
    level: 0,
    mtime: new Date("1980-01-01T00:00:00.000Z"),
  });
  const packageSha256 = sha256(bytes);
  await options.beforeUpload?.(bytes, packageSha256);
  const upload = await fetchImpl(intent.uploadUrl, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: bytes,
  });
  if (!upload.ok)
    throw new Error("The sealed manual package could not be uploaded.");

  const completed = await options.complete({
    intentId: intent.id,
    sha256: packageSha256,
    sizeBytes: bytes.byteLength,
    rfcMessageId: null,
  });
  return { bytes, sha256: packageSha256, packageId: completed.id };
}
