import { describe, expect, it } from "vitest";

import { isEncryptionPolicy, isVendorRouteType } from "./vendors.js";

describe("vendor route vocabulary", () => {
  it("accepts only implemented route types", () => {
    expect(isVendorRouteType("EMAIL")).toBe(true);
    expect(isVendorRouteType("MANUAL")).toBe(true);
    expect(isVendorRouteType("PORTAL_AUTOMATION")).toBe(false);
    expect(isVendorRouteType("")).toBe(false);
  });

  it("rejects permissive encryption policy spellings", () => {
    expect(isEncryptionPolicy("REQUIRED")).toBe(true);
    expect(isEncryptionPolicy("OPTIONAL")).toBe(true);
    expect(isEncryptionPolicy("FORBIDDEN")).toBe(true);
    expect(isEncryptionPolicy("required")).toBe(false);
    expect(isEncryptionPolicy("BEST_EFFORT")).toBe(false);
  });
});
