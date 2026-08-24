import { describe, expect, it } from "vitest";

import { prepareExternalIdentifier } from "./external-identifiers.js";

describe("prepareExternalIdentifier", () => {
  it("rejects unknown schemes instead of treating them as custom", () => {
    expect(prepareExternalIdentifier("OTHER", "CVE-2026-1234")).toBeNull();
  });

  it("returns a canonical value and URL for authority identifiers", () => {
    expect(prepareExternalIdentifier("CVE", " cve-2026-1234 ")).toEqual({
      scheme: "CVE",
      value: "CVE-2026-1234",
      url: "https://www.cve.org/CVERecord?id=CVE-2026-1234",
    });
  });

  it("preserves a valid custom identifier and leaves its URL empty", () => {
    expect(prepareExternalIdentifier("CUSTOM", " Vendor-7 ")).toEqual({
      scheme: "CUSTOM",
      value: "Vendor-7",
      url: null,
    });
  });

  it("rejects a malformed value for a known scheme", () => {
    expect(prepareExternalIdentifier("CVE", "CVE-26-7")).toBeNull();
  });
});
