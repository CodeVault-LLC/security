import { describe, expect, it } from "vitest";

import {
  canAdministerOrganization,
  hasRecentMfa,
  type OrganizationActor,
} from "./organization.js";

const admin: OrganizationActor = {
  userId: "admin-1",
  organizationId: "organization-1",
  role: "ADMIN",
  disabled: false,
};

describe("organization administration", () => {
  it("requires an active administrator membership", () => {
    expect(canAdministerOrganization(admin)).toBe(true);
    expect(canAdministerOrganization({ ...admin, role: "MEMBER" })).toBe(false);
    expect(canAdministerOrganization({ ...admin, disabled: true })).toBe(false);
  });
});

describe("recent MFA", () => {
  it("accepts a verification exactly at the bounded cutoff", () => {
    expect(
      hasRecentMfa(
        "2026-08-18T09:50:00.000Z",
        10,
        new Date("2026-08-18T10:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("rejects a verification older than the bounded cutoff", () => {
    expect(
      hasRecentMfa(
        "2026-08-18T09:49:59.999Z",
        10,
        new Date("2026-08-18T10:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("rejects missing, future, and invalid verification timestamps", () => {
    const now = new Date("2026-08-18T10:00:00.000Z");

    expect(hasRecentMfa(null, 10, now)).toBe(false);
    expect(hasRecentMfa("invalid", 10, now)).toBe(false);
    expect(hasRecentMfa("2026-08-18T10:00:00.001Z", 10, now)).toBe(false);
  });
});
