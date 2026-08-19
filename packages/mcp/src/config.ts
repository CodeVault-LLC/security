import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface McpConfig {
  baseUrl: string;
  token: string;
}

export function defaultTokenFile(): string {
  return join(homedir(), ".codevault-security", "mcp-token");
}

export async function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<McpConfig> {
  const baseUrl = environment["CODEVAULT_URL"] ?? "http://127.0.0.1:4310";
  const inlineToken = environment["CODEVAULT_TOKEN"]?.trim();
  const tokenFile =
    environment["CODEVAULT_TOKEN_FILE"]?.trim() ?? defaultTokenFile();

  if (inlineToken !== undefined && inlineToken !== "") {
    return { baseUrl, token: inlineToken };
  }

  if (tokenFile !== "") {
    const metadata = await stat(tokenFile).catch((error: unknown) => {
      if (isMissingFile(error)) return null;
      throw error;
    });

    if (metadata === null) {
      throw new Error(
        "Run `bun run mcp:login` or set CODEVAULT_TOKEN before starting the MCP server.",
      );
    }

    if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
      throw new Error(
        "CODEVAULT_TOKEN_FILE must not be readable or writable by group or other users.",
      );
    }

    const token = (await readFile(tokenFile, "utf8")).trim();
    return { baseUrl, token };
  }

  throw new Error(
    "Run `bun run mcp:login` or set CODEVAULT_TOKEN before starting the MCP server.",
  );
}

function isMissingFile(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
