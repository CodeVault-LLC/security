import { describe, expect, it } from "vitest";

import { calculateSsvcCoordinatorPublish } from "./ssvc.js";

describe("SSVC Coordinator Publish 2.0", () => {
  it.each([
    ["SSVCv2/COORDINATOR-PUBLISH/SI:F/E:N/VA:P", "PUBLISH"],
    ["SSVCv2/COORDINATOR-PUBLISH/SI:F/E:P/VA:A", "DO_NOT_PUBLISH"],
    ["SSVCv2/COORDINATOR-PUBLISH/SI:U/E:P/VA:A", "PUBLISH"],
    ["SSVCv2/COORDINATOR-PUBLISH/SI:U/E:A/VA:L", "PUBLISH"],
    ["SSVCv2/COORDINATOR-PUBLISH/SI:C/E:A/VA:L", "DO_NOT_PUBLISH"],
  ] as const)("evaluates %s as %s", (vector, expected) => {
    expect(calculateSsvcCoordinatorPublish(vector).decision).toBe(expected);
  });

  it("rejects incomplete decision vectors", () => {
    expect(() =>
      calculateSsvcCoordinatorPublish("SSVCv2/COORDINATOR-PUBLISH/SI:F/E:N"),
    ).toThrow(/mandatory/);
  });
});
