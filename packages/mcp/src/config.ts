import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface McpConfig {
  baseUrl: string;
  token: string;
}

interface StoredMcpConfig extends McpConfig {
  version: 1;
}

export function defaultConfigFile(): string {
  return join(homedir(), ".codevault-security", "mcp.json");
}

/** Kept for existing installations while mcp-token migrates to mcp.json. */
export function defaultTokenFile(): string {
  return join(homedir(), ".codevault-security", "mcp-token");
}

export function normalizeServerUrl(value: string): string {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(
    url.hostname.toLowerCase(),
  );

  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("The CodeVault server must use https unless it is local.");
  }
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "The CodeVault server URL cannot contain credentials, a query, or a fragment.",
    );
  }

  return url.toString().replace(/\/$/u, "");
}

export async function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<McpConfig> {
  const configuredUrl = environment["CODEVAULT_URL"]?.trim();
  const inlineToken = environment["CODEVAULT_TOKEN"]?.trim();
  if (inlineToken !== undefined && inlineToken !== "") {
    return {
      baseUrl: normalizeServerUrl(
        configuredUrl === undefined || configuredUrl === ""
          ? "http://127.0.0.1:4310"
          : configuredUrl,
      ),
      token: inlineToken,
    };
  }

  const configFile =
    environment["CODEVAULT_MCP_CONFIG"]?.trim() || defaultConfigFile();
  const stored = await readSecureFile(configFile);
  if (stored !== null) {
    const parsed = parseStoredConfig(stored, configFile);
    return {
      baseUrl: normalizeServerUrl(configuredUrl || parsed.baseUrl),
      token: parsed.token,
    };
  }

  const tokenFile =
    environment["CODEVAULT_TOKEN_FILE"]?.trim() || defaultTokenFile();
  const legacyToken = await readSecureFile(tokenFile);
  if (legacyToken !== null) {
    return {
      baseUrl: normalizeServerUrl(
        configuredUrl === undefined || configuredUrl === ""
          ? "http://127.0.0.1:4310"
          : configuredUrl,
      ),
      token: legacyToken.trim(),
    };
  }

  throw new Error(
    "Run `bun run mcp:setup` once before starting the MCP server.",
  );
}

export async function writeConfig(
  path: string,
  config: McpConfig,
): Promise<void> {
  const stored: StoredMcpConfig = {
    version: 1,
    baseUrl: normalizeServerUrl(config.baseUrl),
    token: config.token,
  };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporaryPath, `${JSON.stringify(stored, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, path);
    if (process.platform !== "win32") {
      const metadata = await stat(path);
      if ((metadata.mode & 0o077) !== 0) {
        throw new Error(
          "Failed to restrict the MCP configuration to this user.",
        );
      }
    }
  } catch (error: unknown) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function readSecureFile(path: string): Promise<string | null> {
  const metadata = await stat(path).catch((error: unknown) => {
    if (isMissingFile(error)) return null;
    throw error;
  });
  if (metadata === null) return null;
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new Error(`${path} must not be readable or writable by other users.`);
  }
  return readFile(path, "utf8");
}

function parseStoredConfig(value: string, path: string): StoredMcpConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${path} is not valid JSON.`);
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    (parsed as Record<string, unknown>)["version"] !== 1 ||
    typeof (parsed as Record<string, unknown>)["baseUrl"] !== "string" ||
    typeof (parsed as Record<string, unknown>)["token"] !== "string"
  ) {
    throw new Error(`${path} is not a CodeVault MCP configuration.`);
  }
  return parsed as StoredMcpConfig;
}

function isMissingFile(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
