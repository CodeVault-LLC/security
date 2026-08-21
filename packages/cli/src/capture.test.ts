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
});
