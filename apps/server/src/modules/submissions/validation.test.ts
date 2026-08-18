import { describe, expect, it } from "vitest";

import type { SubmissionValidationInput } from "./validation.js";
import { validateSubmission } from "./validation.js";

const ARTIFACT_ID = "018f2f56-7c9a-7abc-8def-0123456789ab";
const ROUTE_ID = "018f2f56-7c9a-7abc-8def-0123456789ac";
const VENDOR_ID = "018f2f56-7c9a-7abc-8def-0123456789ad";

function baseInput(
  patch: Partial<SubmissionValidationInput> = {},
): SubmissionValidationInput {
  return {
    submissionId: "018f2f56-7c9a-7abc-8def-0123456789ae",
    revision: 1,
    routeSnapshot: {
      routeId: ROUTE_ID,
      routeRevision: 1,
      vendorId: VENDOR_ID,
      capturedAt: "2026-08-18T00:00:00.000Z",
      route: {
        name: "PSIRT email",
        type: "EMAIL",
        to: ["security@example.com"],
        cc: [],
        subjectTemplate: "Security report: {caseRef}",
        encryptionPolicy: "OPTIONAL",
        publicKeyId: null,
        maximumAttachmentBytes: 20 * 1024 * 1024,
        acknowledgementBusinessDays: 5,
        updateCadenceDays: 42,
        requiredFields: ["affected_product", "reproduction", "impact"],
        sourceUrl: "https://example.com/security",
        sourceReviewedAt: "2026-08-18T00:00:00.000Z",
      },
    },
    subject: "Security report: CASE-2026-0001",
    bodyMarkdown: "Affected product\n\nReproduction steps\n\nImpact",
    manualFields: {},
    cryptoMode: "PLAIN",
    attachments: [],
    requiredFieldContent: {
      affected_product: true,
      reproduction: true,
      impact: true,
    },
    approvedVendorReport: true,
    completedReportExport: true,
    aiDraftReviewed: true,
    publicKey: null,
    gmailConnectionAvailable: true,
    estimatedFinalMimeBytes: 1_000,
    disclosureAllowed: true,
    tlpAllowsVendor: true,
    checkedAt: "2026-08-18T12:00:00.000Z",
    ...patch,
  };
}

describe("submission validation", () => {
  it("blocks an internal artifact from a vendor submission", () => {
    const result = validateSubmission(
      baseInput({
        attachments: [
          {
            artifactId: ARTIFACT_ID,
            filename: "internal-notes.txt",
            mimeType: "text/plain",
            visibility: "INTERNAL",
            status: "STORED",
            sizeBytes: 10,
            sha256: "a".repeat(64),
            sourceRevision: 1,
            currentSourceRevision: 1,
            pocApprovedForVendor: true,
          },
        ],
      }),
    );

    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "ATTACHMENT_VISIBILITY_VIOLATION",
        severity: "BLOCKING",
      }),
    );
  });

  it("warns that a PGP subject remains visible", () => {
    const result = validateSubmission(
      baseInput({
        cryptoMode: "ENCRYPTED",
        publicKey: {
          id: ARTIFACT_ID,
          verified: true,
          expired: false,
          revoked: false,
          superseded: false,
          fingerprint: "A".repeat(40),
        },
      }),
    );

    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: "SUBJECT_NOT_ENCRYPTED" }),
    );
  });

  it("blocks stale source revisions and unapproved proof-of-concept files", () => {
    const result = validateSubmission(
      baseInput({
        attachments: [
          {
            artifactId: ARTIFACT_ID,
            filename: "exploit.exe",
            mimeType: "application/octet-stream",
            visibility: "VENDOR",
            status: "STORED",
            sizeBytes: 10,
            sha256: "b".repeat(64),
            sourceRevision: 1,
            currentSourceRevision: 2,
            pocApprovedForVendor: false,
          },
        ],
      }),
    );

    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "ATTACHMENT_SOURCE_CHANGED",
        "POC_VENDOR_APPROVAL_REQUIRED",
        "GMAIL_BLOCKED_EXTENSION",
      ]),
    );
  });

  it("blocks required encryption without a verified current key", () => {
    const input = baseInput();
    if (input.routeSnapshot.route.type !== "EMAIL") throw new Error("fixture");
    input.routeSnapshot.route.encryptionPolicy = "REQUIRED";
    input.routeSnapshot.route.publicKeyId = ARTIFACT_ID;
    input.cryptoMode = "ENCRYPTED";

    const result = validateSubmission(input);

    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: "ENCRYPTION_KEY_MISSING" }),
    );
    expect(result.blocking).toBe(true);
  });
});
