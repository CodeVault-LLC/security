import { describe, expect, it } from "vitest";

import { hasSessionExpired } from "./session.js";

const NOW = Date.parse("2026-08-19T10:00:00.000Z");

describe("session expiry", () => {
  it("expires an ordinary session after the organization idle timeout", () => {
    expect(
      hasSessionExpired(
        {
          expiresAt: "2026-08-19T22:00:00.000Z",
          createdAt: "2026-08-19T09:00:00.000Z",
          lastSeenAt: "2026-08-19T09:29:59.000Z",
          idleMinutes: 30,
          absoluteHours: 12,
          remembered: false,
        },
        NOW,
      ),
    ).toBe(true);
  });

  it("keeps a remembered session across idle periods until its own expiry", () => {
    expect(
      hasSessionExpired(
        {
          expiresAt: "2026-08-26T09:00:00.000Z",
          createdAt: "2026-08-19T09:00:00.000Z",
          lastSeenAt: "2026-08-19T09:00:00.000Z",
          idleMinutes: 30,
          absoluteHours: 12,
          remembered: true,
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("expires a remembered session at its configured deadline", () => {
    expect(
      hasSessionExpired(
        {
          expiresAt: "2026-08-19T09:59:59.000Z",
          createdAt: "2026-08-12T10:00:00.000Z",
          lastSeenAt: "2026-08-12T10:00:00.000Z",
          idleMinutes: 30,
          absoluteHours: 12,
          remembered: true,
        },
        NOW,
      ),
    ).toBe(true);
  });
});
