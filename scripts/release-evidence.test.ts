import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertReleaseTag,
  assertReleaseVersions,
  createVex,
  expectedDesktopPackages,
  verifyDesktopPackageInventory,
  verifyChecksums,
  writeChecksums,
  writeEvidenceManifest,
} from "./release-evidence.js";

function temporaryDirectory(): string {
  return mkdtempSync(join(tmpdir(), "codevault-release-"));
}

describe("release evidence", () => {
  it("requires the tag to match the package version", () => {
    expect(() => assertReleaseTag("v1.2.3", "1.2.3")).not.toThrow();
    expect(() => assertReleaseTag("v1.2.4", "1.2.3")).toThrow(
      "does not match package version",
    );
  });

  it("requires desktop and release versions to match", () => {
    expect(() => assertReleaseVersions("1.2.3", "1.2.3")).not.toThrow();
    expect(() => assertReleaseVersions("1.2.3", "1.2.4")).toThrow(
      "Desktop version",
    );
  });

  it("requires every policy-listed desktop architecture", () => {
    const directory = temporaryDirectory();
    const expected = expectedDesktopPackages("macOS", "1.2.3");
    for (const name of expected)
      writeFileSync(join(directory, name), "package");

    expect(verifyDesktopPackageInventory(directory, "macOS", "1.2.3")).toBe(4);

    writeFileSync(join(directory, "CodeVault-Security-1.2.3-arm64.exe"), "bad");
    expect(() =>
      verifyDesktopPackageInventory(directory, "macOS", "1.2.3"),
    ).toThrow("Unexpected");
  });

  it("creates a deterministic CycloneDX 1.7 VEX identity", () => {
    const first = createVex("1.2.3");
    const second = createVex("1.2.3");

    expect(first.specVersion).toBe("1.7");
    expect(first.serialNumber).toBe(second.serialNumber);
    expect(first.vulnerabilities).toEqual([]);
  });

  it("writes and verifies sorted checksums", () => {
    const directory = temporaryDirectory();
    mkdirSync(join(directory, "nested"));
    writeFileSync(join(directory, "z.txt"), "z");
    writeFileSync(join(directory, "nested", "a.txt"), "a");

    const checksumPath = writeChecksums(directory);

    expect(readFileSync(checksumPath, "utf8").split("\n")[0]).toContain(
      "nested/a.txt",
    );
    expect(verifyChecksums(directory)).toBe(2);

    writeFileSync(join(directory, "z.txt"), "changed");
    expect(() => verifyChecksums(directory)).toThrow("Checksum mismatch");
  });

  it("rejects abbreviated commit identities", () => {
    const directory = temporaryDirectory();

    expect(() => writeEvidenceManifest(directory, "1.2.3", "abc123")).toThrow(
      "full 40-character Git SHA",
    );
  });
});
