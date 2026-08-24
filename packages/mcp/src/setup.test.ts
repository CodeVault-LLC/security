import { describe, expect, it, vi } from "vitest";

import { registerClient, registrationArguments } from "./setup.js";

describe("one-time MCP client setup", () => {
  it("builds a Codex registration without a URL or bearer token", () => {
    expect(
      registrationArguments(
        "codex",
        "/private/mcp.json",
        "/usr/bin/bun",
        "/opt/codevault/mcp.js",
      ).add,
    ).toEqual([
      "mcp",
      "add",
      "codevault",
      "--env",
      "CODEVAULT_MCP_CONFIG=/private/mcp.json",
      "--",
      "/usr/bin/bun",
      "/opt/codevault/mcp.js",
    ]);
  });

  it("replaces an existing user registration and checks the add result", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 1, stderr: "not configured" })
      .mockResolvedValueOnce({ exitCode: 0, stderr: "" });

    await registerClient("claude", "/private/mcp.json", run);

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]).toEqual([
      "claude",
      ["mcp", "remove", "codevault", "--scope", "user"],
    ]);
    expect(run.mock.calls[1]?.[1]).not.toContain("https://security.example");
  });
});
