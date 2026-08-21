#!/usr/bin/env bun

import { capture, parseCaptureArguments } from "./capture.js";

const HELP = `Usage:
  codevault capture --case UUID [--file PATH] [options]

Without --file, capture reads standard input. Set CODEVAULT_URL and
CODEVAULT_TOKEN in the environment.

Options:
  --finding UUID       Attach the evidence to a finding
  --name NAME          Preserve this original name
  --title TITLE        Evidence title
  --description TEXT   Evidence description in Markdown
  --mime TYPE          Media type, default application/octet-stream
  --type KIND          Artifact kind, default OTHER
  --visibility LEVEL   INTERNAL, VENDOR, or PUBLIC
  --source-time TIME   ISO 8601 source timestamp
`;

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined || command === "--help" || command === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (command !== "capture") throw new Error(`Unknown command: ${command}`);
  const baseUrl = process.env["CODEVAULT_URL"];
  const token = process.env["CODEVAULT_TOKEN"];
  if (baseUrl === undefined || token === undefined) {
    throw new Error("Set CODEVAULT_URL and CODEVAULT_TOKEN before capture.");
  }
  const result = await capture(parseCaptureArguments(args), { baseUrl, token });
  process.stdout.write(
    `${JSON.stringify({
      evidenceId: result.evidence.id,
      evidenceRef: result.evidence.ref,
      artifactId: result.artifact.id,
      sha256: result.artifact.sha256,
    })}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Capture failed."}\n`,
  );
  process.exitCode = 1;
});
