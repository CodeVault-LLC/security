import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { SubmissionSealIntent } from "@codevault/contracts";

import { buildAndSealManualPackage } from "./manual-package.js";

const attachment = new TextEncoder().encode("verified report bytes");
const attachmentSha = createHash("sha256").update(attachment).digest("hex");

const intent: SubmissionSealIntent = {
  id: "018f2f56-7c9a-7abc-8def-0123456789aa",
  submissionId: "018f2f56-7c9a-7abc-8def-0123456789ab",
  expiresAt: "2026-08-18T12:15:00.000Z",
  subject: "",
  bodyText: "Reproduction details",
  manualFields: { description: "Reproduction details" },
  attachments: [
    {
      artifactId: "018f2f56-7c9a-7abc-8def-0123456789ac",
      filename: "vendor-report.pdf",
      mimeType: "application/pdf",
      visibility: "VENDOR",
      status: "STORED",
      sizeBytes: attachment.byteLength,
      sha256: attachmentSha,
      sourceRevision: 2,
      downloadUrl: "https://objects.example.test/report",
    },
  ],
  cryptoMode: "PLAIN",
  publicKey: null,
  manifest: {
    version: 1,
    submissionId: "018f2f56-7c9a-7abc-8def-0123456789ab",
    submissionRevision: 4,
    routeSnapshot: {
      routeId: "018f2f56-7c9a-7abc-8def-0123456789ad",
      routeRevision: 1,
      vendorId: "018f2f56-7c9a-7abc-8def-0123456789ae",
      capturedAt: "2026-08-18T12:00:00.000Z",
      route: {
        name: "Portal",
        type: "MANUAL",
        destinationUrl: "https://security.example.test/report",
        fieldMappings: [],
        acceptedExtensions: [".pdf"],
        maximumFileBytes: 1_000_000,
        maximumFileCount: 2,
        acknowledgementBusinessDays: 5,
        updateCadenceDays: null,
        instructions: null,
      },
    },
    subject: "",
    bodyUtf8Sha256: createHash("sha256")
      .update("Reproduction details")
      .digest("hex"),
    attachments: [],
    cryptoMode: "PLAIN",
    publicKeyFingerprint: null,
    threading: null,
    sources: [],
    createdAt: "2026-08-18T12:00:00.000Z",
  },
  manifestSha256: "a".repeat(64),
  uploadUrl: "https://objects.example.test/package",
  senderAddress: null,
};

describe("manual submission package", () => {
  it("verifies every download before uploading and sealing the exact ZIP", async () => {
    const complete = vi.fn(async () => ({ id: "package-id" }));
    const upload = vi.fn(async (_url: string) =>
      Promise.resolve(new Response(null, { status: 200 })),
    );

    const result = await buildAndSealManualPackage({
      intent,
      fetchImpl: vi.fn(async (url) =>
        url === intent.attachments[0]?.downloadUrl
          ? new Response(attachment)
          : upload(url),
      ),
      complete,
    });

    expect(result.bytes.byteLength).toBeGreaterThan(attachment.byteLength);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        intentId: intent.id,
        sizeBytes: result.bytes.byteLength,
        sha256: result.sha256,
      }),
    );
  });

  it("does not upload when a signed download fails digest verification", async () => {
    const complete = vi.fn();
    const tampered = attachment.slice();
    tampered[0] = tampered[0] === 0 ? 1 : 0;
    const fetchImpl = vi.fn(async () => new Response(tampered));

    await expect(
      buildAndSealManualPackage({ intent, fetchImpl, complete }),
    ).rejects.toThrow("digest");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
  });
});
