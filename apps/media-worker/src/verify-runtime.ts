import sharp from "sharp";

import { assertPatchedVips } from "./sanitize-image.js";

assertPatchedVips();
if (sharp.versions.sharp !== "0.35.3") {
  throw new Error(
    `The reviewed media runtime requires sharp 0.35.3; found ${sharp.versions.sharp}.`,
  );
}

console.warn(`sharp ${sharp.versions.sharp}; libvips ${sharp.versions.vips}`);
