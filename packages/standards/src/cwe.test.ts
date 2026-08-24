import { describe, expect, it } from "vitest";

import {
  CWE_CATALOG,
  CWE_CATALOG_VERSION,
  CWE_TOP_25_YEAR,
  cweUrl,
  findCwe,
  normalizeCweId,
  searchCwe,
  topCwes,
} from "./cwe.js";

describe("CWE catalogue", () => {
  it("contains every 2025 Top 25 weakness once and in rank order", () => {
    const entries = topCwes();

    expect(CWE_TOP_25_YEAR).toBe(2025);
    expect(entries).toHaveLength(25);
    expect(entries.map((entry) => entry.top25Rank)).toEqual(
      Array.from({ length: 25 }, (_, index) => index + 1),
    );
    expect(entries[0]?.id).toBe("CWE-79");
    expect(entries[24]?.id).toBe("CWE-770");
  });

  it("records the MITRE release used to curate the data", () => {
    expect(CWE_CATALOG_VERSION).toBe("4.20");
  });

  it("has unique, canonical identifiers and valid Top 25 ranks", () => {
    const ids = CWE_CATALOG.map((entry) => entry.id);
    const ranks = CWE_CATALOG.flatMap((entry) =>
      entry.top25Rank === undefined ? [] : [entry.top25Rank],
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^CWE-[1-9]\d*$/.test(id))).toBe(true);
    expect(new Set(ranks).size).toBe(ranks.length);
  });
});

describe("normalizeCweId", () => {
  it.each([
    ["CWE-79", "CWE-79"],
    [" cwe-089 ", "CWE-89"],
    ["918", "CWE-918"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeCweId(input)).toBe(expected);
  });

  it.each(["", "CWE-0", "CWE--79", "CWE-abc", "79.0", "CWE-123456"])(
    "rejects %s",
    (input) => {
      expect(normalizeCweId(input)).toBeNull();
    },
  );
});

describe("CWE lookup", () => {
  it("finds entries from canonical and bare identifiers", () => {
    expect(findCwe("CWE-89")?.name).toContain("SQL");
    expect(findCwe(" 89 ")?.id).toBe("CWE-89");
  });

  it("returns no unsafe URL for malformed identifiers", () => {
    expect(cweUrl("CWE-89")).toBe(
      "https://cwe.mitre.org/data/definitions/89.html",
    );
    expect(cweUrl("../89")).toBeNull();
    expect(cweUrl("CWE-0")).toBeNull();
  });

  it("clamps invalid and excessive search limits", () => {
    expect(searchCwe("injection", -1)).toEqual([]);
    expect(searchCwe("injection", Number.NaN)).toEqual([]);
    expect(searchCwe("e", 500)).toHaveLength(50);
  });

  it("can list a category and the Top 25 subset", () => {
    expect(topCwes("ACCESS_CONTROL").map((entry) => entry.id)).toEqual([
      "CWE-352",
      "CWE-862",
      "CWE-863",
      "CWE-284",
      "CWE-639",
    ]);
  });
});
