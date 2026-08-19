import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

import { runMigrations } from "@codevault/db";

/**
 * Starts the whole development stack.
 *
 * `bun run --filter` runs workspace scripts in dependency order and waits for a
 * dependency's script to finish before starting the ones that depend on it.
 * That is right for `build` and wrong for `dev`: the worker depends on the
 * server package for its config, storage and report rendering, so it would wait
 * forever behind a server that is meant to keep running. These three processes
 * are peers, so they are started as peers.
 *
 * Output is prefixed per process, Ctrl-C stops all of them, and if one exits
 * the rest are stopped too — a half-running stack is worse than a stopped one,
 * because the failure is easy to miss.
 */

interface DevProcess {
  name: string;
  directory: string;
}

const PROCESSES: DevProcess[] = [
  { name: "server", directory: "apps/server" },
  { name: "worker", directory: "apps/worker" },
  { name: "media", directory: "apps/media-worker" },
  { name: "desktop", directory: "apps/desktop" },
];

/** `--only server,worker` runs part of the stack, e.g. while working on the API. */
function selected(): DevProcess[] {
  const flag = process.argv.indexOf("--only");

  if (flag === -1) {
    return PROCESSES;
  }

  const names = (process.argv[flag + 1] ?? "")
    .split(",")
    .map((it) => it.trim());
  const chosen = PROCESSES.filter((candidate) =>
    names.includes(candidate.name),
  );

  if (chosen.length === 0) {
    console.error(
      `--only matched nothing. Available: ${PROCESSES.map((it) => it.name).join(", ")}.`,
    );
    process.exit(1);
  }

  return chosen;
}

const running = selected();
const width = Math.max(...running.map((process) => process.name.length));
const children = new Map<string, ChildProcess>();
let shuttingDown = false;

function prefix(name: string, stream: NodeJS.ReadableStream): void {
  const lines = createInterface({ input: stream });

  lines.on("line", (line) => {
    console.log(`${name.padEnd(width)} │ ${line}`);
  });
}

function stopAll(signal: NodeJS.Signals = "SIGTERM"): void {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children.values()) {
    child.kill(signal);
  }
}

function start({ name, directory }: DevProcess): void {
  const child = spawn("bun", ["run", "dev"], {
    cwd: directory,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  children.set(name, child);

  prefix(name, child.stdout);
  prefix(name, child.stderr);

  child.on("exit", (code, signal) => {
    children.delete(name);

    if (shuttingDown) {
      return;
    }

    console.log(
      `${name.padEnd(width)} │ exited (${signal ?? `code ${code ?? 0}`}); stopping the rest.`,
    );

    process.exitCode = code ?? 1;
    stopAll();
  });
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }

  console.log("database │ applying migrations");
  const migrations = await runMigrations(connectionString);
  console.log(
    `database │ ready (${migrations.applied.length} applied, ${migrations.skipped.length} already present)`,
  );

  for (const definition of running) {
    start(definition);
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopAll(signal);
  });
}

main().catch((error: unknown) => {
  console.error(
    `database │ migration failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
