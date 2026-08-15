import { describe, expect, it } from "vitest";

import {
  canInclude,
  filterForAudience,
  isMoreSensitiveThan,
  isPromotion,
  type ContentVisibility,
} from "./visibility.js";

describe("canInclude", () => {
  it("lets an internal report consume every visibility", () => {
    expect(canInclude("INTERNAL", "INTERNAL")).toBe(true);
    expect(canInclude("VENDOR", "INTERNAL")).toBe(true);
    expect(canInclude("PUBLIC", "INTERNAL")).toBe(true);
  });

  it("lets a vendor report consume vendor and public content only", () => {
    expect(canInclude("INTERNAL", "VENDOR")).toBe(false);
    expect(canInclude("VENDOR", "VENDOR")).toBe(true);
    expect(canInclude("PUBLIC", "VENDOR")).toBe(true);
  });

  it("lets a public report consume public content only", () => {
    expect(canInclude("INTERNAL", "PUBLIC")).toBe(false);
    expect(canInclude("VENDOR", "PUBLIC")).toBe(false);
    expect(canInclude("PUBLIC", "PUBLIC")).toBe(true);
  });
});

describe("filterForAudience", () => {
  const items: { id: string; visibility: ContentVisibility }[] = [
    { id: "internal-exploit-notes", visibility: "INTERNAL" },
    { id: "vendor-repro-steps", visibility: "VENDOR" },
    { id: "public-summary", visibility: "PUBLIC" },
  ];

  it("removes restricted items from a public projection", () => {
    const filtered = filterForAudience(items, "PUBLIC");

    expect(filtered.map((item) => item.id)).toEqual(["public-summary"]);
  });

  it("keeps vendor and public items for a vendor projection", () => {
    const filtered = filterForAudience(items, "VENDOR");

    expect(filtered.map((item) => item.id)).toEqual([
      "vendor-repro-steps",
      "public-summary",
    ]);
  });

  it("keeps everything for an internal projection", () => {
    expect(filterForAudience(items, "INTERNAL")).toHaveLength(3);
  });
});

describe("isPromotion", () => {
  it("treats widening as promotion", () => {
    expect(isPromotion("INTERNAL", "VENDOR")).toBe(true);
    expect(isPromotion("VENDOR", "PUBLIC")).toBe(true);
  });

  it("does not treat narrowing or no-ops as promotion", () => {
    expect(isPromotion("PUBLIC", "INTERNAL")).toBe(false);
    expect(isPromotion("VENDOR", "VENDOR")).toBe(false);
  });
});

describe("isMoreSensitiveThan", () => {
  it("orders internal above vendor above public", () => {
    expect(isMoreSensitiveThan("INTERNAL", "VENDOR")).toBe(true);
    expect(isMoreSensitiveThan("VENDOR", "PUBLIC")).toBe(true);
    expect(isMoreSensitiveThan("PUBLIC", "INTERNAL")).toBe(false);
  });
});
