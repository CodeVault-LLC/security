import { describe, expect, it } from "vitest";

import { applyPreviewRedactions } from "./preview-redaction.js";

describe("preview redaction", () => {
  it("applies ordered literal rules without interpreting regex characters", () => {
    expect(
      applyPreviewRedactions("token=a.b token=a.b", [
        { match: "a.b", replacement: "[SECRET]" },
        { match: "token", replacement: "credential" },
      ]),
    ).toBe("credential=[SECRET] credential=[SECRET]");
  });
});
