import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { login } from "./login.js";

describe("terminal MCP login", () => {
  it("completes MFA login and writes only the returned token with mode 0600", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codevault-mcp-login-"));
    const configFile = join(directory, "credentials", "mcp.json");
    const sessionToken = "s".repeat(64);
    const mcpToken = `cv_mcp_${"m".repeat(48)}`;
    await mkdir(join(directory, "credentials"));
    await writeFile(configFile, "old-token\n", { mode: 0o644 });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          challengeToken: "c".repeat(64),
          challenge: "MFA_REQUIRED",
          methods: ["TOTP"],
          expiresAt: "2026-08-19T10:00:00.000Z",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          token: sessionToken,
          expiresAt: "2026-08-20T10:00:00.000Z",
          user: {
            id: "00000000-0000-4000-8000-000000000001",
            email: "researcher@example.test",
            displayName: "Researcher",
            role: "MEMBER",
            createdAt: "2026-08-19T00:00:00.000Z",
            lastLoginAt: null,
          },
        }),
      );
    fetch.mockResolvedValueOnce(
      jsonResponse({
        access: {
          id: "00000000-0000-4000-8000-000000000003",
          name: "MCP on test-host",
          createdAt: "2026-08-19T10:00:00.000Z",
          lastUsedAt: null,
        },
        token: mcpToken,
      }),
    );
    fetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await login({
      baseUrl: "http://127.0.0.1:4310",
      configFile,
      email: "researcher@example.test",
      password: "a password that is not stored",
      totp: "123456",
      name: "MCP on test-host",
      fetch,
    });

    expect(JSON.parse(await readFile(configFile, "utf8"))).toEqual({
      version: 1,
      baseUrl: "http://127.0.0.1:4310",
      token: mcpToken,
    });
    if (process.platform !== "win32") {
      expect((await stat(configFile)).mode & 0o777).toBe(0o600);
    }
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:4310/v1/settings/mcp-access",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: `Bearer ${sessionToken}`,
        }),
      }),
    );
    expect(JSON.stringify(fetch.mock.calls)).not.toContain(mcpToken);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
