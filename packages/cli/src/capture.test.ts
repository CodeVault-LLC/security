import { describe, expect, it } from "vitest";

import { normalizeCaptureServerUrl, parseCaptureArguments } from "./capture.js";

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

  it("rejects an impossible source calendar date", () => {
    expect(() =>
      parseCaptureArguments([
        "--case",
        "018f2f56-7c9a-7abc-8def-0123456789ab",
        "--source-time",
        "2026-02-30T09:30:00.000Z",
      ]),
    ).toThrow("--source-time must be an ISO 8601 timestamp");
  });

  it("accepts a leap-day source date", () => {
    expect(
      parseCaptureArguments([
        "--case",
        "018f2f56-7c9a-7abc-8def-0123456789ab",
        "--source-time",
        "2028-02-29T09:30:00+01:00",
      ]).sourceTime,
    ).toBe("2028-02-29T09:30:00+01:00");
  });

  it.each([".", "..", ""])("rejects reserved capture name %j", (name) => {
    expect(() =>
      parseCaptureArguments([
        "--case",
        "018f2f56-7c9a-7abc-8def-0123456789ab",
        "--name",
        name,
      ]),
    ).toThrow("The capture name must be 1 to 300 characters");
  });

  it.each(["", "x".repeat(201), "text/plain\r\nX-Test: injected"])(
    "rejects invalid MIME type %j",
    (mimeType) => {
      expect(() =>
        parseCaptureArguments([
          "--case",
          "018f2f56-7c9a-7abc-8def-0123456789ab",
          "--mime",
          mimeType,
        ]),
      ).toThrow("--mime must be 1 to 200 characters without controls");
    },
  );

  it.each(["", "   ", "x".repeat(201)])(
    "rejects invalid evidence title %j",
    (title) => {
      expect(() =>
        parseCaptureArguments([
          "--case",
          "018f2f56-7c9a-7abc-8def-0123456789ab",
          "--title",
          title,
        ]),
      ).toThrow("--title must contain 1 to 200 characters");
    },
  );

  it("rejects an evidence description above the Markdown limit", () => {
    expect(() =>
      parseCaptureArguments([
        "--case",
        "018f2f56-7c9a-7abc-8def-0123456789ab",
        "--description",
        "x".repeat(200_001),
      ]),
    ).toThrow("--description cannot exceed 200000 characters");
  });
});

describe("capture server URL", () => {
  it("accepts HTTPS origins and loopback HTTP", () => {
    expect(normalizeCaptureServerUrl("https://vault.example.test/")).toBe(
      "https://vault.example.test",
    );
    expect(normalizeCaptureServerUrl("http://127.0.0.1:4310")).toBe(
      "http://127.0.0.1:4310",
    );
  });

  it.each([
    "http://vault.example.test",
    "https://user:pass@vault.example.test",
    "https://vault.example.test/api",
    "https://vault.example.test?token=secret",
    "https://vault.example.test/#fragment",
  ])("rejects noncanonical server URL %s", (url) => {
    expect(() => normalizeCaptureServerUrl(url)).toThrow(
      "CODEVAULT_URL must be a canonical HTTPS origin",
    );
  });
});
