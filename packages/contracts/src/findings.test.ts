import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import { AddFindingIdentifierRequest } from "./findings.js";

describe("finding identifier contracts", () => {
  it("accepts supported schemes", () => {
    expect(
      Value.Check(AddFindingIdentifierRequest, {
        scheme: "CVE",
        value: "CVE-2026-1234",
      }),
    ).toBe(true);
  });

  it("rejects unknown schemes", () => {
    expect(
      Value.Check(AddFindingIdentifierRequest, {
        scheme: "OTHER",
        value: "CVE-2026-1234",
      }),
    ).toBe(false);
  });

  it("caps identifier values at the persistence validation limit", () => {
    expect(
      Value.Check(AddFindingIdentifierRequest, {
        scheme: "CUSTOM",
        value: "x".repeat(128),
      }),
    ).toBe(true);
    expect(
      Value.Check(AddFindingIdentifierRequest, {
        scheme: "CUSTOM",
        value: "x".repeat(129),
      }),
    ).toBe(false);
  });
});
