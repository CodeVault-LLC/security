import { createServer, type Server, type ServerResponse } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const TOKEN = "i".repeat(64);
const PACKAGE_DIRECTORY = fileURLToPath(new URL("..", import.meta.url));
const INVENTORY_PATH = fileURLToPath(
  new URL("../../../docs/operations/mcp-tool-inventory.md", import.meta.url),
);

interface DiscoveredTool {
  name: string;
  title?: string | undefined;
  description?: string | undefined;
  annotations?:
    | {
        readOnlyHint?: boolean | undefined;
        destructiveHint?: boolean | undefined;
      }
    | undefined;
}

interface MockServer {
  server: Server;
  url: string;
}

const categories = [
  "Authentication",
  "Cases and disclosure",
  "Assets",
  "Findings",
  "Evidence and artifacts",
  "Vendors",
  "Reports",
] as const;

type Category = (typeof categories)[number];

function categoryFor(name: string): Category {
  if (name === "codevault_whoami") return "Authentication";
  if (name.includes("case") || name.includes("disclosure_event")) {
    return "Cases and disclosure";
  }
  if (name.includes("asset")) return "Assets";
  if (name.includes("finding")) return "Findings";
  if (name.includes("evidence") || name.includes("artifact")) {
    return "Evidence and artifacts";
  }
  if (name.includes("vendor")) return "Vendors";
  if (name.includes("report")) return "Reports";
  throw new Error(
    `MCP tool ${JSON.stringify(name)} has no inventory category.`,
  );
}

function effectFor(tool: DiscoveredTool): string {
  if (tool.annotations?.readOnlyHint === true) return "Read only";
  if (tool.annotations?.destructiveHint === true) return "State changing";
  return "Additive write";
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ").trim();
}

export function renderInventory(tools: DiscoveredTool[]): string {
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) {
      throw new Error(`MCP discovery returned duplicate tool ${tool.name}.`);
    }
    names.add(tool.name);
  }

  const lines = [
    "# MCP tool inventory",
    "",
    "This file is generated from live MCP discovery. Do not edit it by hand.",
    "Regenerate it with `bun run mcp:inventory` and check drift with",
    "`bun run mcp:inventory:check`.",
    "",
    `CodeVault exposes ${tools.length} authenticated MCP tools. Read-only and write`,
    "annotations are client hints. The API still applies the authenticated user's",
    "permissions, case access, validation, revision checks, and audit behavior.",
    "State-changing tools act immediately when a client calls them.",
  ];

  for (const category of categories) {
    const entries = tools
      .filter((tool) => categoryFor(tool.name) === category)
      .sort((left, right) => left.name.localeCompare(right.name));
    if (entries.length === 0) continue;
    lines.push(
      "",
      `## ${category}`,
      "",
      "| Tool | Effect | Purpose |",
      "| --- | --- | --- |",
    );
    for (const tool of entries) {
      lines.push(
        `| \`${tool.name}\` | ${effectFor(tool)} | ${markdownCell(tool.description ?? tool.title ?? "No description registered.")} |`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

async function startMockCodeVault(): Promise<MockServer> {
  const server = createServer((_request, response: ServerResponse) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        user: {
          id: "00000000-0000-4000-8000-000000000001",
          email: "inventory@example.test",
          displayName: "Inventory generator",
          role: "ADMIN",
          createdAt: "2026-08-20T00:00:00.000Z",
          lastLoginAt: null,
        },
        session: {
          id: "00000000-0000-4000-8000-000000000002",
          expiresAt: "2026-08-21T00:00:00.000Z",
          createdAt: "2026-08-20T00:00:00.000Z",
        },
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Inventory mock server did not bind to a TCP port.");
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

async function discoverTools(): Promise<DiscoveredTool[]> {
  const mock = await startMockCodeVault();
  const client = new Client({ name: "codevault-inventory", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", "src/index.ts"],
    cwd: PACKAGE_DIRECTORY,
    env: {
      PATH: process.env["PATH"] ?? "",
      CODEVAULT_URL: mock.url,
      CODEVAULT_TOKEN: TOKEN,
    },
    stderr: "pipe",
  });

  try {
    await client.connect(transport);
    const discovered = await client.listTools();
    return discovered.tools;
  } finally {
    await transport.close().catch(() => undefined);
    await closeServer(mock.server);
  }
}

async function main(): Promise<void> {
  const check = process.argv.slice(2).includes("--check");
  const output = renderInventory(await discoverTools());

  if (check) {
    const current = await readFile(INVENTORY_PATH, "utf8").catch(() => "");
    if (current !== output) {
      throw new Error(
        "MCP tool inventory is stale. Run `bun run mcp:inventory` and commit the result.",
      );
    }
    console.warn("MCP tool inventory matches live discovery.");
    return;
  }

  await writeFile(INVENTORY_PATH, output, "utf8");
  console.warn(`Wrote ${INVENTORY_PATH}.`);
}

if (import.meta.main) await main();
