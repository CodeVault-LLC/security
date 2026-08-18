import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import { isUuid } from "@codevault/core";

import { AI_ACTION_IDS, AI_TARGET_TYPES } from "./ai.js";
import { CreateAssetRequest } from "./assets.js";
import { MailboxConnection } from "./mail.js";
import {
  SubmissionPackageManifest,
  SubmissionValidationFinding,
} from "./submissions.js";
import { CreateVendorRouteRequest } from "./vendors.js";

FormatRegistry.Set("uuid", isUuid);
FormatRegistry.Set("date-time", (value) => Number.isFinite(Date.parse(value)));

const UUID = "018f47d2-7d20-7a31-8fb8-9d5f3d680001";
const OTHER_UUID = "018f47d2-7d20-7a31-8fb8-9d5f3d680002";

function emailRoute(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

describe("vendor route contracts", () => {
  it("rejects an email route that requires encryption without a key", () => {
    expect(
      Value.Check(
        CreateVendorRouteRequest,
        emailRoute({ encryptionPolicy: "REQUIRED" }),
      ),
    ).toBe(false);

    expect(
      Value.Check(
        CreateVendorRouteRequest,
        emailRoute({ encryptionPolicy: "REQUIRED", publicKeyId: UUID }),
      ),
    ).toBe(true);
  });

  it("rejects header injection and recipient fan-out", () => {
    expect(
      Value.Check(
        CreateVendorRouteRequest,
        emailRoute({
          to: ["security@example.com\r\nBcc: attacker@example.net"],
        }),
      ),
    ).toBe(false);
    expect(
      Value.Check(
        CreateVendorRouteRequest,
        emailRoute({
          to: Array.from(
            { length: 11 },
            (_, index) => `team${index}@example.com`,
          ),
        }),
      ),
    ).toBe(false);
  });
});

describe("submission and mail contracts", () => {
  it("requires validation findings to use stable codes and bounded fields", () => {
    expect(
      Value.Check(SubmissionValidationFinding, {
        severity: "BLOCKING",
        code: "ATTACHMENT_VISIBILITY_VIOLATION",
        field: "attachments.0",
        message: "Internal artifacts cannot be sent to a vendor.",
      }),
    ).toBe(true);
    expect(
      Value.Check(SubmissionValidationFinding, {
        severity: "CRITICAL",
        code: "free form code",
        field: "attachments.0",
        message: "bad",
      }),
    ).toBe(false);
  });

  it("accepts version 4 and version 6 OpenPGP fingerprints in manifests", () => {
    const fingerprint =
      SubmissionPackageManifest.properties.publicKeyFingerprint;

    expect(Value.Check(fingerprint, "A".repeat(40))).toBe(true);
    expect(Value.Check(fingerprint, "B".repeat(64))).toBe(true);
    expect(Value.Check(fingerprint, "c".repeat(64))).toBe(false);
  });

  it("never permits an OAuth token in a mailbox response", () => {
    const connection = {
      id: UUID,
      provider: "gmail",
      emailAddress: "researcher@example.com",
      status: "ACTIVE",
      capabilities: ["SEND"],
      lastSuccessfulSyncAt: null,
      watchExpiresAt: null,
      errorCategory: null,
      createdAt: "2026-08-18T10:00:00.000Z",
      updatedAt: "2026-08-18T10:00:00.000Z",
      revision: 1,
    };

    expect(Value.Check(MailboxConnection, connection)).toBe(true);
    expect(
      Value.Check(MailboxConnection, {
        ...connection,
        refreshToken: "must-never-cross-the-API",
      }),
    ).toBe(false);
  });
});

describe("related contract extensions", () => {
  it("accepts vendor IDs for assets and rejects legacy free-text writes", () => {
    expect(
      Value.Check(CreateAssetRequest, {
        name: "Example appliance",
        kind: "DEVICE",
        vendorId: OTHER_UUID,
      }),
    ).toBe(true);
    expect(
      Value.Check(CreateAssetRequest, {
        name: "Example appliance",
        kind: "DEVICE",
        vendor: "Example Corp",
      }),
    ).toBe(false);
  });

  it("exposes proposal-only submission AI actions and targets", () => {
    expect(AI_ACTION_IDS).toEqual(
      expect.arrayContaining([
        "SUBMISSION_DRAFT_INITIAL",
        "SUBMISSION_DRAFT_FOLLOW_UP",
        "SUBMISSION_CLASSIFY_REPLY",
        "SUBMISSION_SUMMARIZE_THREAD",
        "SUBMISSION_LEAK_REVIEW",
      ]),
    );
    expect(AI_TARGET_TYPES).toEqual(
      expect.arrayContaining(["SUBMISSION", "CORRESPONDENCE_MESSAGE"]),
    );
  });
});
