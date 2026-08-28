import { describe, expect, it } from "vitest";

import {
  canAdministerWorkspace,
  canApproveCase,
  canApproveReport,
  canDiscloseCase,
  canManageCaseMembers,
  canReadCase,
  canWriteAnything,
  canWriteCase,
  satisfiesSeparationOfDuties,
  type ActingUser,
  type CaseCapability,
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
    members: new Map<string, ReadonlySet<CaseCapability>>(),
    ...overrides,
  };
}

function grants(
  ...capabilities: CaseCapability[]
): ReadonlySet<CaseCapability> {
  return new Set(capabilities);
}

describe("case capabilities", () => {
  const context = caseContext();

  it("hides every case from ungranted organization users", () => {
    expect(canReadCase(user("VIEWER"), context)).toBe(false);
    expect(canReadCase(user("MEMBER"), context)).toBe(false);
    expect(canReadCase(user("ADMIN"), context)).toBe(false);
  });

  it("gives an active owner every case capability subject to role policy", () => {
    const owner = user("MEMBER", OWNER_ID);

    expect(canReadCase(owner, context)).toBe(true);
    expect(canWriteCase(owner, context)).toBe(true);
    expect(canApproveCase(owner, context)).toBe(true);
    expect(canDiscloseCase(owner, context)).toBe(true);
  });

  it("does not let an actor from another organization read the case", () => {
    expect(
      canReadCase(
        { ...user("ADMIN", "foreign-admin"), organizationId: "other-org" },
        context,
      ),
    ).toBe(false);
  });

  it("honours an independent read grant", () => {
    const granted = caseContext({
      members: new Map([["reader-1", grants("READ")]]),
    });
    const reader = user("MEMBER", "reader-1");

    expect(canReadCase(reader, granted)).toBe(true);
    expect(canWriteCase(reader, granted)).toBe(false);
    expect(canApproveCase(reader, granted)).toBe(false);
    expect(canDiscloseCase(reader, granted)).toBe(false);
  });

  it("keeps write, approval, and disclosure independent", () => {
    const granted = caseContext({
      members: new Map([
        ["writer-1", grants("READ", "WRITE")],
        ["approver-1", grants("READ", "APPROVAL")],
        ["discloser-1", grants("READ", "DISCLOSURE")],
      ]),
    });
    const writer = user("MEMBER", "writer-1");
    const approver = user("MEMBER", "approver-1");
    const discloser = user("MEMBER", "discloser-1");

    expect(canWriteCase(writer, granted)).toBe(true);
    expect(canApproveCase(writer, granted)).toBe(false);
    expect(canDiscloseCase(writer, granted)).toBe(false);
    expect(canWriteCase(approver, granted)).toBe(false);
    expect(canApproveCase(approver, granted)).toBe(true);
    expect(canDiscloseCase(approver, granted)).toBe(false);
    expect(canWriteCase(discloser, granted)).toBe(false);
    expect(canApproveCase(discloser, granted)).toBe(false);
    expect(canDiscloseCase(discloser, granted)).toBe(true);
  });

  it("fails closed when an action grant does not include read", () => {
    const malformed = caseContext({
      members: new Map([["member-1", grants("WRITE", "APPROVAL")]]),
    });
    const member = user("MEMBER", "member-1");

    expect(canReadCase(member, malformed)).toBe(false);
    expect(canWriteCase(member, malformed)).toBe(false);
    expect(canApproveCase(member, malformed)).toBe(false);
  });

  it("keeps a viewer globally read-only despite action grants or ownership", () => {
    const granted = caseContext({
      members: new Map([
        ["viewer-1", grants("READ", "WRITE", "APPROVAL", "DISCLOSURE")],
      ]),
    });
    const viewer = user("VIEWER", "viewer-1");

    expect(canReadCase(viewer, granted)).toBe(true);
    expect(canWriteCase(viewer, granted)).toBe(false);
    expect(canApproveCase(viewer, granted)).toBe(false);
    expect(canDiscloseCase(viewer, granted)).toBe(false);
    expect(canWriteCase(user("VIEWER", OWNER_ID), granted)).toBe(false);
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
    expect(canApproveCase(disabled, caseContext())).toBe(false);
    expect(canDiscloseCase(disabled, caseContext())).toBe(false);
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
  it("is available to the owner and to explicitly cleared admins", () => {
    const context = caseContext({
      members: new Map([["ADMIN-1", grants("READ")]]),
    });

    expect(canManageCaseMembers(user("MEMBER", OWNER_ID), context)).toBe(true);
    expect(canManageCaseMembers(user("ADMIN"), context)).toBe(true);
    expect(canManageCaseMembers(user("MEMBER"), context)).toBe(false);
  });

  it("does not reveal a case to an ungranted organization admin", () => {
    expect(
      canManageCaseMembers(user("ADMIN"), caseContext({ restricted: true })),
    ).toBe(false);
  });

  it("keeps a viewer owner from delegating case capabilities", () => {
    expect(canManageCaseMembers(user("VIEWER", OWNER_ID), caseContext())).toBe(
      false,
    );
  });
});

describe("report approval", () => {
  it("requires the independent approval capability", () => {
    const context = caseContext({
      members: new Map([
        ["member-1", grants("READ", "APPROVAL")],
        ["member-2", grants("READ", "WRITE")],
      ]),
    });

    expect(canApproveReport(user("VIEWER"), caseContext())).toBe(false);
    expect(canApproveReport(user("MEMBER", "member-1"), context)).toBe(true);
    expect(canApproveReport(user("MEMBER", "member-2"), context)).toBe(false);
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
