import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";

import type {
  Artifact,
  CreateEvidenceRequest,
  CreateUploadRequest,
  Evidence,
  UploadInstructions,
} from "@codevault/contracts";
import {
  ARTIFACT_KINDS,
  type ArtifactKind,
  type ContentVisibility,
} from "@codevault/core";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface CaptureArguments {
  caseId: string;
  findingId?: string;
  file: string | null;
  name?: string;
  title?: string;
  descriptionMarkdown?: string;
  mimeType: string;
  artifactKind: ArtifactKind;
  visibility: ContentVisibility;
  sourceTime?: string;
}

export interface CaptureResult {
  artifact: Artifact;
  evidence: Evidence;
}

export function parseCaptureArguments(
  args: readonly string[],
): CaptureArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!;
    if (!flag.startsWith("--")) throw new Error(`Unexpected argument: ${flag}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} needs a value.`);
    }
    if (values.has(flag)) throw new Error(`${flag} can be supplied only once.`);
    values.set(flag, value);
    index += 1;
  }

  const known = new Set([
    "--case",
    "--finding",
    "--file",
    "--name",
    "--title",
    "--description",
    "--mime",
    "--type",
    "--visibility",
    "--source-time",
  ]);
  for (const flag of values.keys()) {
    if (!known.has(flag)) throw new Error(`Unknown capture option: ${flag}`);
  }

  const caseId = values.get("--case") ?? "";
  if (!UUID.test(caseId)) throw new Error("--case must be a CodeVault UUID.");
  const findingId = values.get("--finding");
  if (findingId !== undefined && !UUID.test(findingId)) {
    throw new Error("--finding must be a CodeVault UUID.");
  }
  const artifactKind = values.get("--type") ?? "OTHER";
  if (!ARTIFACT_KINDS.includes(artifactKind as ArtifactKind)) {
    throw new Error(`Unknown artifact kind: ${artifactKind}`);
  }
  const visibility = values.get("--visibility") ?? "INTERNAL";
  if (!isVisibility(visibility)) {
    throw new Error(`Unknown visibility: ${visibility}`);
  }
  const sourceTime = values.get("--source-time");
  if (sourceTime !== undefined && !isTimestamp(sourceTime)) {
    throw new Error("--source-time must be an ISO 8601 timestamp.");
  }

  return {
    caseId,
    ...(findingId === undefined ? {} : { findingId }),
    file: values.get("--file") ?? null,
    ...(values.get("--name") === undefined
      ? {}
      : { name: values.get("--name")! }),
    ...(values.get("--title") === undefined
      ? {}
      : { title: values.get("--title")! }),
    ...(values.get("--description") === undefined
      ? {}
      : { descriptionMarkdown: values.get("--description")! }),
    mimeType: values.get("--mime") ?? "application/octet-stream",
    artifactKind: artifactKind as ArtifactKind,
    visibility,
    ...(sourceTime === undefined ? {} : { sourceTime }),
  };
}

export async function capture(
  arguments_: CaptureArguments,
  config: { baseUrl: string; token: string },
  input: NodeJS.ReadableStream = process.stdin,
): Promise<CaptureResult> {
  const client = new CaptureClient(config);
  let temporaryDirectory: string | null = null;
  let path = arguments_.file;
  try {
    if (path === null) {
      temporaryDirectory = await mkdtemp(join(tmpdir(), "codevault-capture-"));
      path = join(temporaryDirectory, "stdin");
      await pipeline(
        input,
        createWriteStream(path, { flags: "wx", mode: 0o600 }),
      );
    }
    const info = await stat(path);
    if (!info.isFile())
      throw new Error("The capture source must be a regular file.");
    const filename = safeFilename(
      arguments_.name ?? (arguments_.file === null ? "stdin" : basename(path)),
    );
    const capturedAt = arguments_.sourceTime ?? info.mtime.toISOString();
    const sha256 = await hashFile(path);
    const artifact = await client.upload(path, {
      caseId: arguments_.caseId,
      ...(arguments_.findingId === undefined
        ? {}
        : { findingId: arguments_.findingId }),
      filename,
      mimeType: arguments_.mimeType,
      sizeBytes: info.size,
      sha256,
      artifactKind: arguments_.artifactKind,
      visibility: arguments_.visibility,
      capturedAt,
      metadata: {
        captureSource: arguments_.file === null ? "STDIN" : "FILE",
        originalName: filename,
      },
    });
    const evidence = await client.request<Evidence>("/v1/evidence", "POST", {
      caseId: arguments_.caseId,
      ...(arguments_.findingId === undefined
        ? {}
        : { findingId: arguments_.findingId }),
      title: arguments_.title ?? filename,
      ...(arguments_.descriptionMarkdown === undefined
        ? {}
        : { descriptionMarkdown: arguments_.descriptionMarkdown }),
      visibility: arguments_.visibility,
      capturedAt,
      artifactIds: [artifact.id],
    } satisfies CreateEvidenceRequest);
    return { artifact, evidence };
  } finally {
    if (temporaryDirectory !== null) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

class CaptureClient {
  readonly #baseUrl: string;
  readonly #token: string;

  constructor(config: { baseUrl: string; token: string }) {
    const url = new URL(config.baseUrl);
    const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
      url.hostname,
    );
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
      throw new Error("CODEVAULT_URL must use HTTPS unless it is loopback.");
    }
    if (config.token.trim().length < 32)
      throw new Error("CODEVAULT_TOKEN is missing or too short.");
    this.#baseUrl = url.origin;
    this.#token = config.token.trim();
  }

  async upload(path: string, body: CreateUploadRequest): Promise<Artifact> {
    const instructions = await this.request<UploadInstructions>(
      "/v1/uploads",
      "POST",
      body,
    );
    try {
      const parts =
        instructions.strategy === "SINGLE"
          ? await uploadSingle(path, instructions)
          : await uploadParts(path, body.sizeBytes, instructions);
      return await this.request<Artifact>(
        `/v1/uploads/${encodeURIComponent(instructions.artifactId)}/complete`,
        "POST",
        parts.length === 0 ? {} : { parts },
      );
    } catch (error: unknown) {
      await this.request(
        `/v1/uploads/${encodeURIComponent(instructions.artifactId)}/abort`,
        "POST",
      ).catch(() => undefined);
      throw error;
    }
  }

  async request<T>(
    path: string,
    method: "GET" | "POST",
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`${this.#baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.#token}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      throw new Error(
        serverMessage(payload) ?? `CodeVault returned HTTP ${response.status}.`,
      );
    }
    return payload as T;
  }
}

async function uploadSingle(
  path: string,
  instructions: UploadInstructions,
): Promise<[]> {
  if (instructions.url === null)
    throw new Error("CodeVault returned no upload URL.");
  const response = await fetch(instructions.url, {
    method: "PUT",
    headers: instructions.requiredHeaders,
    body: createReadStream(path),
    duplex: "half",
  });
  if (!response.ok)
    throw new Error(`Object storage returned HTTP ${response.status}.`);
  return [];
}

async function uploadParts(
  path: string,
  sizeBytes: number,
  instructions: UploadInstructions,
): Promise<Array<{ partNumber: number; etag: string }>> {
  const handle = await open(path, "r");
  const parts: Array<{ partNumber: number; etag: string }> = [];
  try {
    for (const [index, url] of instructions.partUrls.entries()) {
      const length = Math.min(
        instructions.partSizeBytes,
        sizeBytes - index * instructions.partSizeBytes,
      );
      if (length <= 0) break;
      const bytes = Buffer.alloc(length);
      await handle.read(bytes, 0, length, index * instructions.partSizeBytes);
      const response = await fetch(url, { method: "PUT", body: bytes });
      if (!response.ok)
        throw new Error(
          `Object storage returned HTTP ${response.status} for part ${index + 1}.`,
        );
      const etag = response.headers.get("etag");
      if (etag === null)
        throw new Error(
          `Object storage returned no ETag for part ${index + 1}.`,
        );
      parts.push({ partNumber: index + 1, etag });
    }
    return parts;
  } finally {
    await handle.close();
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function safeFilename(value: string): string {
  const name = basename(value).replace(/[\r\n\0]/gu, "_");
  if (name === "" || name.length > 300)
    throw new Error("The capture name must be 1 to 300 characters.");
  return name;
}

function serverMessage(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const error = (value as Record<string, unknown>)["error"];
  if (typeof error !== "object" || error === null) return null;
  const message = (error as Record<string, unknown>)["message"];
  return typeof message === "string" ? message : null;
}

function isVisibility(value: string): value is ContentVisibility {
  return value === "INTERNAL" || value === "VENDOR" || value === "PUBLIC";
}

function isTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value)) && value.includes("T");
}
