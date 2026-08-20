import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

interface PackageManifest {
  name: string;
  version: string;
}

interface EvidenceFile {
  path: string;
  sha256: string;
  size: number;
}

interface ReleaseEvidenceManifest {
  schemaVersion: 1;
  product: "CodeVault Security";
  version: string;
  source: {
    repository: "https://github.com/CodeVault-LLC/security";
    commit: string;
  };
  generatedAt: string;
  files: EvidenceFile[];
}

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PACKAGE_MANIFEST_PATH = join(REPOSITORY_ROOT, "package.json");
const DESKTOP_MANIFEST_PATH = join(
  REPOSITORY_ROOT,
  "apps",
  "desktop",
  "package.json",
);
const CHECKSUM_FILE = "SHA256SUMS";
const EVIDENCE_FILE = "release-evidence.json";

function readPackageManifest(): PackageManifest {
  return JSON.parse(
    readFileSync(PACKAGE_MANIFEST_PATH, "utf8"),
  ) as PackageManifest;
}

function normalizeReleaseTag(tag: string): string {
  return tag.startsWith("refs/tags/") ? tag.slice("refs/tags/".length) : tag;
}

export function assertReleaseTag(tag: string, version: string): void {
  const normalized = normalizeReleaseTag(tag);
  const expected = `v${version}`;

  if (normalized !== expected) {
    throw new Error(
      `Release tag ${JSON.stringify(normalized)} does not match package version ${JSON.stringify(expected)}.`,
    );
  }

  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(normalized)) {
    throw new Error(`Release tag ${JSON.stringify(normalized)} is not SemVer.`);
  }
}

export function assertReleaseVersions(
  rootVersion: string,
  desktopVersion: string,
): void {
  if (desktopVersion !== rootVersion) {
    throw new Error(
      `Desktop version ${JSON.stringify(desktopVersion)} does not match release version ${JSON.stringify(rootVersion)}.`,
    );
  }
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function toPortablePath(path: string): string {
  return path.split(sep).join("/");
}

function listFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Release evidence cannot include symbolic link ${path}.`);
    }
    if (entry.isDirectory()) files.push(...listFiles(path));
    else if (entry.isFile()) files.push(path);
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function safeReleaseFiles(directory: string, excluded: Set<string>): string[] {
  return listFiles(directory).filter((path) => {
    const relativePath = toPortablePath(relative(directory, path));
    if (relativePath.includes("\n") || relativePath.includes("\r")) {
      throw new Error(
        `Release filename contains a line break: ${relativePath}`,
      );
    }
    return !excluded.has(relativePath);
  });
}

export function writeChecksums(directory: string): string {
  const outputPath = join(directory, CHECKSUM_FILE);
  const files = safeReleaseFiles(directory, new Set([CHECKSUM_FILE]));
  const lines = files.map((path) => {
    const relativePath = toPortablePath(relative(directory, path));
    return `${sha256(path)}  ${relativePath}`;
  });

  writeFileSync(outputPath, `${lines.join("\n")}\n`, { mode: 0o644 });
  return outputPath;
}

export function verifyChecksums(directory: string): number {
  const checksumPath = join(directory, CHECKSUM_FILE);
  const lines = readFileSync(checksumPath, "utf8")
    .split("\n")
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const match = /^([a-f0-9]{64}) {2}(.+)$/u.exec(line);
    if (!match) throw new Error(`Invalid checksum line: ${line}`);
    const [, expected, relativePath] = match;
    const path = resolve(directory, relativePath);
    const relativeResolved = relative(directory, path);
    if (
      relativeResolved.startsWith(`..${sep}`) ||
      relativeResolved === ".." ||
      lstatSync(path).isSymbolicLink()
    ) {
      throw new Error(
        `Checksum path leaves the release directory: ${relativePath}`,
      );
    }
    const actual = sha256(path);
    if (actual !== expected) {
      throw new Error(`Checksum mismatch for ${relativePath}.`);
    }
  }

  return lines.length;
}

function releaseTimestamp(): string {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch === undefined) return new Date().toISOString();

  const seconds = Number(epoch);
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    throw new Error("SOURCE_DATE_EPOCH must be a non-negative integer.");
  }
  return new Date(seconds * 1000).toISOString();
}

function deterministicUuid(value: string): string {
  const bytes = Buffer.from(
    createHash("sha256").update(value).digest().subarray(0, 16),
  );
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createVex(version: string): Record<string, unknown> {
  const purl = `pkg:github/CodeVault-LLC/security@${version}`;
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    serialNumber: `urn:uuid:${deterministicUuid(purl)}`,
    version: 1,
    metadata: {
      timestamp: releaseTimestamp(),
      component: {
        type: "application",
        "bom-ref": purl,
        group: "CodeVault-LLC",
        name: "security",
        version,
        purl,
      },
    },
    vulnerabilities: [],
  };
}

export function writeVex(directory: string, version: string): string {
  const path = join(directory, `codevault-${version}.vex.cdx.json`);
  writeFileSync(path, `${JSON.stringify(createVex(version), null, 2)}\n`, {
    mode: 0o644,
  });
  return path;
}

export function writeEvidenceManifest(
  directory: string,
  version: string,
  commit: string,
): string {
  if (!/^[a-f0-9]{40}$/u.test(commit)) {
    throw new Error("The source commit must be a full 40-character Git SHA.");
  }

  const files = safeReleaseFiles(
    directory,
    new Set([CHECKSUM_FILE, EVIDENCE_FILE]),
  ).map((path): EvidenceFile => ({
    path: toPortablePath(relative(directory, path)),
    sha256: sha256(path),
    size: lstatSync(path).size,
  }));
  const manifest: ReleaseEvidenceManifest = {
    schemaVersion: 1,
    product: "CodeVault Security",
    version,
    source: {
      repository: "https://github.com/CodeVault-LLC/security",
      commit,
    },
    generatedAt: releaseTimestamp(),
    files,
  };
  const outputPath = join(directory, EVIDENCE_FILE);
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o644,
  });
  return outputPath;
}

function validateCycloneDx(path: string): void {
  const document = JSON.parse(readFileSync(path, "utf8")) as {
    bomFormat?: unknown;
    specVersion?: unknown;
    metadata?: unknown;
  };
  if (document.bomFormat !== "CycloneDX") {
    throw new Error(`${basename(path)} is not a CycloneDX document.`);
  }
  if (document.specVersion !== "1.7") {
    throw new Error(`${basename(path)} does not use CycloneDX 1.7.`);
  }
  if (typeof document.metadata !== "object" || document.metadata === null) {
    throw new Error(`${basename(path)} has no metadata object.`);
  }
}

export function verifyReleaseBundle(directory: string, version: string): void {
  const files = listFiles(directory).map((path) =>
    toPortablePath(relative(directory, path)),
  );
  const suffixes = [".dmg", ".zip", ".exe", ".rpm", ".AppImage"];
  for (const suffix of suffixes) {
    const artifacts = files.filter((path) => path.endsWith(suffix));
    if (artifacts.length === 0) {
      throw new Error(`Release bundle has no ${suffix} artifact.`);
    }
    for (const artifact of artifacts) {
      if (!files.includes(`${artifact}.cdx.json`)) {
        throw new Error(`Release bundle has no SBOM for ${artifact}.`);
      }
    }
  }
  for (const component of ["server", "worker", "media-worker"]) {
    const expected = `codevault-${component}-${version}.cdx.json`;
    if (!files.some((path) => path.endsWith(expected))) {
      throw new Error(`Release bundle has no ${expected}.`);
    }
    if (!files.includes(`container-${component}.json`)) {
      throw new Error(`Release bundle has no image identity for ${component}.`);
    }
    if (!files.includes(`trivy-${component}.sarif`)) {
      throw new Error(`Release bundle has no image scan for ${component}.`);
    }
  }
  if (!files.includes(`codevault-${version}-source.tar.gz`)) {
    throw new Error("Release bundle has no deterministic source archive.");
  }
  if (!files.includes(`codevault-${version}.vex.cdx.json`)) {
    throw new Error("Release bundle has no VEX document.");
  }
  if (!files.includes(`codevault-${version}-source.cdx.json`)) {
    throw new Error("Release bundle has no source SBOM.");
  }
  if (!files.includes(EVIDENCE_FILE)) {
    throw new Error("Release bundle has no release evidence manifest.");
  }

  for (const path of listFiles(directory).filter((candidate) =>
    candidate.endsWith(".cdx.json"),
  )) {
    validateCycloneDx(path);
  }
  const checksummedFiles = verifyChecksums(directory);
  if (checksummedFiles !== files.length - 1) {
    throw new Error("SHA256SUMS does not account for every release file.");
  }
}

function usage(): never {
  throw new Error(
    "Usage: release-evidence.ts <check-tag|vex|manifest|checksums|verify> [arguments]",
  );
}

async function main(): Promise<void> {
  const [command, ...arguments_] = process.argv.slice(2);
  const { version } = readPackageManifest();

  switch (command) {
    case "check-tag": {
      const tag = arguments_[0] ?? process.env.GITHUB_REF_NAME;
      if (tag === undefined) usage();
      const desktopManifest = JSON.parse(
        readFileSync(DESKTOP_MANIFEST_PATH, "utf8"),
      ) as PackageManifest;
      assertReleaseVersions(version, desktopManifest.version);
      assertReleaseTag(tag, version);
      console.warn(`release tag matches version ${version}`);
      break;
    }
    case "vex": {
      const directory = arguments_[0];
      if (directory === undefined) usage();
      console.warn(writeVex(resolve(directory), version));
      break;
    }
    case "manifest": {
      const [directory, commit] = arguments_;
      if (directory === undefined || commit === undefined) usage();
      console.warn(writeEvidenceManifest(resolve(directory), version, commit));
      break;
    }
    case "checksums": {
      const directory = arguments_[0];
      if (directory === undefined) usage();
      console.warn(writeChecksums(resolve(directory)));
      break;
    }
    case "verify": {
      const directory = arguments_[0];
      if (directory === undefined) usage();
      verifyReleaseBundle(resolve(directory), version);
      console.warn(`release bundle for ${version} verified`);
      break;
    }
    default:
      usage();
  }
}

if (import.meta.main) await main();
