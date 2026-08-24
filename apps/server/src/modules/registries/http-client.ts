import { RegistryProviderError, type RegistryHttpClient } from "./provider.js";

const ALLOWED_ORIGINS = new Set([
  "https://api.wordpress.org",
  "https://registry.npmjs.org",
  "https://crates.io",
  "https://packagist.org",
  "https://rubygems.org",
  "https://azuresearch-usnc.nuget.org",
  "https://search.maven.org",
]);

const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;

async function readBoundedBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);

  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new RegistryProviderError("The registry response was too large.");
  }

  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;

    size += chunk.value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new RegistryProviderError("The registry response was too large.");
    }

    body += decoder.decode(chunk.value, { stream: true });
  }

  return body + decoder.decode();
}

/** Fetches JSON only from the fixed public registry hosts used by adapters. */
export class SafeRegistryHttpClient implements RegistryHttpClient {
  async getJson(url: URL): Promise<unknown> {
    if (url.protocol !== "https:" || !ALLOWED_ORIGINS.has(url.origin)) {
      throw new RegistryProviderError("The registry host is not allowed.");
    }

    let response: Response;

    try {
      response = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "CodeVault-Security/registry-search",
        },
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      const timedOut =
        error instanceof DOMException && error.name === "TimeoutError";
      throw new RegistryProviderError(
        timedOut
          ? "The registry did not respond within 5 seconds."
          : "The registry could not be reached.",
      );
    }

    if (!response.ok) {
      throw new RegistryProviderError(
        `The registry returned HTTP ${response.status}.`,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLocaleLowerCase("en-US").includes("json")) {
      throw new RegistryProviderError(
        "The registry returned a non-JSON response.",
      );
    }

    try {
      return JSON.parse(await readBoundedBody(response)) as unknown;
    } catch (error: unknown) {
      if (error instanceof RegistryProviderError) throw error;
      throw new RegistryProviderError("The registry returned malformed JSON.");
    }
  }
}
