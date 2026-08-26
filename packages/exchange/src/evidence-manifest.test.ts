import { describe, expect, it } from "vitest";

import type { Evidence } from "@codevault/contracts";

import { buildEvidenceManifest } from "./evidence-manifest.js";

const actor = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Researcher",
  email: "researcher@example.test",
};

const evidence = {
  id: "22222222-2222-4222-8222-222222222222",
  ref: "EVD-2",
  caseId: "33333333-3333-4333-8333-333333333333",
  findingId: "44444444-4444-4444-8444-444444444444",
  title: "Request capture",
  descriptionMarkdown: "Shows the vulnerable request.",
  visibility: "INTERNAL",
  capturedAt: "2026-08-25T10:00:00.000Z",
  artifacts: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      caseId: "33333333-3333-4333-8333-333333333333",
      findingId: "44444444-4444-4444-8444-444444444444",
      filename: "capture.har",
      mimeType: "application/json",
      sizeBytes: 2048,
      sha256: "a".repeat(64),
      artifactKind: "HAR",
      visibility: "INTERNAL",
      status: "STORED",
      uploadedBy: actor,
      capturedAt: "2026-08-25T10:00:00.000Z",
      metadata: { z: 1, a: { y: true, x: false } },
      previewKind: "TEXT_EXCERPT",
      previewText: null,
      previewRedaction: null,
      createdAt: "2026-08-25T10:01:00.000Z",
    },
  ],
  createdBy: actor,
  createdAt: "2026-08-25T10:02:00.000Z",
  updatedAt: "2026-08-25T10:02:00.000Z",
  revision: 1,
} satisfies Evidence;

describe("evidence manifest", () => {
  it("builds a versioned digest inventory without download URLs or previews", () => {
    const manifest = buildEvidenceManifest({
      caseId: evidence.caseId,
      findingId: evidence.findingId,
      generatedAt: "2026-08-26T12:00:00.000Z",
      evidence: [evidence],
    });
    const parsed = JSON.parse(manifest) as Record<string, unknown>;

    expect(parsed).toMatchObject({
      format: "codevault.evidence-manifest",
      version: 1,
      counts: { evidence: 1, artifacts: 1, totalBytes: 2048 },
    });
    expect(manifest).toContain('"sha256": "' + "a".repeat(64));
    expect(manifest).toContain('"a": {\n              "x": false');
    expect(manifest).not.toContain("previewText");
    expect(manifest).not.toContain("url");
    expect(manifest.endsWith("\n")).toBe(true);
  });
});
