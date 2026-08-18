import { describe, expect, it } from "vitest";

import {
  assertPatchedVips,
  ImageRejectedError,
  sanitizeImage,
} from "./sanitize-image.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4z8AAAAMBAQCc479ZAAAAAElFTkSuQmCC",
  "base64",
);

describe("contained image sanitizer", () => {
  it("accepts PNG and emits only a bounded metadata-free WebP", async () => {
    const result = await sanitizeImage(PNG);
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    expect(Buffer.from(result.bytes).toString("ascii", 8, 12)).toBe("WEBP");
  });

  it.each([
    Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
    Buffer.from("GIF89a"),
    Buffer.from("RIFFxxxxWEBP"),
  ])("rejects non-JPEG/PNG before decoder selection", async (bytes) => {
    await expect(sanitizeImage(bytes)).rejects.toMatchObject({
      code: "UNSUPPORTED_FORMAT",
    });
  });

  it("returns a stable code for malformed PNG", async () => {
    await expect(sanitizeImage(PNG.subarray(0, 20))).rejects.toBeInstanceOf(
      ImageRejectedError,
    );
  });

  it("refuses an unpatched libvips runtime", () => {
    expect(() => assertPatchedVips("8.18.2")).toThrow();
    expect(() => assertPatchedVips("unknown")).toThrow();
    expect(() => assertPatchedVips("8.18.3-dev")).toThrow();
    expect(() => assertPatchedVips("8.18.3")).not.toThrow();
  });
});
