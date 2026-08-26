import { afterEach, describe, expect, it, vi } from "vitest";

import { addBusinessDays } from "./business-days.js";
import {
  assertSubmissionTransition,
  canTransitionSubmission,
  computeNextAction,
} from "./submissions.js";

afterEach(() => vi.restoreAllMocks());

describe("submission state transitions", () => {
  it("allows self approval but never skips review or sealing", () => {
    expect(() => assertSubmissionTransition("DRAFT", "APPROVED")).toThrow(
      /DRAFT.*APPROVED/,
    );
    expect(() =>
      assertSubmissionTransition("IN_REVIEW", "APPROVED"),
    ).not.toThrow();
    expect(() =>
      assertSubmissionTransition("APPROVED", "SEALED"),
    ).not.toThrow();
    expect(() => assertSubmissionTransition("APPROVED", "SENT")).toThrow(
      /APPROVED.*SENT/,
    );
  });

  it("keeps final delivery states terminal", () => {
    expect(canTransitionSubmission("SENT", "SENDING")).toBe(false);
    expect(canTransitionSubmission("RECORDED_MANUALLY", "DRAFT")).toBe(false);
    expect(canTransitionSubmission("CANCELLED", "DRAFT")).toBe(false);
  });

  it("permits a failed send only to re-enter an explicit send attempt", () => {
    expect(canTransitionSubmission("SENDING", "SEND_FAILED")).toBe(true);
    expect(canTransitionSubmission("SEND_FAILED", "SENDING")).toBe(true);
    expect(canTransitionSubmission("SEND_FAILED", "SENT")).toBe(false);
  });
});

describe("business-day arithmetic", () => {
  it("skips weekends in UTC", () => {
    expect(addBusinessDays("2026-08-17T10:00:00.000Z", 5)).toBe(
      "2026-08-24T10:00:00.000Z",
    );
    expect(addBusinessDays("2026-08-21T23:30:00.000Z", 1)).toBe(
      "2026-08-24T23:30:00.000Z",
    );
    expect(addBusinessDays("2026-08-22T10:00:00.000Z", 1)).toBe(
      "2026-08-24T10:00:00.000Z",
    );
    expect(addBusinessDays("2026-08-23T10:00:00.000Z", 5)).toBe(
      "2026-08-28T10:00:00.000Z",
    );
    expect(addBusinessDays("2026-08-18T10:00:00.000Z", 4)).toBe(
      "2026-08-24T10:00:00.000Z",
    );
  });

  it("rejects invalid dates and unsafe day counts instead of guessing", () => {
    expect(() => addBusinessDays("not-a-date", 1)).toThrow(/valid ISO/);
    expect(() => addBusinessDays("2026-08-17T10:00:00.000Z", -1)).toThrow(
      /non-negative integer/,
    );
    expect(() => addBusinessDays("2026-08-17T10:00:00.000Z", 1.5)).toThrow(
      /non-negative integer/,
    );
  });

  it("jumps whole work weeks instead of visiting every calendar day", () => {
    const setDate = vi.spyOn(Date.prototype, "setUTCDate");

    addBusinessDays("2026-08-17T10:00:00.000Z", 10_000);

    expect(setDate.mock.calls.length).toBeLessThanOrEqual(6);
  });
});

describe("coordination next actions", () => {
  it("does not treat an inbound auto-reply as acknowledgement", () => {
    expect(
      computeNextAction({
        state: "AWAITING_ACKNOWLEDGEMENT",
        lastOutboundAt: "2026-08-17T09:00:00.000Z",
        lastInboundAt: "2026-08-17T09:01:00.000Z",
        lastInboundClassification: "AUTO_REPLY",
        acknowledgementBusinessDays: 5,
        now: "2026-08-18T09:00:00.000Z",
      }),
    ).toMatchObject({
      kind: "WAITING_FOR_ACKNOWLEDGEMENT",
      dueAt: "2026-08-24T09:00:00.000Z",
    });
  });

  it("raises an overdue action once the business-day deadline arrives", () => {
    expect(
      computeNextAction({
        state: "AWAITING_ACKNOWLEDGEMENT",
        lastOutboundAt: "2026-08-17T10:00:00.000Z",
        acknowledgementBusinessDays: 5,
        now: "2026-08-24T10:00:00.000Z",
      }),
    ).toEqual({
      kind: "VENDOR_ACKNOWLEDGEMENT_OVERDUE",
      dueAt: "2026-08-24T10:00:00.000Z",
    });
  });

  it("prioritizes a human-reviewable reply over the acknowledgement timer", () => {
    expect(
      computeNextAction({
        state: "AWAITING_ACKNOWLEDGEMENT",
        lastOutboundAt: "2026-08-17T10:00:00.000Z",
        lastInboundAt: "2026-08-18T10:00:00.000Z",
        lastInboundClassification: "UNREVIEWED",
        acknowledgementBusinessDays: 5,
        now: "2026-08-24T10:00:00.000Z",
      }),
    ).toEqual({
      kind: "VENDOR_REPLY_NEEDS_REVIEW",
      dueAt: "2026-08-18T10:00:00.000Z",
    });
  });
});
