import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { Readable } from "node:stream";

import { protocol } from "electron";

import { APP_PROTOCOL } from "./security.js";

/**
 * The application protocol.
 *
 * The renderer is served from `codevault://app/` rather than `file://`. A
 * `file://` origin is effectively opaque — it weakens same-origin checks, and a
 * path-traversal bug in any handler would expose the whole filesystem. A custom
 * standard scheme gives the renderer a real origin the CSP can name.
 */

export function registerProtocolSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
        stream: true,
        // No service worker: the renderer is a local bundle, and a worker
        // would only add a persistent cache that is hard to reason about.
        allowServiceWorkers: false,
      },
    },
  ]);
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

/**
 * Resolves a request path to a file inside the bundle.
 *
 * Returns null for anything that escapes the root. Exported so the traversal
 * rule can be tested directly rather than only through a running protocol
 * handler.
 */
export function resolveBundlePath(
  root: string,
  requestPath: string,
): string | null {
  const decoded = decodeURIComponent(requestPath);
  const withoutQuery = decoded.split("?")[0]?.split("#")[0] ?? "/";
  const relative = withoutQuery.replace(/^\/+/, "");
  const candidate = resolve(join(root, normalize(relative)));
  const rootWithSeparator = resolve(root) + sep;

  if (!candidate.startsWith(rootWithSeparator) && candidate !== resolve(root)) {
    return null;
  }

  return candidate;
}

export function registerAppProtocol(rendererRoot: string): void {
  protocol.handle(APP_PROTOCOL, async (request) => {
    const url = new URL(request.url);

    if (url.host !== "app") {
      return new Response("Not found", { status: 404 });
    }

    const requested =
      url.pathname === "/" || url.pathname === "" ? "/index.html" : url.pathname;
    const filePath = resolveBundlePath(rendererRoot, requested);

    if (filePath === null) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      const info = await stat(filePath);

      if (!info.isFile()) {
        throw new Error("not a file");
      }

      const contentType =
        MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
      const stream = Readable.toWeb(
        createReadStream(filePath),
      ) as ReadableStream<Uint8Array>;

      return new Response(stream, {
        status: 200,
        headers: {
          "content-type": contentType,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      // The renderer is a single-page application: an unknown path is a client
      // route, so the shell is returned and the router resolves it.
      const fallback = resolveBundlePath(rendererRoot, "/index.html");

      if (fallback === null) {
        return new Response("Not found", { status: 404 });
      }

      const stream = Readable.toWeb(
        createReadStream(fallback),
      ) as ReadableStream<Uint8Array>;

      return new Response(stream, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
  });
}
