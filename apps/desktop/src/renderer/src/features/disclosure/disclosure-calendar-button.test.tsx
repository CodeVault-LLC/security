import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Embargo } from "@codevault/contracts";

import { DisclosureCalendarButton } from "./disclosure-calendar-button.js";

const saveCalendar = vi.hoisted(() => vi.fn());

vi.mock("../../lib/bridge.js", () => ({
  bridge: () => ({ disclosure: { saveCalendar } }),
}));

const embargo: Embargo = {
  id: "22222222-2222-4222-8222-222222222222",
  caseId: "11111111-1111-4111-8111-111111111111",
  startsAt: "2026-09-01T00:00:00.000Z",
  endsAt: null,
  plannedDisclosureAt: "2026-10-10T00:00:00.000Z",
  expectedResponseAt: null,
  agreementNote: null,
  updatedBy: {
    id: "33333333-3333-4333-8333-333333333333",
    displayName: "Researcher",
    email: "researcher@example.test",
  },
  updatedAt: "2026-08-26T12:00:00.000Z",
  revision: 1,
};

describe("DisclosureCalendarButton", () => {
  it("sends a scoped iCalendar document to the native save path", async () => {
    saveCalendar.mockResolvedValue({
      ok: true,
      data: { saved: true, sha256: "a".repeat(64) },
    });
    render(
      <DisclosureCalendarButton
        caseId={embargo.caseId}
        caseRef="CASE-42"
        caseTitle="Parser issue"
        embargo={embargo}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Export calendar" }),
    );

    await waitFor(() =>
      expect(saveCalendar).toHaveBeenCalledWith(
        embargo.caseId,
        expect.stringContaining("SUMMARY:CASE-42 planned disclosure"),
      ),
    );
    expect(screen.getByRole("status").textContent).toContain(
      "SHA-256 aaaaaaaaaaaa",
    );
  });

  it("requires at least one configured date", () => {
    render(
      <DisclosureCalendarButton
        caseId={embargo.caseId}
        caseRef="CASE-42"
        caseTitle="Parser issue"
        embargo={null}
      />,
    );

    expect(
      screen
        .getByRole("button", { name: "Export calendar" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});
