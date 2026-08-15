import { eq, sql } from "drizzle-orm";

import { schema } from "@codevault/db";

import type { WorkerContext } from "../context.js";

/**
 * Safe preview generation.
 *
 * Uploaded content is hostile by assumption: it is captured from targets under
 * research and includes payloads chosen to break parsers. Previews are
 * therefore generated out of process, only for formats with a bounded, safe
 * representation, and never by handing the file to a renderer.
 *
 * Images are re-encoded to a small raster thumbnail, which discards embedded
 * scripts, colour profiles and metadata along the way. Text is excerpted with a
 * hard byte cap and control characters stripped. Everything else — archives,
 * binaries, firmware, PDFs, SVG — gets metadata only in V1.
 */

export interface ArtifactPreviewJobData {
  artifactId: string;
  caseId: string;
}

/** Longest text excerpt retained, in bytes. */
const TEXT_PREVIEW_BYTES = 16 * 1024;

/** Thumbnail edge length in pixels. */
const THUMBNAIL_EDGE = 480;

/** Largest image the worker will attempt to decode. */
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

const TEXT_MIME_PREFIXES = ["text/"];

const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/x-httpd-php",
  "application/javascript",
  "application/x-sh",
]);

/**
 * Image types we will re-encode.
 *
 * SVG is deliberately excluded: it is a document format with scripting, and
 * "sanitise SVG" is a losing game. It gets metadata only.
 */
const RASTER_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "image/avif",
]);

export async function generateArtifactPreview(
  context: WorkerContext,
  data: ArtifactPreviewJobData,
): Promise<void> {
  const { db } = context;

  const rows = await db
    .select()
    .from(schema.artifacts)
    .where(eq(schema.artifacts.id, data.artifactId))
    .limit(1);

  const artifact = rows[0];

  if (artifact === undefined || artifact.status !== "STORED") {
    return;
  }

  const mimeType = artifact.mimeType.toLowerCase();

  if (RASTER_IMAGE_TYPES.has(mimeType)) {
    await generateImageThumbnail(context, artifact);

    return;
  }

  const isText =
    TEXT_MIME_TYPES.has(mimeType) ||
    TEXT_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));

  if (isText) {
    await generateTextExcerpt(context, artifact);

    return;
  }

  await db
    .update(schema.artifacts)
    .set({ previewKind: "NONE", updatedAt: sql`now()` })
    .where(eq(schema.artifacts.id, artifact.id));
}

type ArtifactRow = typeof schema.artifacts.$inferSelect;

async function generateImageThumbnail(
  context: WorkerContext,
  artifact: ArtifactRow,
): Promise<void> {
  if (artifact.sizeBytes > MAX_IMAGE_BYTES) {
    await markNoPreview(context, artifact.id, "image too large to decode");

    return;
  }

  try {
    const { default: sharp } = await import("sharp");
    const bytes = await context.storage.getObject(artifact.objectKey);

    const thumbnail = await sharp(Buffer.from(bytes), {
      // A decompression bomb is a plausible upload; caps stop it becoming an
      // out-of-memory kill for the whole worker.
      limitInputPixels: 40_000_000,
      failOn: "error",
    })
      .rotate()
      .resize(THUMBNAIL_EDGE, THUMBNAIL_EDGE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      // WebP re-encoding drops every non-pixel chunk, including any embedded
      // script or metadata the original carried.
      .webp({ quality: 78 })
      .toBuffer();

    const previewKey = `${artifact.objectKey}.preview.webp`;

    await context.storage.putObject(previewKey, thumbnail, "image/webp");

    await context.db
      .update(schema.artifacts)
      .set({
        previewKind: "IMAGE_THUMBNAIL",
        previewObjectKey: previewKey,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.artifacts.id, artifact.id));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    await markNoPreview(context, artifact.id, message);
  }
}

async function generateTextExcerpt(
  context: WorkerContext,
  artifact: ArtifactRow,
): Promise<void> {
  try {
    const bytes = await context.storage.getObject(artifact.objectKey);
    const slice = bytes.slice(0, TEXT_PREVIEW_BYTES);
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(slice);

    // Control characters are stripped so a preview cannot rewrite a terminal,
    // reorder text with bidirectional overrides, or corrupt a log line.
    const cleaned = decoded
      .split("")
      .filter((character) => {
        const code = character.codePointAt(0) ?? 0;
        const isPrintable = code >= 0x20 && code !== 0x7f;
        const isAllowedWhitespace =
          character === "\n" || character === "\t" || character === "\r";
        const isBidiOverride = code >= 0x202a && code <= 0x202e;

        return (isPrintable || isAllowedWhitespace) && !isBidiOverride;
      })
      .join("");

    await context.db
      .update(schema.artifacts)
      .set({
        previewKind: "TEXT_EXCERPT",
        previewText: cleaned,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.artifacts.id, artifact.id));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    await markNoPreview(context, artifact.id, message);
  }
}

async function markNoPreview(
  context: WorkerContext,
  artifactId: string,
  reason: string,
): Promise<void> {
  context.log(`no preview for artifact ${artifactId}: ${reason}`);

  await context.db
    .update(schema.artifacts)
    .set({ previewKind: "NONE", updatedAt: sql`now()` })
    .where(eq(schema.artifacts.id, artifactId));
}
