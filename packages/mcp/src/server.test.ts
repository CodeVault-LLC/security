import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, describe, expect, it } from "vitest";

const TOKEN = "m".repeat(64);
const PACKAGE_DIRECTORY = new URL("..", import.meta.url).pathname;
const activeServers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    activeServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) =>
            error === undefined ? resolve() : reject(error),
          );
        }),
    ),
  );
});

describe("CodeVault MCP stdio server", () => {
  it("authenticates through HTTP and exposes only the reviewed tool set", async () => {
    const requests: Array<{ path: string; authorization: string | undefined }> =
      [];
    const url = await startHttpServer((request, response) => {
      requests.push({
        path: request.url ?? "",
        authorization: request.headers.authorization,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          user: {
            id: "00000000-0000-4000-8000-000000000001",
            email: "researcher@example.test",
            displayName: "Researcher",
            role: "MEMBER",
            createdAt: "2026-08-19T00:00:00.000Z",
            lastLoginAt: null,
          },
          session: {
            id: "00000000-0000-4000-8000-000000000002",
            expiresAt: "2026-08-20T00:00:00.000Z",
            createdAt: "2026-08-19T00:00:00.000Z",
          },
        }),
      );
    });
    const { client, transport } = await connect(url, TOKEN);

    try {
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name).sort();

      expect(names).toEqual([
        "codevault_create_asset",
        "codevault_create_case",
        "codevault_create_vendor",
        "codevault_get_finding",
        "codevault_list_assets",
        "codevault_list_cases",
        "codevault_list_findings",
        "codevault_list_vendors",
        "codevault_record_finding",
        "codevault_whoami",
      ]);
      expect(names).not.toContain("codevault_publish_finding");

      const identity = await client.callTool({
        name: "codevault_whoami",
        arguments: {},
      });

      expect(JSON.stringify(identity)).toContain("researcher@example.test");
      expect(requests).toEqual([
        { path: "/v1/auth/me", authorization: `Bearer ${TOKEN}` },
        { path: "/v1/auth/me", authorization: `Bearer ${TOKEN}` },
      ]);
    } finally {
      await transport.close();
    }
  }, 15_000);

  it("does not complete the MCP handshake when CodeVault rejects the token", async () => {
    const url = await startHttpServer((_request, response) => {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: {
            category: "PERMISSION_DENIED",
            message: "Your session has expired. Sign in again.",
            requestId: "request-unauthorized",
          },
        }),
      );
    });
    const client = new Client({ name: "codevault-test", version: "1.0.0" });
    const transport = transportFor(url, "x".repeat(64));

    await expect(client.connect(transport)).rejects.toThrow();
    await transport.close().catch(() => undefined);
  }, 15_000);
});

async function connect(
  url: string,
  token: string,
): Promise<{ client: Client; transport: StdioClientTransport }> {
  const client = new Client({ name: "codevault-test", version: "1.0.0" });
  const transport = transportFor(url, token);
  await client.connect(transport);
  return { client, transport };
}

function transportFor(url: string, token: string): StdioClientTransport {
  return new StdioClientTransport({
    command: "bun",
    args: ["run", "src/index.ts"],
    cwd: PACKAGE_DIRECTORY,
    env: {
      PATH: process.env["PATH"] ?? "",
      CODEVAULT_URL: url,
      CODEVAULT_TOKEN: token,
    },
    stderr: "pipe",
  });
}

async function startHttpServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  activeServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }
  return `http://127.0.0.1:${address.port}`;
}
