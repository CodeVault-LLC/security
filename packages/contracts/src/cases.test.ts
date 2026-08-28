import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import { isUuid } from "@codevault/core";

import { AddCaseMemberRequest } from "./cases.js";

FormatRegistry.Set("uuid", isUuid);

const USER_ID = "018f47d2-7d20-7a31-8fb8-9d5f3d680001";

describe("case capability grants", () => {
  it("accepts independent capabilities when read is present", () => {
    expect(
      Value.Check(AddCaseMemberRequest, {
        userId: USER_ID,
        capabilities: ["READ", "APPROVAL", "DISCLOSURE"],
      }),
    ).toBe(true);
  });

  it("rejects action capabilities without read", () => {
    expect(
      Value.Check(AddCaseMemberRequest, {
        userId: USER_ID,
        capabilities: ["WRITE"],
      }),
    ).toBe(false);
  });

  it("rejects duplicate capabilities and the legacy access field", () => {
    expect(
      Value.Check(AddCaseMemberRequest, {
        userId: USER_ID,
        capabilities: ["READ", "READ"],
      }),
    ).toBe(false);
    expect(
      Value.Check(AddCaseMemberRequest, {
        userId: USER_ID,
        access: "WRITE",
      }),
    ).toBe(false);
  });
});
