import { describe, expect, it } from "vitest";

import { deriveVendorResponseSla } from "./response-sla.js";

const submissionId = "00000000-0000-4000-8000-000000000001";

describe("vendor response SLA", () => {
  it("tracks an overdue acknowledgement using business days", () => {
    const result = deriveVendorResponseSla({
      submissionId,
      acknowledgementBusinessDays: 2,
      updateCadenceDays: 14,
      sentAt: "2026-08-21T12:00:00.000Z",
      inboundAt: [],
      now: "2026-08-26T12:00:00.000Z",
    });

    expect(result.acknowledgementDueAt).toBe("2026-08-25T12:00:00.000Z");
    expect(result.status).toBe("ACKNOWLEDGEMENT_OVERDUE");
    expect(result.remainingDays).toBe(-1);
  });

  it("starts the next update window from the latest vendor response", () => {
    const result = deriveVendorResponseSla({
      submissionId,
      acknowledgementBusinessDays: 5,
      updateCadenceDays: 7,
      sentAt: "2026-08-20T12:00:00.000Z",
      inboundAt: ["2026-08-21T12:00:00.000Z", "2026-08-24T12:00:00.000Z"],
      now: "2026-08-26T12:00:00.000Z",
    });

    expect(result.status).toBe("AWAITING_UPDATE");
    expect(result.firstResponseAt).toBe("2026-08-21T12:00:00.000Z");
    expect(result.nextUpdateDueAt).toBe("2026-08-31T12:00:00.000Z");
    expect(result.remainingDays).toBe(5);
  });
});
