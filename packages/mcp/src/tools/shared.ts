import { CodeVaultApiError } from "../client.js";
import * as z from "zod/v4";

export const id = z.uuid();
export const markdown = z.string().max(200_000);
export const nullableMarkdown = z.union([markdown, z.null()]);
export const nullableHttpsUrl = z.union([
  z.url({ protocol: /^https$/u }),
  z.null(),
]);
export const nullableTimestamp = z.union([z.iso.datetime(), z.null()]);
export const list = z.object({
  query: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.string().max(200).optional(),
});

export async function result<T>(operation: () => Promise<T>) {
  try {
    const value = await operation();
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(value, null, 2) },
      ],
    };
  } catch (error: unknown) {
    const message = safeError(error);
    return {
      isError: true,
      content: [{ type: "text" as const, text: message }],
    };
  }
}

export function compact<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function safeError(error: unknown): string {
  if (error instanceof CodeVaultApiError) {
    const request =
      error.requestId === null ? "" : ` Request: ${error.requestId}.`;
    return `CodeVault rejected the request (${error.status}): ${error.message}${request}`;
  }

  return error instanceof Error
    ? `CodeVault MCP request failed: ${error.message}`
    : "CodeVault MCP request failed.";
}
