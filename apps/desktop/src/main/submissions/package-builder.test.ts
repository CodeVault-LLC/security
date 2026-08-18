import { createHash } from "node:crypto";

import { expect, it, vi } from "vitest";

import type { SubmissionSealIntent } from "@codevault/contracts";

import { buildAndSealEmailPackage } from "./package-builder.js";

it("uploads and completes the exact RFC message bytes", async () => {
  const bytes = new TextEncoder().encode("report bytes");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const intent = {
    id: "018f2f56-7c9a-7abc-8def-0123456789aa",
    submissionId: "018f2f56-7c9a-7abc-8def-0123456789ab",
    subject: "Security report",
    bodyText: "Please review the attached report.",
    attachments: [
      {
        artifactId: "018f2f56-7c9a-7abc-8def-0123456789ac",
        filename: "report.txt",
        mimeType: "text/plain",
        visibility: "VENDOR",
        status: "STORED",
        sizeBytes: bytes.byteLength,
        sha256,
        sourceRevision: 1,
        downloadUrl: "https://objects.example.test/report",
      },
    ],
    cryptoMode: "PLAIN",
    publicKey: null,
    manifest: {
      routeSnapshot: {
        route: {
          type: "EMAIL",
          to: ["security@vendor.test"],
          cc: [],
        },
      },
    },
    uploadUrl: "https://objects.example.test/sealed",
  } as unknown as SubmissionSealIntent;
  let uploaded: Uint8Array | null = null;
  const complete = vi.fn(async () => ({ id: "package-id" }));
  const result = await buildAndSealEmailPackage({
    intent,
    senderAddress: "researcher@codevault.test",
    messageId: "<submission-1@codevault.local>",
    fetchImpl: async (url, init) => {
      if (url === intent.attachments[0]?.downloadUrl)
        return new Response(bytes);
      uploaded = init?.body ?? null;
      return new Response(null, { status: 200 });
    },
    complete,
  });
  expect(uploaded).toEqual(result.bytes);
  expect(complete).toHaveBeenCalledWith({
    intentId: intent.id,
    sha256: result.sha256,
    sizeBytes: result.bytes.byteLength,
    rfcMessageId: "<submission-1@codevault.local>",
  });
});
