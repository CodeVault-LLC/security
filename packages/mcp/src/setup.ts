#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CodeVaultClient } from "./client.js";
import { defaultConfigFile, loadConfig, writeConfig } from "./config.js";
import { interactiveLogin } from "./login.js";

type ClientName = "codex" | "claude";

interface CommandResult {
  exitCode: number;
  stderr: string;
}

type RunCommand = (
  executable: string,
  arguments_: string[],
) => Promise<CommandResult>;

const MCP_ENTRY = fileURLToPath(new URL("./index.ts", import.meta.url));

export function registrationArguments(
  client: ClientName,
  configFile: string,
  runtime = process.execPath,
  entry = MCP_ENTRY,
): { remove: string[]; add: string[] } {
  const configEnvironment = `CODEVAULT_MCP_CONFIG=${configFile}`;
  if (client === "codex") {
    return {
      remove: ["mcp", "remove", "codevault"],
      add: [
        "mcp",
        "add",
        "codevault",
        "--env",
        configEnvironment,
        "--",
        runtime,
        entry,
      ],
    };
  }
  return {
    remove: ["mcp", "remove", "codevault", "--scope", "user"],
    add: [
      "mcp",
      "add",
      "codevault",
      "--scope",
      "user",
      "--env",
      configEnvironment,
      "--",
      runtime,
      entry,
    ],
  };
}

export async function registerClient(
  client: ClientName,
  configFile: string,
  run: RunCommand = runCommand,
): Promise<void> {
  const command = client === "codex" ? "codex" : "claude";
  const arguments_ = registrationArguments(client, configFile);
  await run(command, arguments_.remove);
  const added = await run(command, arguments_.add);
  if (added.exitCode !== 0) {
    throw new Error(
      `${command} could not save the CodeVault MCP connection: ${added.stderr.trim() || `exit ${added.exitCode}`}`,
    );
  }
}

async function main(): Promise<void> {
  const options = parseSetupArguments(process.argv.slice(2));
  const clients = await availableClients(options.client);
  if (clients.length === 0) {
    throw new Error(
      "Install Codex CLI or Claude Code before running MCP setup.",
    );
  }

  let config = await loadConfig({
    ...process.env,
    CODEVAULT_MCP_CONFIG: options.configFile,
    ...(options.server === null ? {} : { CODEVAULT_URL: options.server }),
  }).catch(() => null);
  if (config !== null) {
    const valid = await new CodeVaultClient(config)
      .whoAmI()
      .then(() => true)
      .catch(() => false);
    if (!valid) config = null;
  }

  if (config === null) {
    const loginArguments = [
      ...(options.server === null ? [] : ["--server", options.server]),
      "--config",
      options.configFile,
    ];
    await interactiveLogin(loginArguments);
    config = await loadConfig({
      ...process.env,
      CODEVAULT_MCP_CONFIG: options.configFile,
      ...(options.server === null ? {} : { CODEVAULT_URL: options.server }),
    });
  }

  // Also migrates a valid legacy mcp-token file into the self-contained format
  // that the saved client registrations use.
  await writeConfig(options.configFile, config);

  for (const client of clients) {
    await registerClient(client, options.configFile);
    process.stdout.write(
      `CodeVault MCP is ready in ${client === "codex" ? "Codex CLI" : "Claude Code"}.\n`,
    );
  }
}

function parseSetupArguments(arguments_: string[]): {
  client: ClientName | "all";
  server: string | null;
  configFile: string;
} {
  let client: ClientName | "all" = "all";
  let server: string | null = null;
  let configFile = defaultConfigFile();

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (argument === "--client" && (value === "codex" || value === "claude")) {
      client = value;
      index += 1;
    } else if (argument === "--server" && value !== undefined) {
      server = value;
      index += 1;
    } else if (argument === "--config" && value !== undefined) {
      configFile = resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument ?? ""}`);
    }
  }
  return { client, server, configFile };
}

async function availableClients(
  requested: ClientName | "all",
): Promise<ClientName[]> {
  const candidates: ClientName[] =
    requested === "all" ? ["codex", "claude"] : [requested];
  const available = await Promise.all(
    candidates.map(async (client) => {
      const result = await runCommand(client, ["--version"]);
      return result.exitCode === 0 ? client : null;
    }),
  );
  return available.filter((client): client is ClientName => client !== null);
}

function runCommand(
  executable: string,
  arguments_: string[],
): Promise<CommandResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(executable, arguments_, {
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolvePromise({ exitCode: 127, stderr: error.message });
    });
    child.on("close", (code) => {
      resolvePromise({ exitCode: code ?? 1, stderr });
    });
  });
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Setup failed.";
    process.stderr.write(`CodeVault MCP setup failed: ${message}\n`);
    process.exitCode = 1;
  });
}
