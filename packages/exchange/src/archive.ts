import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  mkdir,
  open,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";

export const CVCASE_FORMAT = "codevault.cvcase" as const;
const MAGIC = Buffer.from("CODEVAULT-CVCASE/1\n", "utf8");
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_METADATA_BYTES = 64 * 1024 * 1024;

export interface CvcaseArtifactManifest {
  sourceId: string;
  archivePath: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  visibility: "INTERNAL" | "VENDOR" | "PUBLIC";
  artifactKind: string;
  capturedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CvcaseManifest {
  format: typeof CVCASE_FORMAT;
  version: 1;
  exportedAt: string;
  sourceVersion: string;
  case: { sourceId: string; ref: string; title: string };
  recordCounts: Record<string, number>;
  artifacts: CvcaseArtifactManifest[];
}

export interface CvcaseSource {
  manifest: CvcaseManifest;
  records: Record<string, unknown>;
  artifacts: Array<{ sourceId: string; path: string }>;
  signal?: AbortSignal;
  /** Set only after the caller obtains explicit overwrite confirmation. */
  overwriteExisting?: boolean;
}

export interface ExtractedCvcase {
  manifest: CvcaseManifest;
  records: Record<string, unknown>;
  artifacts: Array<{
    sourceId: string;
    path: string;
    sha256: string;
    sizeBytes: number;
  }>;
  cleanup(): Promise<void>;
}

interface EntryHeader {
  path: string;
  sizeBytes: number;
  sha256: string;
}

export async function writeCvcase(
  destination: string,
  source: CvcaseSource,
): Promise<void> {
  validateManifest(source.manifest);
  const byId = new Map(
    source.artifacts.map((item) => [item.sourceId, item.path]),
  );
  if (byId.size !== source.artifacts.length) {
    throw new Error("Each archive artifact must have one unique source ID.");
  }

  await mkdir(dirname(destination), { recursive: true });
  const partial = `${destination}.partial-${randomUUID()}`;
  const output = await open(partial, "wx", 0o600);
  try {
    await output.write(MAGIC);
    await writeBufferEntry(
      output,
      "manifest.json",
      Buffer.from(`${JSON.stringify(source.manifest)}\n`, "utf8"),
      source.signal,
    );
    await writeBufferEntry(
      output,
      "records.json",
      Buffer.from(`${JSON.stringify(source.records)}\n`, "utf8"),
      source.signal,
    );

    for (const artifact of source.manifest.artifacts) {
      throwIfAborted(source.signal);
      const sourcePath = byId.get(artifact.sourceId);
      if (sourcePath === undefined) {
        throw new Error(
          `Artifact ${artifact.sourceId} has no local source file.`,
        );
      }
      const info = await stat(sourcePath);
      if (!info.isFile())
        throw new Error(`Artifact ${artifact.sourceId} is not a file.`);
      if (info.size !== artifact.sizeBytes) {
        throw new Error(
          `Artifact ${artifact.sourceId} does not match its manifest size.`,
        );
      }
      await writeHeader(output, {
        path: artifact.archivePath,
        sizeBytes: artifact.sizeBytes,
        sha256: artifact.sha256,
      });
      const digest = createHash("sha256");
      for await (const chunk of createReadStream(sourcePath)) {
        throwIfAborted(source.signal);
        const bytes = chunk as Buffer;
        digest.update(bytes);
        await output.write(bytes);
      }
      await output.write("\n");
      if (digest.digest("hex") !== artifact.sha256) {
        throw new Error(
          `Artifact ${artifact.sourceId} does not match its manifest digest.`,
        );
      }
    }
  } catch (error: unknown) {
    await output.close().catch(() => undefined);
    await unlink(partial).catch(() => undefined);
    throw error;
  }
  await output.close();
  let destinationExists = false;
  try {
    await access(destination);
    destinationExists = true;
  } catch (error: unknown) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      await unlink(partial).catch(() => undefined);
      throw error;
    }
  }
  if (destinationExists) {
    if (source.overwriteExisting !== true) {
      await unlink(partial);
      throw new Error("The archive destination already exists.");
    }
    await unlink(destination);
  }
  await rename(partial, destination);
}

export async function readCvcase(
  archive: string,
  destination: string,
  signal?: AbortSignal,
): Promise<ExtractedCvcase> {
  const staging = `${destination}.partial-${randomUUID()}`;
  await mkdir(staging, { recursive: false, mode: 0o700 });
  let input: Awaited<ReturnType<typeof open>> | undefined;
  let position = 0;
  try {
    input = await open(archive, "r");
    const magic = Buffer.alloc(MAGIC.length);
    await readExact(input, magic, position);
    position += magic.length;
    if (!magic.equals(MAGIC))
      throw new Error("This is not a supported .cvcase archive.");

    const manifestEntry = await readHeader(input, position);
    position = manifestEntry.position;
    if (manifestEntry.header.path !== "manifest.json") {
      throw new Error("The .cvcase manifest must be the first entry.");
    }
    const manifestBytes = await readMetadataEntry(
      input,
      manifestEntry.header,
      position,
    );
    position += manifestEntry.header.sizeBytes + 1;
    verifyDigest(manifestEntry.header, manifestBytes);
    const manifest = parseManifest(manifestBytes);

    const recordsEntry = await readHeader(input, position);
    position = recordsEntry.position;
    if (recordsEntry.header.path !== "records.json") {
      throw new Error("The .cvcase records must follow the manifest.");
    }
    const recordBytes = await readMetadataEntry(
      input,
      recordsEntry.header,
      position,
    );
    position += recordsEntry.header.sizeBytes + 1;
    verifyDigest(recordsEntry.header, recordBytes);
    const parsedRecords = JSON.parse(recordBytes.toString("utf8")) as unknown;
    if (!isRecord(parsedRecords))
      throw new Error("The archive records are not an object.");

    const artifacts: ExtractedCvcase["artifacts"] = [];
    for (const expected of manifest.artifacts) {
      throwIfAborted(signal);
      const entry = await readHeader(input, position);
      position = entry.position;
      if (entry.header.path !== expected.archivePath) {
        throw new Error(
          `Archive entry ${entry.header.path} does not match its manifest.`,
        );
      }
      if (
        entry.header.sizeBytes !== expected.sizeBytes ||
        entry.header.sha256 !== expected.sha256
      ) {
        throw new Error(
          `Archive entry ${entry.header.path} does not match its manifest.`,
        );
      }
      const outputPath = safeJoin(staging, entry.header.path);
      await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
      await extractEntry(input, position, outputPath, entry.header, signal);
      position += entry.header.sizeBytes + 1;
      artifacts.push({
        sourceId: expected.sourceId,
        path: outputPath,
        sha256: expected.sha256,
        sizeBytes: expected.sizeBytes,
      });
    }
    if (position !== (await input.stat()).size) {
      throw new Error("The .cvcase archive contains unexpected trailing data.");
    }
    await input.close();
    await rename(staging, destination);
    return {
      manifest,
      records: parsedRecords,
      artifacts: artifacts.map((item) => ({
        ...item,
        path: join(destination, relative(staging, item.path)),
      })),
      cleanup: () => rm(destination, { recursive: true, force: true }),
    };
  } catch (error: unknown) {
    await input?.close().catch(() => undefined);
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeBufferEntry(
  output: Awaited<ReturnType<typeof open>>,
  path: string,
  bytes: Buffer,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const header = {
    path,
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  await writeHeader(output, header);
  await output.write(bytes);
  await output.write("\n");
}

async function writeHeader(
  output: Awaited<ReturnType<typeof open>>,
  header: EntryHeader,
): Promise<void> {
  assertSafePath(header.path);
  await output.write(`${JSON.stringify(header)}\n`);
}

async function readHeader(
  input: Awaited<ReturnType<typeof open>>,
  start: number,
): Promise<{ header: EntryHeader; position: number }> {
  const chunks: number[] = [];
  const byte = Buffer.alloc(1);
  let position = start;
  while (chunks.length <= MAX_HEADER_BYTES) {
    const result = await input.read(byte, 0, 1, position);
    if (result.bytesRead === 0)
      throw new Error("The archive ended inside an entry header.");
    position += 1;
    if (byte[0] === 10) break;
    chunks.push(byte[0]!);
  }
  if (chunks.length > MAX_HEADER_BYTES)
    throw new Error("An archive entry header is too large.");
  const parsed = JSON.parse(Buffer.from(chunks).toString("utf8")) as unknown;
  if (
    !isRecord(parsed) ||
    typeof parsed.path !== "string" ||
    typeof parsed.sizeBytes !== "number" ||
    !Number.isSafeInteger(parsed.sizeBytes) ||
    parsed.sizeBytes < 0 ||
    typeof parsed.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(parsed.sha256)
  ) {
    throw new Error("An archive entry header is invalid.");
  }
  assertSafePath(parsed.path);
  return { header: parsed as unknown as EntryHeader, position };
}

async function readMetadataEntry(
  input: Awaited<ReturnType<typeof open>>,
  header: EntryHeader,
  position: number,
): Promise<Buffer> {
  if (header.sizeBytes > MAX_METADATA_BYTES) {
    throw new Error(`${header.path} exceeds the archive metadata limit.`);
  }
  const bytes = Buffer.alloc(header.sizeBytes);
  await readExact(input, bytes, position);
  await assertSeparator(input, position + header.sizeBytes);
  return bytes;
}

async function extractEntry(
  input: Awaited<ReturnType<typeof open>>,
  position: number,
  outputPath: string,
  header: EntryHeader,
  signal?: AbortSignal,
): Promise<void> {
  const output = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
  const hash = createHash("sha256");
  let remaining = header.sizeBytes;
  let offset = position;
  try {
    while (remaining > 0) {
      throwIfAborted(signal);
      const chunk = Buffer.alloc(Math.min(1024 * 1024, remaining));
      await readExact(input, chunk, offset);
      offset += chunk.length;
      remaining -= chunk.length;
      hash.update(chunk);
      if (!output.write(chunk)) {
        await new Promise<void>((resolve, reject) => {
          output.once("drain", resolve);
          output.once("error", reject);
        });
      }
    }
    output.end();
    await new Promise<void>((resolve, reject) => {
      output.once("close", resolve);
      output.once("error", reject);
    });
  } catch (error: unknown) {
    output.destroy();
    throw error;
  }
  await assertSeparator(input, position + header.sizeBytes);
  if (hash.digest("hex") !== header.sha256) {
    throw new Error(
      `Archive entry ${header.path} failed SHA-256 verification.`,
    );
  }
}

async function readExact(
  input: Awaited<ReturnType<typeof open>>,
  buffer: Buffer,
  position: number,
): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const result = await input.read(
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    );
    if (result.bytesRead === 0)
      throw new Error("The archive ended before an entry was complete.");
    offset += result.bytesRead;
  }
}

async function assertSeparator(
  input: Awaited<ReturnType<typeof open>>,
  position: number,
): Promise<void> {
  const separator = Buffer.alloc(1);
  await readExact(input, separator, position);
  if (separator[0] !== 10)
    throw new Error("An archive entry has no terminator.");
}

function parseManifest(bytes: Buffer): CvcaseManifest {
  const value = JSON.parse(bytes.toString("utf8")) as unknown;
  validateManifest(value);
  return value;
}

function validateManifest(value: unknown): asserts value is CvcaseManifest {
  if (
    !isRecord(value) ||
    value.format !== CVCASE_FORMAT ||
    value.version !== 1 ||
    typeof value.exportedAt !== "string" ||
    typeof value.sourceVersion !== "string" ||
    !isRecord(value.case) ||
    typeof value.case.sourceId !== "string" ||
    typeof value.case.ref !== "string" ||
    typeof value.case.title !== "string" ||
    !isRecord(value.recordCounts) ||
    !Array.isArray(value.artifacts)
  ) {
    throw new Error("The .cvcase manifest is invalid or incompatible.");
  }
  const ids = new Set<string>();
  for (const item of value.artifacts) {
    if (
      !isRecord(item) ||
      typeof item.sourceId !== "string" ||
      typeof item.archivePath !== "string" ||
      typeof item.filename !== "string" ||
      typeof item.mimeType !== "string" ||
      typeof item.sizeBytes !== "number" ||
      !Number.isSafeInteger(item.sizeBytes) ||
      item.sizeBytes < 0 ||
      typeof item.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(item.sha256) ||
      typeof item.visibility !== "string" ||
      typeof item.artifactKind !== "string"
    ) {
      throw new Error("The .cvcase artifact manifest is invalid.");
    }
    assertSafePath(item.archivePath);
    if (ids.has(item.sourceId))
      throw new Error("The .cvcase manifest repeats an artifact ID.");
    ids.add(item.sourceId);
  }
}

function verifyDigest(header: EntryHeader, bytes: Buffer): void {
  if (createHash("sha256").update(bytes).digest("hex") !== header.sha256) {
    throw new Error(
      `Archive entry ${header.path} failed SHA-256 verification.`,
    );
  }
}

function safeJoin(root: string, path: string): string {
  assertSafePath(path);
  const destination = join(root, ...path.split("/"));
  const relativePath = relative(root, destination);
  if (relativePath.startsWith(`..${sep}`) || relativePath === "..") {
    throw new Error("An archive entry is outside the extraction folder.");
  }
  return destination;
}

function assertSafePath(path: string): void {
  const normalized = normalize(path.replaceAll("/", sep));
  if (
    path === "" ||
    path.includes("\\") ||
    path.includes("\0") ||
    isAbsolute(path) ||
    normalized === ".." ||
    normalized.startsWith(`..${sep}`) ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`${path || "Archive entry"} is not a safe relative path.`);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new Error("The case archive operation was cancelled.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
