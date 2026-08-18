import { describe, expect, it } from "vitest";

import { assertMediaStorageAccess } from "./storage.js";

describe("media storage key restrictions", () => {
  it("allows only the operation-specific avatar prefixes", () => {
    expect(() =>
      assertMediaStorageAccess("read", "quarantine/avatars/input"),
    ).not.toThrow();
    expect(() =>
      assertMediaStorageAccess("write", "derivatives/avatars/output"),
    ).not.toThrow();
    expect(() =>
      assertMediaStorageAccess("delete", "quarantine/avatars/input"),
    ).not.toThrow();
    expect(() =>
      assertMediaStorageAccess("delete", "derivatives/avatars/output"),
    ).not.toThrow();
  });

  it.each([
    ["read", "derivatives/avatars/output"],
    ["write", "quarantine/avatars/input"],
    ["read", "evidence/confidential"],
    ["write", "derivatives/avatars/../evidence/output"],
    ["delete", "/quarantine/avatars/input"],
    ["delete", "quarantine/avatars/"],
  ] as const)("rejects %s access to %s", (operation, objectKey) => {
    expect(() => assertMediaStorageAccess(operation, objectKey)).toThrow(
      "Media storage access was denied",
    );
  });
});
