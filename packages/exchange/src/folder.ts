import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";

import type { IntakeDraft } from "@codevault/contracts";

import {
  parseFindingsCsv,
  parseFindingsJson,
  parseFindingsSarif,
  type ExchangeFinding,
} from "./finding-exchange.js";

const MAPPABLE_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".sarif",
]);
const DEFAULT_MAX_FILES = 5_000;
const DEFAULT_MAX_MAPPABLE_BYTES = 10 * 1024 * 1024;

export interface FolderPreviewOptions {
  existingTitles?: readonly string[];
  existingDigests?: readonly string[];
  signal?: AbortSignal;
  maxFiles?: number;
  maxMappableBytes?: number;
}

export interface FolderPreviewFile {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
  disposition: "MAPPED" | "ATTACHMENT" | "MAPPING_ERROR";
}

export interface FolderIntakeCandidate {
  clientId: string;
  sourcePath: string;
  sourceSha256: string;
  draft: IntakeDraft;
  status: "READY" | "DUPLICATE";
  duplicateReasons: string[];
}

export interface FolderAttachment {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
  duplicateOf: string | null;
}

export interface FolderIntakePreview {
  rootName: string;
  files: FolderPreviewFile[];
  candidates: FolderIntakeCandidate[];
  attachments: FolderAttachment[];
  errors: string[];
  totalBytes: number;
}

export interface ExplicitFilePreview {
  preview: FolderIntakePreview;
  sources: Array<{
    absolutePath: string;
    relativePath: string;
  }>;
}

export async function previewFolder(
  root: string,
  options: FolderPreviewOptions = {},
): Promise<FolderIntakePreview> {
  const absoluteRoot = resolve(root);
  const paths = await walk(absoluteRoot, options);
  return previewSources(
    absoluteRoot.split(sep).at(-1) ?? "folder",
    paths.map((path) => ({
      absolutePath: path,
      relativePath: toArchivePath(relative(absoluteRoot, path)),
    })),
    options,
  );
}

/** Preview only the files explicitly selected by the user. */
export async function previewFiles(
  paths: readonly string[],
  options: FolderPreviewOptions = {},
): Promise<ExplicitFilePreview> {
  const uniquePaths = [...new Set(paths.map((path) => resolve(path)))];
  if (uniquePaths.length === 0) {
    throw new Error("Select at least one finding file.");
  }
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  if (uniquePaths.length > maxFiles) {
    throw new Error(`Select at most ${maxFiles} files at once.`);
  }

  const relativePaths = droppedRelativePaths(uniquePaths);
  const sources = await Promise.all(
    uniquePaths.map(async (absolutePath, index) => {
      const info = await lstat(absolutePath);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error(
          "Only files can be dropped. Use folder intake to select a folder.",
        );
      }
      return {
        absolutePath,
        relativePath: relativePaths[index]!,
      };
    }),
  );
  sources.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );

  return {
    preview: await previewSources(
      sources.length === 1
        ? sources[0]!.relativePath
        : `${sources.length} dropped files`,
      sources,
      options,
    ),
    sources,
  };
}

async function previewSources(
  rootName: string,
  sources: readonly { absolutePath: string; relativePath: string }[],
  options: FolderPreviewOptions,
): Promise<FolderIntakePreview> {
  const files: FolderPreviewFile[] = [];
  const candidates: FolderIntakeCandidate[] = [];
  const attachments: FolderAttachment[] = [];
  const errors: string[] = [];
  const selectedDigests = new Map<string, string>();
  const existingTitles = new Set(
    (options.existingTitles ?? []).map(normalizeTitle),
  );
  const existingDigests = new Set(options.existingDigests ?? []);
  let totalBytes = 0;

  for (const source of sources) {
    throwIfAborted(options.signal);
    const path = source.absolutePath;
    const info = await lstat(path);
    const relativePath = source.relativePath;
    const sha256 = await hashFile(path, options.signal);
    totalBytes += info.size;
    const firstDigestPath = selectedDigests.get(sha256) ?? null;
    selectedDigests.set(sha256, firstDigestPath ?? relativePath);
    const extension = extname(path).toLowerCase();

    if (!MAPPABLE_EXTENSIONS.has(extension)) {
      files.push({
        relativePath,
        sizeBytes: info.size,
        sha256,
        disposition: "ATTACHMENT",
      });
      attachments.push({
        relativePath,
        sizeBytes: info.size,
        sha256,
        duplicateOf:
          firstDigestPath ?? (existingDigests.has(sha256) ? "case" : null),
      });
      continue;
    }

    if (info.size > (options.maxMappableBytes ?? DEFAULT_MAX_MAPPABLE_BYTES)) {
      const message = `${relativePath} is too large to map as structured text.`;
      errors.push(message);
      files.push({
        relativePath,
        sizeBytes: info.size,
        sha256,
        disposition: "MAPPING_ERROR",
      });
      continue;
    }

    try {
      const text = await readFile(path, "utf8");
      const mapped = mapText(extension, text);
      for (const item of mapped) {
        const duplicateReasons: string[] = [];
        const normalizedTitle = normalizeTitle(item.title);
        if (existingTitles.has(normalizedTitle)) {
          duplicateReasons.push(
            "A finding with this normalized title already exists in the case.",
          );
        }
        if (existingDigests.has(sha256)) {
          duplicateReasons.push(
            "The source file is already stored in this case; this is not a finding match.",
          );
        }
        if (firstDigestPath !== null) {
          duplicateReasons.push(
            "Another source file in this import has the same SHA-256 digest.",
          );
        }
        candidates.push({
          clientId: randomUUID(),
          sourcePath: relativePath,
          sourceSha256: sha256,
          draft: toIntakeDraft(item),
          status: existingTitles.has(normalizedTitle) ? "DUPLICATE" : "READY",
          duplicateReasons,
        });
      }
      files.push({
        relativePath,
        sizeBytes: info.size,
        sha256,
        disposition: "MAPPED",
      });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : "Mapping failed.";
      errors.push(`${relativePath}: ${reason}`);
      files.push({
        relativePath,
        sizeBytes: info.size,
        sha256,
        disposition: "MAPPING_ERROR",
      });
    }
  }

  const titleCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const normalizedTitle = normalizeTitle(candidate.draft.title);
    titleCounts.set(
      normalizedTitle,
      (titleCounts.get(normalizedTitle) ?? 0) + 1,
    );
  }
  for (const candidate of candidates) {
    if ((titleCounts.get(normalizeTitle(candidate.draft.title)) ?? 0) < 2) {
      continue;
    }
    candidate.duplicateReasons.push(
      "Another proposal in this import has the same normalized title.",
    );
    candidate.status = "DUPLICATE";
  }

  return {
    rootName,
    files,
    candidates,
    attachments,
    errors,
    totalBytes,
  };
}

function droppedRelativePaths(paths: readonly string[]): string[] {
  const basenameCounts = new Map<string, number>();
  for (const path of paths) {
    const name = basename(path);
    basenameCounts.set(name, (basenameCounts.get(name) ?? 0) + 1);
  }

  const used = new Set<string>();
  return paths.map((path) => {
    const name = basename(path);
    let candidate =
      basenameCounts.get(name) === 1
        ? name
        : `${basename(dirname(path))}/${name}`;
    let prefix = 2;
    while (used.has(candidate)) {
      candidate = `${prefix}-${name}`;
      prefix += 1;
    }
    used.add(candidate);
    return candidate;
  });
}

async function walk(
  root: string,
  options: FolderPreviewOptions,
): Promise<string[]> {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory())
    throw new Error("The intake path must be a folder.");
  const files: string[] = [];
  const pending = [root];
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;

  while (pending.length > 0) {
    throwIfAborted(options.signal);
    const directory = pending.pop()!;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name === ".DS_Store") continue;
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) {
        files.push(path);
        if (files.length > maxFiles) {
          throw new Error(`The folder contains more than ${maxFiles} files.`);
        }
      }
    }
  }
  return files.sort((left, right) =>
    toArchivePath(relative(root, left)).localeCompare(
      toArchivePath(relative(root, right)),
    ),
  );
}

function mapText(extension: string, input: string): ExchangeFinding[] {
  if (extension === ".json") return parseFindingsJson(input);
  if (extension === ".csv") return parseFindingsCsv(input);
  if (extension === ".sarif") return parseFindingsSarif(input);
  return [parseMarkdownFinding(input)];
}

function parseMarkdownFinding(input: string): ExchangeFinding {
  const { attributes, body } = frontmatter(input);
  const heading = /^#\s+(.+)$/mu.exec(body)?.[1]?.trim();
  const title = attributes.title?.trim() || heading || "";
  if (title === "") {
    throw new Error("Markdown needs a title field or a level-one heading.");
  }
  const withoutHeading = heading
    ? body.replace(/^#\s+.+(?:\r?\n)+/u, "").trim()
    : body.trim();
  const cwe = attributes.cwe ?? attributes.cwe_ids ?? "";
  return {
    title,
    ...(withoutHeading === "" ? {} : { summaryMarkdown: withoutHeading }),
    cweIds: cwe.split(/[;,\s]+/u).filter(Boolean),
    visibility: "INTERNAL",
  };
}

function frontmatter(input: string): {
  attributes: Record<string, string>;
  body: string;
} {
  if (!input.startsWith("---\n") && !input.startsWith("---\r\n")) {
    return { attributes: {}, body: input };
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u.exec(input);
  if (match === null) throw new Error("Markdown front matter is not closed.");
  const attributes: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/u)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    attributes[line.slice(0, separator).trim().toLowerCase()] = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/gu, "");
  }
  return { attributes, body: input.slice(match[0].length) };
}

function toIntakeDraft(finding: ExchangeFinding): IntakeDraft {
  if (finding.title.length < 8 || finding.title.length > 200) {
    throw new Error("A mapped finding title must be 8 to 200 characters.");
  }
  if (finding.cweIds.length > 25) {
    throw new Error("A mapped finding can contain at most 25 CWE identifiers.");
  }
  if (finding.cweIds.some((id) => !/^CWE-[1-9][0-9]*$/u.test(id))) {
    throw new Error(
      "A mapped finding must contain only valid CWE identifiers.",
    );
  }
  for (const content of [
    finding.summaryMarkdown,
    finding.technicalMarkdown,
    finding.impactMarkdown,
    finding.remediationMarkdown,
  ]) {
    if ((content?.length ?? 0) > 200_000) {
      throw new Error(
        "Mapped Markdown cannot exceed 200000 characters per field.",
      );
    }
  }
  return {
    title: finding.title,
    ...(finding.summaryMarkdown === undefined
      ? {}
      : { summaryMarkdown: finding.summaryMarkdown }),
    ...(finding.technicalMarkdown === undefined
      ? {}
      : { technicalMarkdown: finding.technicalMarkdown }),
    ...(finding.impactMarkdown === undefined
      ? {}
      : { impactMarkdown: finding.impactMarkdown }),
    ...(finding.remediationMarkdown === undefined
      ? {}
      : { remediationMarkdown: finding.remediationMarkdown }),
    suggestedCweIds: finding.cweIds,
    affectedVersions: [],
  };
}

async function hashFile(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    throwIfAborted(signal);
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

function normalizeTitle(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/gu, " ");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Folder intake was cancelled.");
}

function toArchivePath(path: string): string {
  return path.split(sep).join("/");
}
