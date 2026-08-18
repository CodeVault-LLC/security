import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  SubmissionDetail,
  SubmissionValidationResult,
} from "@codevault/contracts";

import { ManualDeliveryPanel } from "./manual-delivery-panel.js";
import { PackageReview } from "./package-review.js";

const submission: SubmissionDetail = {
  id: "018f2f56-7c9a-7abc-8def-0123456789ab",
  ref: "SUB-2026-0001",
  caseId: "018f2f56-7c9a-7abc-8def-0123456789ac",
  vendor: {
    id: "018f2f56-7c9a-7abc-8def-0123456789ad",
    ref: "VND-000001",
    slug: "example-psirt",
    name: "Example PSIRT",
    websiteUrl: "https://example.test",
    builtIn: false,
    sourceUrl: "https://example.test/security",
    sourceReviewedAt: "2026-08-18T00:00:00.000Z",
    archivedAt: null,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    revision: 1,
  },
  routeId: "018f2f56-7c9a-7abc-8def-0123456789ae",
  status: "IN_REVIEW",
  coordinationState: "PREPARING",
  cryptoMode: "PLAIN",
  subject: "",
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
  revision: 3,
  routeSnapshot: {
    routeId: "018f2f56-7c9a-7abc-8def-0123456789ae",
    routeRevision: 1,
    vendorId: "018f2f56-7c9a-7abc-8def-0123456789ad",
    capturedAt: "2026-08-18T00:00:00.000Z",
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
  bodyMarkdown: "Details",
  reportExportId: null,
  mailboxConnectionId: null,
  replyToMessageId: null,
  manualFields: {},
  attachments: [],
  currentApproval: null,
  plannedNextContactAt: null,
  agreedDisclosureAt: null,
  vendorReference: null,
  latestPackage: null,
};

function validation(blocking: boolean): SubmissionValidationResult {
  return {
    submissionId: submission.id,
    revision: submission.revision,
    blocking,
    checkedAt: "2026-08-18T00:00:00.000Z",
    findings: blocking
      ? [
          {
            severity: "BLOCKING",
            code: "REPORT_EXPORT_REQUIRED",
            field: "reportExportId",
            message: "Attach an approved vendor report PDF.",
          },
        ]
      : [],
  };
}

describe("submission release gates", () => {
  it("cannot approve exact content while a blocking issue remains", () => {
    const view = render(
      <PackageReview
        submission={submission}
        validation={validation(true)}
        busy={false}
        onReview={vi.fn()}
        onApprove={vi.fn()}
        onDownloadManualBundle={vi.fn()}
        onSealEmail={vi.fn()}
        onSendEmail={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Approve exact content" }),
    ).toHaveProperty("disabled", true);

    view.rerender(
      <PackageReview
        submission={submission}
        validation={validation(false)}
        busy={false}
        onReview={vi.fn()}
        onApprove={vi.fn()}
        onDownloadManualBundle={vi.fn()}
        onSealEmail={vi.fn()}
        onSendEmail={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Approve exact content" }),
    ).toHaveProperty("disabled", false);
  });

  it("cannot record delivery until the exact package is sealed", () => {
    const view = render(
      <ManualDeliveryPanel
        submission={submission}
        busy={false}
        onRecord={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Record as submitted" }),
    ).toHaveProperty("disabled", true);

    view.rerender(
      <ManualDeliveryPanel
        submission={{
          ...submission,
          status: "SEALED",
          latestPackage: {
            id: "018f2f56-7c9a-7abc-8def-0123456789af",
            manifestSha256: "a".repeat(64),
            packageSha256: "b".repeat(64),
            sizeBytes: 123,
            createdAt: "2026-08-18T00:00:00.000Z",
          },
        }}
        busy={false}
        onRecord={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Record as submitted" }),
    ).toHaveProperty("disabled", false);
  });
});
