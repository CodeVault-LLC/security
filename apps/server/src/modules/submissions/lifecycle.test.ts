import { describe, expect, test } from "vitest";

import { deriveSubmissionNextAction } from "./lifecycle.js";

describe("submission coordination next actions", () => {
  test("raises an overdue acknowledgement after five business days", () => {
    const action = deriveSubmissionNextAction({
      coordinationState: "AWAITING_ACKNOWLEDGEMENT",
      deliveryStatus: "SENT",
      mailboxStatus: "ACTIVE",
      lastOutboundAt: "2026-08-17T10:00:00.000Z",
      lastInboundAt: null,
      lastInboundClassification: null,
      acknowledgementBusinessDays: 5,
      updateCadenceDays: 42,
      agreedDisclosureAt: null,
      snoozedUntil: null,
      now: "2026-08-24T10:00:00.000Z",
    });
    expect(action.kind).toBe("VENDOR_ACKNOWLEDGEMENT_OVERDUE");
    expect(action.dueAt).toBe("2026-08-24T10:00:00.000Z");
  });

  test("prioritizes an unreviewed reply over a cadence reminder", () => {
    const action = deriveSubmissionNextAction({
      coordinationState: "IN_REMEDIATION",
      deliveryStatus: "SENT",
      mailboxStatus: "ACTIVE",
      lastOutboundAt: "2026-01-01T10:00:00.000Z",
      lastInboundAt: "2026-08-18T10:00:00.000Z",
      lastInboundClassification: "UNREVIEWED",
      acknowledgementBusinessDays: 5,
      updateCadenceDays: 42,
      agreedDisclosureAt: null,
      snoozedUntil: null,
      now: "2026-08-18T12:00:00.000Z",
    });
    expect(action.kind).toBe("VENDOR_REPLY_NEEDS_REVIEW");
  });

  test("send ambiguity outranks mailbox and correspondence work", () => {
    const action = deriveSubmissionNextAction({
      coordinationState: "AWAITING_ACKNOWLEDGEMENT",
      deliveryStatus: "DELIVERY_UNKNOWN",
      mailboxStatus: "REAUTH_REQUIRED",
      lastOutboundAt: null,
      lastInboundAt: "2026-08-18T10:00:00.000Z",
      lastInboundClassification: "UNREVIEWED",
      acknowledgementBusinessDays: 5,
      updateCadenceDays: 42,
      agreedDisclosureAt: null,
      snoozedUntil: null,
      now: "2026-08-18T12:00:00.000Z",
    });
    expect(action.kind).toBe("SUBMISSION_SEND_FAILED");
  });
});
