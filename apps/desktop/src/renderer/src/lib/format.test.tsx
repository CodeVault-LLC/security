import { describe, expect, it } from "vitest";

import { formatBytesApprox } from "./format.js";

describe("formatBytesApprox", () => {
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "marks invalid byte count %s as unavailable",
    (bytes) => {
      expect(formatBytesApprox(bytes)).toBe("—");
    },
  );

  it("keeps valid zero and fractional units readable", () => {
    expect(formatBytesApprox(0)).toBe("0 B");
    expect(formatBytesApprox(1536)).toBe("1.5 KiB");
  });

  it("uses binary units through exbibytes", () => {
    expect(formatBytesApprox(1024 ** 5)).toBe("1.0 PiB");
    expect(formatBytesApprox(1024 ** 6)).toBe("1.0 EiB");
  });
});
