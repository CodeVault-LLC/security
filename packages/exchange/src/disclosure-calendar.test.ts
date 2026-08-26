import { describe, expect, it } from "vitest";

import { exportDisclosureCalendar } from "./disclosure-calendar.js";

describe("disclosure calendar export", () => {
  it("emits private all-day events for each configured coordination date", () => {
    const calendar = exportDisclosureCalendar({
      caseId: "11111111-1111-4111-8111-111111111111",
      caseRef: "CASE-42",
      caseTitle: "Parser issue, Windows; Linux\\BSD",
      generatedAt: "2026-08-26T12:30:00.000Z",
      dates: {
        expectedResponseAt: "2026-09-01T00:00:00.000Z",
        startsAt: "2026-08-28T00:00:00.000Z",
        endsAt: null,
        plannedDisclosureAt: "2026-10-10T00:00:00.000Z",
      },
    });

    expect(calendar.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(
      true,
    );
    expect(calendar.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(calendar).toContain("DTSTART;VALUE=DATE:20260828");
    expect(calendar).toContain("SUMMARY:CASE-42 planned disclosure");
    expect(calendar).toContain(
      "DESCRIPTION:Parser issue\\, Windows\\; Linux\\\\BSD",
    );
    expect(calendar).toContain("CLASS:PRIVATE");
    expect(calendar.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("folds long UTF-8 content lines to the iCalendar byte limit", () => {
    const calendar = exportDisclosureCalendar({
      caseId: "11111111-1111-4111-8111-111111111111",
      caseRef: "CASE-42",
      caseTitle: "🔐".repeat(40),
      generatedAt: "2026-08-26T12:30:00.000Z",
      dates: {
        expectedResponseAt: null,
        startsAt: null,
        endsAt: null,
        plannedDisclosureAt: "2026-10-10T00:00:00.000Z",
      },
    });

    for (const line of calendar.split("\r\n")) {
      expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(75);
    }
  });
});
