import { createHash, timingSafeEqual } from "node:crypto";

import type { SubmissionSealIntent } from "@codevault/contracts";

import { buildPgpMimeMessage } from "../crypto/openpgp-message.js";
interface CompleteSealRequest {
  intentId: string;
  sha256: string;
  sizeBytes: number;
  rfcMessageId: string | null;
}

export interface BuildEmailPackageOptions {
  intent: SubmissionSealIntent;
  senderAddress: string;
  messageId: string;
  signingPrivateKey?: string | null;
  fetchImpl: (
    input: string,
    init?: {
      method?: string;
      headers?: Record<string, string>;
      body?: Uint8Array;
    },
  ) => Promise<Response>;
  complete: (request: CompleteSealRequest) => Promise<{ id: string }>;
  confirm?: (summary: {
    sha256: string;
    sizeBytes: number;
    messageId: string;
  }) => Promise<boolean>;
  date?: Date;
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function equalDigest(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

export async function buildAndSealEmailPackage(
  options: BuildEmailPackageOptions,
) {
  const route = options.intent.manifest.routeSnapshot.route;
  if (route.type !== "EMAIL")
    throw new Error("The seal intent is not an email route.");
  const attachments = [];
  for (const item of options.intent.attachments) {
    const response = await options.fetchImpl(item.downloadUrl);
    if (!response.ok) throw new Error(`Could not download ${item.filename}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (
      bytes.byteLength !== item.sizeBytes ||
      !equalDigest(digest(bytes), item.sha256)
    ) {
      throw new Error(
        `Attachment digest verification failed for ${item.filename}.`,
      );
    }
    attachments.push({
      filename: item.filename,
      mimeType: item.mimeType,
      bytes,
      sha256: item.sha256,
    });
  }
  const sealed = await buildPgpMimeMessage({
    from: options.senderAddress,
    to: route.to,
    cc: route.cc,
    subject: options.intent.subject,
    bodyText: options.intent.bodyText,
    attachments,
    cryptoMode: options.intent.cryptoMode,
    recipientPublicKeys:
      options.intent.publicKey === null
        ? []
        : [options.intent.publicKey.armoredKey],
    signingPrivateKey: options.signingPrivateKey ?? null,
    messageId: options.messageId,
    threading: options.intent.manifest.threading,
    ...(options.date === undefined ? {} : { date: options.date }),
  });
  if (
    options.confirm !== undefined &&
    !(await options.confirm({
      sha256: sealed.sha256,
      sizeBytes: sealed.raw.byteLength,
      messageId: options.messageId,
    }))
  ) {
    throw new Error("Sealing was cancelled.");
  }
  const upload = await options.fetchImpl(options.intent.uploadUrl, {
    method: "PUT",
    headers: { "content-type": "message/rfc822" },
    body: sealed.raw,
  });
  if (!upload.ok)
    throw new Error("The sealed email package could not be uploaded.");
  const completed = await options.complete({
    intentId: options.intent.id,
    sha256: sealed.sha256,
    sizeBytes: sealed.raw.byteLength,
    rfcMessageId: options.messageId,
  });
  return {
    bytes: sealed.raw,
    sha256: sealed.sha256,
    packageId: completed.id,
    messageId: options.messageId,
  };
}
