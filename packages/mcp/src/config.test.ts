import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig, writeConfig } from "./config.js";

describe("MCP configuration", () => {
  it("stores the server URL and persistent grant in one private file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codevault-mcp-config-"));
    const path = join(directory, "nested", "mcp.json");
    const expected = {
      baseUrl: "https://security.example.test",
      token: `cv_mcp_${"a".repeat(48)}`,
    };

    await writeConfig(path, expected);

    expect(await loadConfig({ CODEVAULT_MCP_CONFIG: path })).toEqual(expected);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      version: 1,
      ...expected,
    });
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
  });

  it("keeps legacy token files usable during migration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codevault-mcp-legacy-"));
    const tokenFile = join(directory, "mcp-token");
    await writeFile(tokenFile, `${"s".repeat(48)}\n`, { mode: 0o600 });

    await expect(
      loadConfig({
        CODEVAULT_TOKEN_FILE: tokenFile,
        CODEVAULT_MCP_CONFIG: join(directory, "missing.json"),
        CODEVAULT_URL: "https://security.example.test",
      }),
    ).resolves.toEqual({
      baseUrl: "https://security.example.test",
      token: "s".repeat(48),
    });
  });
});
