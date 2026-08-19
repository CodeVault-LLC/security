#!/usr/bin/env bun

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { CodeVaultClient } from "./client.js";
import { loadConfig } from "./config.js";
import { createCodeVaultMcpServer } from "./server.js";

const config = await loadConfig();
const client = new CodeVaultClient(config);

await client.whoAmI();

console.error(`CodeVault Security MCP connected to ${config.baseUrl}.`);
void serveStdio(() => createCodeVaultMcpServer(client));
