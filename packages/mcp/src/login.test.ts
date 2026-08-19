import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { login } from "./login.js";

describe("terminal MCP login", () => {
  it("completes MFA login and writes only the returned token with mode 0600", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codevault-mcp-login-"));
    const tokenFile = join(directory, "credentials", "token");
    const token = "s".repeat(64);
    await mkdir(join(directory, "credentials"));
    await writeFile(tokenFile, "old-token\n", { mode: 0o644 });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          challengeToken: "c".repeat(64),
          challenge: "MFA_REQUIRED",
          expiresAt: "2026-08-19T10:00:00.000Z",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          token,
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

    await login({
      baseUrl: "http://127.0.0.1:4310",
      tokenFile,
      email: "researcher@example.test",
      password: "a password that is not stored",
      totp: "123456",
      fetch,
    });

    expect(await readFile(tokenFile, "utf8")).toBe(`${token}\n`);
    if (process.platform !== "win32") {
      expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);
    }
    expect(JSON.stringify(fetch.mock.calls)).not.toContain(token);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
