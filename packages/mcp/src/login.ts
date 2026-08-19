#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import type { LoginResponse, LoginStartResponse } from "@codevault/contracts";

import { defaultTokenFile } from "./config.js";

interface LoginOptions {
  baseUrl: string;
  tokenFile: string;
  email: string;
  password: string;
  totp: string;
  fetch?: typeof globalThis.fetch;
}

export async function login(options: LoginOptions): Promise<LoginResponse> {
  const baseUrl = normalizeUrl(options.baseUrl);
  const fetch = options.fetch ?? globalThis.fetch;
  const started = await post<LoginStartResponse>(
    fetch,
    `${baseUrl}/v1/auth/login/start`,
    { email: options.email, password: options.password },
  );

  if (started.challenge !== "MFA_REQUIRED") {
    throw new Error(
      "This account must finish MFA enrollment in the desktop app before terminal login.",
    );
  }

  const completed = await post<LoginResponse>(
    fetch,
    `${baseUrl}/v1/auth/login/complete`,
    { challengeToken: started.challengeToken, totp: options.totp },
  );

  await writeTokenFile(options.tokenFile, completed.token);

  return completed;
}

async function writeTokenFile(path: string, token: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporaryPath, `${token}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, path);
  } catch (error: unknown) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const email = await promptText("Email: ");
  const password = await promptSecret("Password: ");
  const totp = await promptSecret("TOTP code: ");
  const completed = await login({
    baseUrl: arguments_.baseUrl,
    tokenFile: arguments_.tokenFile,
    email,
    password,
    totp,
  });

  stdout.write(
    `Saved the CodeVault session to ${arguments_.tokenFile}. It expires at ${completed.expiresAt}.\n`,
  );
}

function parseArguments(arguments_: string[]): {
  baseUrl: string;
  tokenFile: string;
} {
  let baseUrl = "http://127.0.0.1:4310";
  let tokenFile = defaultTokenFile();

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];

    if (argument === "--server" && value !== undefined) {
      baseUrl = value;
      index += 1;
    } else if (argument === "--token-file" && value !== undefined) {
      tokenFile = resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument ?? ""}`);
    }
  }

  return { baseUrl, tokenFile };
}

async function promptText(label: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error("Terminal login requires an interactive terminal.");
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
    throw new Error("Terminal login requires an interactive terminal.");
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
            rejectPromise(new Error("Login cancelled."));
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

function normalizeUrl(value: string): string {
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

async function post<T>(
  fetch: typeof globalThis.fetch,
  url: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    const message = apiErrorMessage(payload);
    throw new Error(
      message ?? `CodeVault login failed with HTTP ${response.status}.`,
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
    const message = error instanceof Error ? error.message : "Login failed.";
    process.stderr.write(`CodeVault MCP login failed: ${message}\n`);
    process.exitCode = 1;
  });
}
