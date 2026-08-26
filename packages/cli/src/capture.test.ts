import { describe, expect, it } from "vitest";

import { parseCaptureArguments } from "./capture.js";

describe("capture arguments", () => {
  it("parses a file capture with explicit provenance", () => {
    expect(
      parseCaptureArguments([
        "--case",
        "00000000-0000-4000-8000-000000000001",
        "--file",
        "request.txt",
        "--type",
        "HTTP_CAPTURE",
        "--visibility",
        "VENDOR",
        "--source-time",
        "2026-08-21T09:30:00.000Z",
        "--title",
        "Captured request",
      ]),
    ).toMatchObject({
      caseId: "00000000-0000-4000-8000-000000000001",
      file: "request.txt",
      artifactKind: "HTTP_CAPTURE",
      visibility: "VENDOR",
      sourceTime: "2026-08-21T09:30:00.000Z",
      title: "Captured request",
    });
  });

  it("defaults to standard input and internal visibility", () => {
    expect(
      parseCaptureArguments(["--case", "00000000-0000-4000-8000-000000000001"]),
    ).toMatchObject({
      file: null,
      visibility: "INTERNAL",
      artifactKind: "OTHER",
    });
  });

  it("accepts CodeVault UUIDv7 case and finding identifiers", () => {
    expect(
      parseCaptureArguments([
        "--case",
        "018f2f56-7c9a-7abc-8def-0123456789ab",
        "--finding",
        "018f2f56-7c9a-7abc-8def-0123456789ac",
      ]),
    ).toMatchObject({
      caseId: "018f2f56-7c9a-7abc-8def-0123456789ab",
      findingId: "018f2f56-7c9a-7abc-8def-0123456789ac",
    });
  });

  it("rejects an unknown artifact kind", () => {
    expect(() =>
      parseCaptureArguments([
        "--case",
        "00000000-0000-4000-8000-000000000001",
        "--type",
        "MALWARE",
      ]),
    ).toThrow("Unknown artifact kind");
  });

  it("rejects a source time without an explicit timezone", () => {
    expect(() =>
      parseCaptureArguments([
        "--case",
        "018f2f56-7c9a-7abc-8def-0123456789ab",
        "--source-time",
        "2026-08-21T09:30:00",
      ]),
    ).toThrow("--source-time must be an ISO 8601 timestamp");
  });
});
