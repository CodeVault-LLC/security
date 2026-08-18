import { describe, expect, it } from "vitest";

import { environmentValueDetail } from "./verify-env-helpers.js";

describe("environment verification output", () => {
  it("never prints credentials embedded in connection URLs", () => {
    const url = "postgres://admin:top-secret@database.internal/codevault";
    const detail = environmentValueDetail("DATABASE_URL", url);
    expect(detail).toBe("set");
    expect(detail).not.toContain("top-secret");
  });

  it("still prints non-sensitive operational identifiers", () => {
    expect(environmentValueDetail("S3_BUCKET", "codevault-artifacts")).toBe(
      "codevault-artifacts",
    );
  });
});
