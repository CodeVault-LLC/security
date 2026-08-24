import { describe, expect, it } from "vitest";

import {
  externalIdUrl,
  isExternalIdScheme,
  isValidExternalId,
  normalizeExternalId,
} from "./identifiers.js";

describe("external identifier schemes", () => {
  it.each(["CVE", "GHSA", "OSV", "CUSTOM"])("recognizes %s", (scheme) => {
    expect(isExternalIdScheme(scheme)).toBe(true);
  });

  it.each(["", "cve", "OTHER", "__proto__"])("rejects %s", (scheme) => {
    expect(isExternalIdScheme(scheme)).toBe(false);
    expect(isValidExternalId(scheme, "CVE-2026-1234")).toBe(false);
  });

  it("normalizes authority identifiers and preserves custom case", () => {
    expect(normalizeExternalId("CVE", " cve-2026-1234 ")).toBe("CVE-2026-1234");
    expect(normalizeExternalId("GHSA", "ghsa-2345-6789-cfgh")).toBe(
      "GHSA-2345-6789-CFGH",
    );
    expect(normalizeExternalId("CUSTOM", " Vendor-Case-7 ")).toBe(
      "Vendor-Case-7",
    );
  });

  it("rejects malformed and control-character identifiers", () => {
    expect(normalizeExternalId("CVE", "CVE-26-1234")).toBeNull();
    expect(normalizeExternalId("CUSTOM", "case\nheader")).toBeNull();
    expect(normalizeExternalId("CUSTOM", "x".repeat(129))).toBeNull();
  });

  it("links only valid identifiers", () => {
    expect(externalIdUrl("CVE", " cve-2026-1234 ")).toBe(
      "https://www.cve.org/CVERecord?id=CVE-2026-1234",
    );
    expect(externalIdUrl("CVE", "not-a-cve")).toBeNull();
    expect(externalIdUrl("CUSTOM", "case-7")).toBeNull();
  });
});
