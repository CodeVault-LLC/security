import { describe, expect, it } from "vitest";

import { isAtLeastAsRestrictive, parseTlpLabel, tlpRank } from "./tlp.js";

describe("TLP parsing", () => {
  it.each([
    ["TLP:RED", "TLP:RED"],
    [" amber+strict ", "TLP:AMBER+STRICT"],
    ["tlp:green", "TLP:GREEN"],
    ["WHITE", "TLP:CLEAR"],
    ["TLP:WHITE", "TLP:CLEAR"],
  ] as const)("parses %s", (input, expected) => {
    expect(parseTlpLabel(input)).toBe(expected);
  });

  it.each(["", "RED!", "TLP:BLUE"])("rejects %s", (input) => {
    expect(parseTlpLabel(input)).toBeNull();
  });
});

describe("TLP ordering", () => {
  it("exposes stable restrictiveness ranks", () => {
    expect(tlpRank("TLP:RED")).toBeGreaterThan(tlpRank("TLP:AMBER"));
    expect(tlpRank("TLP:CLEAR")).toBe(0);
  });

  it("includes equality in at-least comparisons", () => {
    expect(isAtLeastAsRestrictive("TLP:RED", "TLP:AMBER")).toBe(true);
    expect(isAtLeastAsRestrictive("TLP:AMBER", "TLP:AMBER")).toBe(true);
    expect(isAtLeastAsRestrictive("TLP:GREEN", "TLP:RED")).toBe(false);
  });
});
