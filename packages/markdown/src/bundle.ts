import { createRequire } from "node:module";

/**
 * Locating mermaid's browser bundle.
 *
 * The PDF worker injects mermaid into the page it is printing. Resolving the
 * file has to happen here rather than at the call site: this is the package
 * that declares mermaid as a dependency, and it is the only place the path is
 * guaranteed to resolve.
 *
 * Node-only, and deliberately not part of the package's main entry point — the
 * desktop renderer imports mermaid through the bundler instead.
 */

/**
 * Absolute path to the self-contained mermaid bundle.
 *
 * The `.min.js` build is the one that assigns `globalThis.mermaid` and inlines
 * every chunk. The ESM build loads its diagram types on demand, which an
 * offline page cannot do.
 */
export function mermaidBundlePath(): string {
  return createRequire(import.meta.url).resolve("mermaid/dist/mermaid.min.js");
}
