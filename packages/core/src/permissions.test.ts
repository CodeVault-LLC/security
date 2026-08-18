import { describe, expect, it } from "vitest";

import {
  canAdministerWorkspace,
  canApproveReport,
  canManageCaseMembers,
  canReadCase,
  canWriteAnything,
  canWriteCase,
  satisfiesSeparationOfDuties,
  type ActingUser,
  type CaseAccess,
  type CaseAccessContext,
} from "./permissions.js";

const OWNER_ID = "owner-1";

function user(role: ActingUser["role"], id = `${role}-1`): ActingUser {
  return {
    id,
    userId: id,
    organizationId: "organization-1",
    role,
    disabled: false,
  };
}

function caseContext(
  overrides: Partial<CaseAccessContext> = {},
): CaseAccessContext {
  return {
    ownerId: OWNER_ID,
    organizationId: "organization-1",
    restricted: false,
    members: new Map<string, CaseAccess>(),
    ...overrides,
  };
}

describe("open cases", () => {
  const context = caseContext();

  it("lets any active user read", () => {
    expect(canReadCase(user("VIEWER"), context)).toBe(true);
    expect(canReadCase(user("MEMBER"), context)).toBe(true);
    expect(canReadCase(user("ADMIN"), context)).toBe(true);
  });

  it("lets members and admins write but not viewers", () => {
    expect(canWriteCase(user("VIEWER"), context)).toBe(false);
    expect(canWriteCase(user("MEMBER"), context)).toBe(true);
    expect(canWriteCase(user("ADMIN"), context)).toBe(true);
  });
});

describe("restricted cases", () => {
  const context = caseContext({
    restricted: true,
    members: new Map<string, CaseAccess>([
      ["reader-1", "READ"],
      ["writer-1", "WRITE"],
    ]),
  });

  it("lets every active organization member read the case", () => {
    expect(canReadCase(user("MEMBER", "outsider-1"), context)).toBe(true);
    expect(canReadCase(user("ADMIN", "admin-1"), context)).toBe(true);
    expect(canReadCase(user("VIEWER", "viewer-1"), context)).toBe(true);
  });

  it("does not let an actor from another organization read the case", () => {
    expect(
      canReadCase(
        { ...user("ADMIN", "foreign-admin"), organizationId: "other-org" },
        context,
      ),
    ).toBe(false);
  });

  it("grants the owner full access without a membership row", () => {
    expect(canReadCase(user("MEMBER", OWNER_ID), context)).toBe(true);
    expect(canWriteCase(user("MEMBER", OWNER_ID), context)).toBe(true);
  });

  it("honours read-only membership", () => {
    const reader = user("MEMBER", "reader-1");

    expect(canReadCase(reader, context)).toBe(true);
    expect(canWriteCase(reader, context)).toBe(false);
  });

  it("honours write membership", () => {
    const writer = user("MEMBER", "writer-1");

    expect(canWriteCase(writer, context)).toBe(true);
  });

  it("keeps a viewer globally read-only despite a write membership", () => {
    expect(canWriteCase(user("VIEWER", "writer-1"), context)).toBe(false);
  });
});

describe("explicit read membership on an open case", () => {
  it("downgrades a member who would otherwise inherit write access", () => {
    const context = caseContext({
      members: new Map<string, CaseAccess>([["member-1", "READ"]]),
    });

    expect(canWriteCase(user("MEMBER", "member-1"), context)).toBe(false);
  });
});

describe("disabled users", () => {
  const disabled: ActingUser = {
    id: "admin-1",
    userId: "admin-1",
    organizationId: "organization-1",
    role: "ADMIN",
    disabled: true,
  };

  it("loses every permission", () => {
    expect(canReadCase(disabled, caseContext())).toBe(false);
    expect(canWriteCase(disabled, caseContext())).toBe(false);
    expect(canWriteAnything(disabled)).toBe(false);
    expect(canAdministerWorkspace(disabled)).toBe(false);
  });
});

describe("workspace administration", () => {
  it("is limited to admins", () => {
    expect(canAdministerWorkspace(user("ADMIN"))).toBe(true);
    expect(canAdministerWorkspace(user("MEMBER"))).toBe(false);
    expect(canAdministerWorkspace(user("VIEWER"))).toBe(false);
  });
});

describe("case membership management", () => {
  it("is available to the owner and to admins who can read the case", () => {
    const context = caseContext();

    expect(canManageCaseMembers(user("MEMBER", OWNER_ID), context)).toBe(true);
    expect(canManageCaseMembers(user("ADMIN"), context)).toBe(true);
    expect(canManageCaseMembers(user("MEMBER"), context)).toBe(false);
  });

  it("remains available to an organization admin on a restricted case", () => {
    expect(
      canManageCaseMembers(user("ADMIN"), caseContext({ restricted: true })),
    ).toBe(true);
  });
});

describe("report approval", () => {
  it("requires write access to the case", () => {
    expect(canApproveReport(user("VIEWER"), caseContext())).toBe(false);
    expect(canApproveReport(user("MEMBER"), caseContext())).toBe(true);
  });
});

describe("separation of duties", () => {
  it("rejects an approver who was the last editor", () => {
    expect(satisfiesSeparationOfDuties("user-1", "user-1")).toBe(false);
  });

  it("accepts a distinct approver", () => {
    expect(satisfiesSeparationOfDuties("user-2", "user-1")).toBe(true);
  });

  it("accepts approval when there is no recorded editor", () => {
    expect(satisfiesSeparationOfDuties("user-1", null)).toBe(true);
  });
});
