import { createHash } from "node:crypto";
import {
  appendFile,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CVCASE_FORMAT,
  readCvcase,
  writeCvcase,
  type CvcaseManifest,
} from "./archive.js";

const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

function manifest(): CvcaseManifest {
  return {
    format: CVCASE_FORMAT,
    version: 1,
    exportedAt: "2026-08-21T10:00:00.000Z",
    sourceVersion: "0.1.0-alpha.8",
    case: {
      sourceId: "00000000-0000-4000-8000-000000000001",
      ref: "CASE-2026-0001",
      title: "Archive test",
    },
    recordCounts: { findings: 1, artifacts: 1 },
    artifacts: [
      {
        sourceId: "00000000-0000-4000-8000-000000000002",
        archivePath:
          "artifacts/00000000-0000-4000-8000-000000000002/request.txt",
        filename: "request.txt",
        mimeType: "text/plain",
        sizeBytes: 7,
        sha256: digest("request"),
        visibility: "INTERNAL",
        artifactKind: "HTTP_CAPTURE",
      },
    ],
  };
}

describe(".cvcase archive", () => {
  it("round-trips records and verifies artifact digests", async () => {
    const root = await mkdtemp(join(tmpdir(), "codevault-archive-"));
    const artifact = join(root, "request.txt");
    const archive = join(root, "case.cvcase");
    await writeFile(artifact, "request");

    await writeCvcase(archive, {
      manifest: manifest(),
      records: { findings: [{ title: "Archive finding" }] },
      artifacts: [
        { sourceId: manifest().artifacts[0]!.sourceId, path: artifact },
      ],
    });
    const extracted = await readCvcase(archive, join(root, "extracted"));

    expect(extracted.manifest).toEqual(manifest());
    expect(extracted.records).toEqual({
      findings: [{ title: "Archive finding" }],
    });
    await expect(readFile(extracted.artifacts[0]!.path, "utf8")).resolves.toBe(
      "request",
    );
  });

  it("rejects traversal paths before writing extracted content", async () => {
    const root = await mkdtemp(join(tmpdir(), "codevault-archive-"));
    const archive = join(root, "bad.cvcase");
    const unsafe = manifest();
    unsafe.artifacts[0]!.archivePath = "../escaped.txt";

    await expect(
      writeCvcase(archive, {
        manifest: unsafe,
        records: {},
        artifacts: [
          {
            sourceId: unsafe.artifacts[0]!.sourceId,
            path: join(root, "missing"),
          },
        ],
      }),
    ).rejects.toThrow("safe relative path");
  });

  it("rejects an artifact whose bytes do not match the manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "codevault-archive-"));
    const artifact = join(root, "request.txt");
    const archive = join(root, "bad.cvcase");
    await writeFile(artifact, "changed");

    await expect(
      writeCvcase(archive, {
        manifest: manifest(),
        records: {},
        artifacts: [
          { sourceId: manifest().artifacts[0]!.sourceId, path: artifact },
        ],
      }),
    ).rejects.toThrow("does not match its manifest");
  });

  it("rejects manifests that repeat an artifact archive path", async () => {
    const root = await mkdtemp(join(tmpdir(), "codevault-archive-"));
    const repeated = manifest();
    repeated.artifacts.push({
      ...repeated.artifacts[0]!,
      sourceId: "00000000-0000-4000-8000-000000000003",
    });

    await expect(
      writeCvcase(join(root, "bad.cvcase"), {
        manifest: repeated,
        records: {},
        artifacts: [],
      }),
    ).rejects.toThrow("repeats an artifact archive path");
  });

  it("rejects invalid manifest record counts", async () => {
    const root = await mkdtemp(join(tmpdir(), "codevault-archive-"));
    const invalid = manifest();
    invalid.recordCounts.findings = -1;

    await expect(
      writeCvcase(join(root, "bad.cvcase"), {
        manifest: invalid,
        records: {},
        artifacts: [],
      }),
    ).rejects.toThrow("record counts are invalid");
  });

  it("does not overwrite an existing archive without caller confirmation", async () => {
    const root = await mkdtemp(join(tmpdir(), "codevault-archive-"));
    const artifact = join(root, "request.txt");
    const archive = join(root, "case.cvcase");
    await writeFile(artifact, "request");
    await writeFile(archive, "existing archive");

    await expect(
      writeCvcase(archive, {
        manifest: manifest(),
        records: {},
        artifacts: [
          { sourceId: manifest().artifacts[0]!.sourceId, path: artifact },
        ],
      }),
    ).rejects.toThrow("destination already exists");
    await expect(readFile(archive, "utf8")).resolves.toBe("existing archive");
  });

  it("rejects data appended after the declared archive entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "codevault-archive-"));
    const artifact = join(root, "request.txt");
    const archive = join(root, "case.cvcase");
    await writeFile(artifact, "request");
    await writeCvcase(archive, {
      manifest: manifest(),
      records: {},
      artifacts: [
        { sourceId: manifest().artifacts[0]!.sourceId, path: artifact },
      ],
    });
    await appendFile(archive, "unexpected");

    await expect(readCvcase(archive, join(root, "extracted"))).rejects.toThrow(
      "unexpected trailing data",
    );
  });

  it("cleans staging when the source archive cannot be opened", async () => {
    const root = await mkdtemp(join(tmpdir(), "codevault-archive-"));

    await expect(
      readCvcase(join(root, "missing.cvcase"), join(root, "extracted")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    await expect(readdir(root)).resolves.toEqual([]);
  });
});
