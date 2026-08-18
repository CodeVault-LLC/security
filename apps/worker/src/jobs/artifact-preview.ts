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
 * Text is excerpted with a hard byte cap and control characters stripped.
 * Every parser-driven format — including raster images, archives, binaries,
 * firmware, PDFs, and SVG — gets metadata only until it has a dedicated,
 * least-privilege process boundary. Native decoders must never run in this
 * broadly privileged queue worker.
 */

export interface ArtifactPreviewJobData {
  artifactId: string;
  caseId: string;
}

/** Longest text excerpt retained, in bytes. */
const TEXT_PREVIEW_BYTES = 16 * 1024;

const TEXT_MIME_PREFIXES = ["text/"];

const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/x-httpd-php",
  "application/javascript",
  "application/x-sh",
]);

type ArtifactRow = typeof schema.artifacts.$inferSelect;

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

async function generateTextExcerpt(
  context: WorkerContext,
  artifact: ArtifactRow,
): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    let remaining = TEXT_PREVIEW_BYTES;
    const stream = await context.storage.getObjectStream(artifact.objectKey);
    for await (const chunk of stream) {
      if (remaining === 0) break;
      const bounded = Buffer.from(chunk).subarray(0, remaining);
      chunks.push(bounded);
      remaining -= bounded.byteLength;
    }
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(
      Buffer.concat(chunks),
    );

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
