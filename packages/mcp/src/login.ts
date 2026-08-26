#!/usr/bin/env bun

import { hostname } from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import type {
  CreateMcpAccessTokenResponse,
  LoginResponse,
  LoginStartResponse,
} from "@codevault/contracts";

import {
  defaultConfigFile,
  normalizeServerUrl,
  writeConfig,
} from "./config.js";

interface LoginOptions {
  baseUrl: string;
  configFile: string;
  email: string;
  password: string;
  totp: string;
  name?: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * Signs in under the organization's authentication policy, exchanges the
 * short browser-style session for a revocable MCP grant, and stores the server
 * URL and grant together.
 */
export async function login(
  options: LoginOptions,
): Promise<CreateMcpAccessTokenResponse> {
  const baseUrl = normalizeServerUrl(options.baseUrl);
  const fetch = options.fetch ?? globalThis.fetch;
  const started = await post<LoginStartResponse>(
    fetch,
    `${baseUrl}/v1/auth/login/start`,
    { email: options.email, password: options.password },
  );

  const session =
    "token" in started
      ? started
      : started.challenge === "MFA_REQUIRED"
        ? await post<LoginResponse>(
            fetch,
            `${baseUrl}/v1/auth/login/complete`,
            { challengeToken: started.challengeToken, totp: options.totp },
          )
        : (() => {
            throw new Error(
              "This account must finish MFA enrollment in the desktop app before MCP setup.",
            );
          })();
  const access = await post<CreateMcpAccessTokenResponse>(
    fetch,
    `${baseUrl}/v1/settings/mcp-access`,
    { name: options.name ?? `MCP on ${hostname()}` },
    session.token,
  );

  await writeConfig(options.configFile, { baseUrl, token: access.token });
  await post(fetch, `${baseUrl}/v1/auth/logout`, {}, session.token).catch(
    () => undefined,
  );

  return access;
}

export async function interactiveLogin(
  arguments_: string[] = process.argv.slice(2),
): Promise<{ baseUrl: string; configFile: string }> {
  const parsed = parseArguments(arguments_);
  const email = await promptText("Email: ");
  const password = await promptSecret("Password: ");
  const totp = await promptSecret("TOTP code: ");
  await login({
    baseUrl: parsed.baseUrl,
    configFile: parsed.configFile,
    email,
    password,
    totp,
  });
  return parsed;
}

async function main(): Promise<void> {
  const configured = await interactiveLogin();
  stdout.write(
    `Saved persistent MCP access for ${configured.baseUrl} to ${configured.configFile}.\n`,
  );
}

function parseArguments(arguments_: string[]): {
  baseUrl: string;
  configFile: string;
} {
  let baseUrl = "http://127.0.0.1:4310";
  let configFile = defaultConfigFile();

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];

    if (argument === "--server" && value !== undefined) {
      baseUrl = value;
      index += 1;
    } else if (
      (argument === "--config" || argument === "--token-file") &&
      value !== undefined
    ) {
      configFile = resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument ?? ""}`);
    }
  }

  return { baseUrl: normalizeServerUrl(baseUrl), configFile };
}

async function promptText(label: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error("MCP setup requires an interactive terminal.");
  }

  const input = createInterface({ input: stdin, output: stdout });
  try {
    return (await input.question(label)).trim();
  } finally {
    input.close();
  }
}

async function promptSecret(label: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY || stdin.setRawMode === undefined) {
    throw new Error("MCP setup requires an interactive terminal.");
  }

  stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  try {
    return await new Promise<string>((resolvePromise, rejectPromise) => {
      let value = "";

      const onData = (chunk: string | Buffer): void => {
        const text = String(chunk);

        for (const character of text) {
          if (character === "\u0003") {
            stdin.off("data", onData);
            rejectPromise(new Error("Setup cancelled."));
            return;
          }
          if (character === "\r" || character === "\n") {
            stdin.off("data", onData);
            stdout.write("\n");
            resolvePromise(value);
            return;
          }
          if (character === "\u007f" || character === "\b") {
            value = value.slice(0, -1);
            continue;
          }
          value += character;
        }
      };

      stdin.on("data", onData);
    });
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
  }
}

async function post<T = unknown>(
  fetch: typeof globalThis.fetch,
  url: string,
  body: unknown,
  token?: string,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    const message = apiErrorMessage(payload);
    throw new Error(
      message ?? `CodeVault setup failed with HTTP ${response.status}.`,
    );
  }

  return payload as T;
}

function apiErrorMessage(payload: unknown): string | null {
  if (payload === null || typeof payload !== "object") return null;
  const error = (payload as Record<string, unknown>)["error"];
  if (error === null || typeof error !== "object") return null;
  const message = (error as Record<string, unknown>)["message"];
  return typeof message === "string" ? message : null;
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Setup failed.";
    process.stderr.write(`CodeVault MCP setup failed: ${message}\n`);
    process.exitCode = 1;
  });
}
