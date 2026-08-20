import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REGISTER_PATH = resolve(REPOSITORY_ROOT, "docs/feature-register.md");
const STATES = new Set(["implemented", "partial", "planned", "deferred"]);

export function verifyFeatureRegister(
  markdown: string,
  baseDirectory: string,
): number {
  let featureCount = 0;
  let implementedCount = 0;
  const seenStates = new Set<string>();

  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    const state = (cells[2] ?? "").replaceAll("`", "");
    if (!STATES.has(state)) continue;
    featureCount += 1;
    seenStates.add(state);

    if (state !== "implemented") continue;
    implementedCount += 1;
    const acceptance = cells[4] ?? "";
    const links = [...acceptance.matchAll(/\]\(([^)]+)\)/gu)].map(
      (match) => match[1],
    );
    if (links.length === 0) {
      throw new Error(
        `Implemented feature ${JSON.stringify(cells[1])} has no acceptance-test link.`,
      );
    }
    for (const link of links) {
      if (!/\.(?:integration\.)?test\.tsx?$|\.spec\.ts$/u.test(link)) {
        throw new Error(
          `Acceptance link ${JSON.stringify(link)} is not a test file.`,
        );
      }
      if (!existsSync(resolve(baseDirectory, link))) {
        throw new Error(
          `Acceptance test ${JSON.stringify(link)} does not exist.`,
        );
      }
    }
  }

  if (featureCount === 0 || implementedCount === 0) {
    throw new Error("Feature register contains no implemented features.");
  }
  for (const state of STATES) {
    if (!seenStates.has(state)) {
      throw new Error(`Feature register does not contain a ${state} feature.`);
    }
  }
  return featureCount;
}

if (import.meta.main) {
  const count = verifyFeatureRegister(
    readFileSync(REGISTER_PATH, "utf8"),
    dirname(REGISTER_PATH),
  );
  console.warn(`Feature register verified (${count} features).`);
}
