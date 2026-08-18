import { createHash } from "node:crypto";

import sharp from "sharp";

const MAX_PIXELS = 16_000_000;
const MAX_EDGE = 8_192;
const MAX_OUTPUT = 512 * 1024;
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

process.env.VIPS_BLOCK_UNTRUSTED = "1";
sharp.block({ operation: ["VipsForeignLoad"] });
sharp.unblock({
  operation: ["VipsForeignLoadJpegBuffer", "VipsForeignLoadPngBuffer"],
});
sharp.cache(false);
sharp.concurrency(1);

export type ImageRejectionCode =
  | "UNSUPPORTED_FORMAT"
  | "MALFORMED_IMAGE"
  | "TOO_MANY_PIXELS"
  | "TOO_MANY_FRAMES"
  | "PROCESSING_LIMIT";

export class ImageRejectedError extends Error {
  constructor(readonly code: ImageRejectionCode) {
    super("Image was rejected.");
    this.name = "ImageRejectedError";
  }
}

export interface SanitizedImage {
  bytes: Uint8Array;
  sha256: string;
  width: number;
  height: number;
}

export function assertPatchedVips(version = sharp.versions.vips): void {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (!match) {
    throw new Error("The media worker could not verify the libvips version.");
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (
    major < 8 ||
    (major === 8 && minor < 18) ||
    (major === 8 && minor === 18 && patch < 3)
  ) {
    throw new Error("The media worker requires libvips 8.18.3 or newer.");
  }
}

function signature(input: Uint8Array): "jpeg" | "png" {
  const bytes = Buffer.from(input);
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "jpeg";
  if (
    bytes.length >= PNG_MAGIC.length &&
    bytes.subarray(0, 8).equals(PNG_MAGIC)
  )
    return "png";
  throw new ImageRejectedError("UNSUPPORTED_FORMAT");
}

export async function sanitizeImage(
  input: Uint8Array,
): Promise<SanitizedImage> {
  assertPatchedVips();
  const expectedFormat = signature(input);
  try {
    const image = sharp(Buffer.from(input), {
      failOn: "warning",
      limitInputPixels: MAX_PIXELS,
      limitInputChannels: 4,
      pages: 1,
      animated: false,
      unlimited: false,
    });
    const metadata = await image.metadata();
    if (metadata.format !== expectedFormat)
      throw new ImageRejectedError("UNSUPPORTED_FORMAT");
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width > MAX_EDGE ||
      metadata.height > MAX_EDGE ||
      metadata.width * metadata.height > MAX_PIXELS
    ) {
      throw new ImageRejectedError("TOO_MANY_PIXELS");
    }
    if ((metadata.pages ?? 1) !== 1)
      throw new ImageRejectedError("TOO_MANY_FRAMES");
    if (metadata.channels !== 3 && metadata.channels !== 4)
      throw new ImageRejectedError("UNSUPPORTED_FORMAT");
    const output = await image
      .rotate()
      .resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .toColourspace("srgb")
      .webp({ quality: 82, alphaQuality: 90, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    if (
      output.info.format !== "webp" ||
      output.info.width < 1 ||
      output.info.width > 512 ||
      output.info.height < 1 ||
      output.info.height > 512 ||
      output.data.length > MAX_OUTPUT ||
      output.data.toString("ascii", 0, 4) !== "RIFF" ||
      output.data.toString("ascii", 8, 12) !== "WEBP"
    ) {
      throw new ImageRejectedError("PROCESSING_LIMIT");
    }
    return {
      bytes: output.data,
      sha256: createHash("sha256").update(output.data).digest("hex"),
      width: output.info.width,
      height: output.info.height,
    };
  } catch (error) {
    if (error instanceof ImageRejectedError) throw error;
    throw new ImageRejectedError("MALFORMED_IMAGE");
  }
}
