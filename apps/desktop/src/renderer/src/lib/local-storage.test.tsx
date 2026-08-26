import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage,
} from "./local-storage.js";

afterEach(() => vi.restoreAllMocks());

describe("optional local storage", () => {
  it("returns safe results when storage access is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "SecurityError");
    });

    expect(readLocalStorage("intake")).toBeNull();
    expect(writeLocalStorage("intake", "pending")).toBe(false);
    expect(removeLocalStorage("intake")).toBe(false);
  });

  it("reports successful reads, writes, and removals", () => {
    expect(writeLocalStorage("intake", "pending")).toBe(true);
    expect(readLocalStorage("intake")).toBe("pending");
    expect(removeLocalStorage("intake")).toBe(true);
    expect(readLocalStorage("intake")).toBeNull();
  });
});
