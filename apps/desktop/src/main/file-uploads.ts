import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { basename, extname } from "node:path";

import type { UploadInstructions } from "@codevault/contracts";

import type {
  StartUploadRequest,
  UploadProgress,
  UploadSelection,
} from "../preload/contracts.js";
import type { ApiClient } from "./api-client.js";

/**
 * File uploads.
 *
 * Bytes never enter the renderer and never enter the API. The main process
 * hashes the file by streaming it, asks the server for presigned instructions,
 * streams the bytes straight to object storage, and confirms.
 *
 * That shape is what makes a 10 GiB firmware image an ordinary upload: nothing
 * along the path ever holds the whole file, and the renderer only receives
 * progress numbers.
 */

/** MIME types inferred from an extension when the OS does not supply one. */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".har": "application/json",
  ".xml": "application/xml",
  ".pcap": "application/vnd.tcpdump.pcap",
  ".pcapng": "application/vnd.tcpdump.pcap",
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".bin": "application/octet-stream",
  ".py": "text/x-python",
  ".js": "text/javascript",
  ".c": "text/x-c",
  ".go": "text/x-go",
  ".rs": "text/x-rust",
};

/**
 * Hashes a file and collects its metadata.
 *
 * Streamed so a firmware image does not have to fit in memory. The digest is
 * computed here, on the researcher's machine, and the server later verifies
 * that the object actually stored matches the size that was declared.
 */
export async function hashSelection(path: string): Promise<UploadSelection> {
  const info = await stat(path);
  const hash = createHash("sha256");
  const stream = createReadStream(path, { highWaterMark: 1024 * 1024 });

  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }

  const filename = basename(path);

  return {
    path,
    filename,
    sizeBytes: info.size,
    mimeType:
      MIME_BY_EXTENSION[extname(filename).toLowerCase()] ??
      "application/octet-stream",
    sha256: hash.digest("hex"),
  };
}

export interface RunUploadsOptions {
  request: StartUploadRequest;
  apiClient: ApiClient;
  onProgress: (progress: UploadProgress) => void;
}

export async function runUploads(
  options: RunUploadsOptions,
): Promise<string[]> {
  const artifactIds: string[] = [];

  for (const selection of options.request.selections) {
    const artifactId = await uploadOne(selection, options);

    artifactIds.push(artifactId);
  }

  return artifactIds;
}

async function uploadOne(
  selection: UploadSelection,
  options: RunUploadsOptions,
): Promise<string> {
  const { apiClient, request, onProgress } = options;

  const instructions = await apiClient.request<UploadInstructions>(
    "/v1/uploads",
    {
      method: "POST",
      body: {
        caseId: request.caseId,
        ...(request.findingId === undefined
          ? {}
          : { findingId: request.findingId }),
        filename: selection.filename,
        mimeType: selection.mimeType,
        sizeBytes: selection.sizeBytes,
        sha256: selection.sha256,
        artifactKind: request.artifactKind,
        visibility: request.visibility,
      },
    },
  );

  onProgress({
    uploadId: instructions.artifactId,
    filename: selection.filename,
    phase: "UPLOADING",
    progress: 0,
    message: null,
  });

  try {
    const parts =
      instructions.strategy === "SINGLE"
        ? await uploadSingle(selection, instructions, onProgress)
        : await uploadMultipart(selection, instructions, onProgress);

    onProgress({
      uploadId: instructions.artifactId,
      filename: selection.filename,
      phase: "COMPLETING",
      progress: 1,
      message: null,
    });

    await apiClient.request(`/v1/uploads/${instructions.artifactId}/complete`, {
      method: "POST",
      body: parts.length === 0 ? {} : { parts },
    });

    onProgress({
      uploadId: instructions.artifactId,
      filename: selection.filename,
      phase: "DONE",
      progress: 1,
      message: null,
    });

    return instructions.artifactId;
  } catch (error: unknown) {
    onProgress({
      uploadId: instructions.artifactId,
      filename: selection.filename,
      phase: "FAILED",
      progress: null,
      message: error instanceof Error ? error.message : "The upload failed.",
    });

    throw error;
  }
}

interface CompletedPart {
  partNumber: number;
  etag: string;
}

async function uploadSingle(
  selection: UploadSelection,
  instructions: UploadInstructions,
  onProgress: (progress: UploadProgress) => void,
): Promise<CompletedPart[]> {
  if (instructions.url === null) {
    throw new Error("The server did not return an upload URL.");
  }

  const handle = await open(selection.path, "r");

  try {
    // Read into a stream rather than a buffer: single-part uploads are still
    // up to the multipart threshold, which is tens of megabytes.
    const stream = handle.createReadStream({ highWaterMark: 1024 * 1024 });
    let uploaded = 0;

    stream.on("data", (chunk: Buffer | string) => {
      uploaded += typeof chunk === "string" ? chunk.length : chunk.byteLength;

      onProgress({
        uploadId: instructions.artifactId,
        filename: selection.filename,
        phase: "UPLOADING",
        progress:
          selection.sizeBytes === 0 ? 1 : uploaded / selection.sizeBytes,
        message: null,
      });
    });

    // Node's fetch accepts a Readable as a streaming body, and requires
    // `duplex: "half"` to do so. Neither is in the DOM `RequestInit` type,
    // so the options object is assembled and typed at this one boundary.
    const requestInit: RequestInit & { duplex: "half" } = {
      method: "PUT",
      headers: {
        ...instructions.requiredHeaders,
      },
      body: stream as unknown as ReadableStream<Uint8Array>,
      duplex: "half",
    };

    const response = await fetch(instructions.url, requestInit);

    if (!response.ok) {
      throw new Error(
        `Object storage rejected the upload (${response.status}).`,
      );
    }

    return [];
  } finally {
    await handle.close();
  }
}

async function uploadMultipart(
  selection: UploadSelection,
  instructions: UploadInstructions,
  onProgress: (progress: UploadProgress) => void,
): Promise<CompletedPart[]> {
  const handle = await open(selection.path, "r");
  const parts: CompletedPart[] = [];

  try {
    for (const [index, url] of instructions.partUrls.entries()) {
      const offset = index * instructions.partSizeBytes;
      const length = Math.min(
        instructions.partSizeBytes,
        selection.sizeBytes - offset,
      );

      if (length <= 0) {
        break;
      }

      const buffer = Buffer.alloc(length);

      await handle.read(buffer, 0, length, offset);

      const response = await fetch(url, {
        method: "PUT",
        headers: { "content-length": String(length) },
        body: buffer,
      });

      if (!response.ok) {
        throw new Error(
          `Object storage rejected part ${index + 1} (${response.status}).`,
        );
      }

      const etag = response.headers.get("etag");

      if (etag === null) {
        throw new Error(
          `Object storage did not return an ETag for part ${index + 1}.`,
        );
      }

      parts.push({ partNumber: index + 1, etag });

      onProgress({
        uploadId: instructions.artifactId,
        filename: selection.filename,
        phase: "UPLOADING",
        progress: (index + 1) / instructions.partUrls.length,
        message: null,
      });
    }

    return parts;
  } finally {
    await handle.close();
  }
}
