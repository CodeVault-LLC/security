import { describe, expect, it } from "vitest";

import {
  formatReference,
  isSha256,
  isUuid,
  isValidCveId,
  isValidCweId,
  looksLikeCveIdentifier,
  parseReference,
} from "./identifiers.js";
import { generateObjectKey, generateOpaqueToken, uuidv7 } from "./crypto.js";

describe("uuidv7", () => {
  it("produces a well-formed version 7 UUID", () => {
    const id = uuidv7();

    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe("7");
  });

  it("sorts lexicographically by creation time", () => {
    const earlier = uuidv7(1_700_000_000_000);
    const later = uuidv7(1_800_000_000_000);

    expect(earlier < later).toBe(true);
  });
});

describe("formatReference", () => {
  it("formats year-scoped references", () => {
    expect(formatReference("case", 1, 2026)).toBe("CASE-2026-0001");
    expect(formatReference("finding", 12, 2026)).toBe("FIND-2026-0012");
  });

  it("formats flat references", () => {
    expect(formatReference("asset", 12)).toBe("AST-000012");
    expect(formatReference("evidence", 123)).toBe("EVID-000123");
    expect(formatReference("poc", 1)).toBe("POC-000001");
  });

  it("requires a year for year-scoped kinds", () => {
    expect(() => formatReference("case", 1)).toThrow(/requires a year/);
  });

  it("never produces a CVE-shaped reference", () => {
    const references = [
      formatReference("case", 1, 2026),
      formatReference("finding", 1, 2026),
      formatReference("asset", 1),
    ];

    for (const reference of references) {
      expect(looksLikeCveIdentifier(reference)).toBe(false);
    }
  });
});

describe("parseReference", () => {
  it("round-trips year-scoped references", () => {
    expect(parseReference("FIND-2026-0012")).toEqual({
      kind: "finding",
      year: 2026,
      sequence: 12,
    });
  });

  it("round-trips flat references", () => {
    expect(parseReference("EVID-000123")).toEqual({
      kind: "evidence",
      year: null,
      sequence: 123,
    });
  });

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    expect(parseReference("  ast-000007 ")?.sequence).toBe(7);
  });

  it("rejects malformed and unknown references", () => {
    expect(parseReference("CVE-2026-0001")).toBeNull();
    expect(parseReference("FIND-2026")).toBeNull();
    expect(parseReference("AST-000001-2")).toBeNull();
    expect(parseReference("nonsense")).toBeNull();
  });
});

describe("external identifier validation", () => {
  it("recognises CVE identifiers", () => {
    expect(isValidCveId("CVE-2026-12345")).toBe(true);
    expect(isValidCveId("cve-2026-1234")).toBe(true);
    expect(isValidCveId("CVE-2026-123")).toBe(false);
  });

  it("recognises CWE identifiers", () => {
    expect(isValidCweId("CWE-89")).toBe(true);
    expect(isValidCweId("CWE-")).toBe(false);
  });

  it("recognises SHA-256 digests", () => {
    expect(isSha256("a".repeat(64))).toBe(true);
    expect(isSha256("a".repeat(63))).toBe(false);
    expect(isSha256("z".repeat(64))).toBe(false);
  });
});

describe("generateObjectKey", () => {
  it("never embeds the original filename", () => {
    const key = generateObjectKey("case-1", "artifact-1");

    expect(key.startsWith("cases/case-1/artifacts/artifact-1/")).toBe(true);
    expect(key).not.toContain("..");
  });

  it("is unique per call", () => {
    const first = generateObjectKey("case-1", "artifact-1");
    const second = generateObjectKey("case-1", "artifact-1");

    expect(first).not.toBe(second);
  });
});

describe("generateOpaqueToken", () => {
  it("produces 32 bytes of entropy in a URL-safe encoding", () => {
    const token = generateOpaqueToken();

    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
