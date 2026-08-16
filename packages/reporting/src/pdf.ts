import { createHash } from "node:crypto";

import {
  hydrateDiagramsIn,
  MERMAID_CONFIG,
  sanitiseSvgElement,
  SVG_POLICY,
} from "@codevault/markdown/diagrams";
import type { Page } from "playwright";

/**
 * PDF rendering.
 *
 * Playwright's Chromium prints the report HTML. Two properties matter more than
 * fidelity: the browser is launched with networking disabled at the request
 * level, so a report cannot phone home while it is being rendered, and the
 * output is hashed so an export can be proved unchanged later.
 *
 * Playwright is imported dynamically because only the worker needs it; the
 * server and desktop bundles must not pull in a browser driver.
 */

export interface PdfRenderOptions {
  /** Complete, self-contained HTML document. */
  html: string;
  /** Metadata written into the PDF. */
  title: string;
  /** Milliseconds allowed for pagination and printing. */
  timeoutMs?: number;
  /** Chromium executable path, when the environment provides its own. */
  executablePath?: string;
}

export interface PdfRenderResult {
  bytes: Uint8Array;
  sha256: string;
  byteLength: number;
}

/**
 * Paged.js polyfill.
 *
 * Injected from the installed package rather than a CDN. Without it, Chromium
 * ignores running headers, page counters and most break control, which is
 * exactly the part of the layout a report depends on.
 */
async function pagedJsScript(): Promise<string | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const entry = require.resolve("pagedjs/dist/paged.polyfill.js");

    return await readFile(entry, "utf8");
  } catch {
    // Without Paged.js the report still prints; it loses running headers and
    // page counters, which the caller can detect from the missing footer.
    return null;
  }
}

/**
 * Mermaid, for reports that contain a diagram.
 *
 * Read from the installed package, never a CDN, and injected into a page that
 * is already offline. Loaded only when the document actually has a diagram in
 * it: the bundle is several megabytes and most reports have none.
 */
async function mermaidScript(): Promise<string | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    // Resolved by the package that depends on mermaid; it does not resolve
    // from here.
    const { mermaidBundlePath } = await import("@codevault/markdown/bundle");

    return await readFile(mermaidBundlePath(), "utf8");
  } catch {
    return null;
  }
}

/**
 * Draws the report's diagrams inside the page.
 *
 * The sanitiser and the hydration routine are injected as their own source —
 * the same functions the desktop preview calls — so a diagram in the PDF is
 * produced by the same code, and filtered by the same allow-list, as the one
 * the researcher approved on screen.
 *
 * Runs before Paged.js: pagination has to measure the drawn SVG, not the
 * source block it replaces.
 */
async function drawDiagrams(page: Page, timeout: number): Promise<void> {
  const script = await mermaidScript();

  if (script === null) {
    // Without mermaid the diagram containers keep their source visible, which
    // is the same fallback an un-hydrated preview shows.
    return;
  }

  await page.addScriptTag({ content: script });
  await page.addScriptTag({
    content: `window.__cvSanitiseSvg = (${sanitiseSvgElement.toString()});
      window.__cvHydrateDiagrams = (${hydrateDiagramsIn.toString()});`,
  });

  // Passed as source text rather than a callback so this module needs no DOM
  // library in its own compilation, matching the Paged.js wait below.
  await page
    .evaluate(
      `(async () => {
        const config = ${JSON.stringify(MERMAID_CONFIG)};
        window.mermaid.initialize({ ...config, secure: [...config.secure] });

        return window.__cvHydrateDiagrams(document, {
          render: (id, source) => window.mermaid.render(id, source),
          sanitise: window.__cvSanitiseSvg,
          policy: ${JSON.stringify(SVG_POLICY)},
        });
      })()`,
    )
    .catch(() => {
      // A diagram that cannot be drawn leaves its source in the document. The
      // export is still valid and the reader can still see what was meant.
    });

  await page
    .waitForFunction(
      `document.querySelectorAll('[data-cv-diagram]:not([data-cv-drawn])').length === 0`,
      undefined,
      { timeout: Math.min(timeout, 30_000) },
    )
    .catch(() => {
      // Same fallback: print what is there rather than failing the export.
    });
}

export async function renderPdf(
  options: PdfRenderOptions,
): Promise<PdfRenderResult> {
  const { chromium } = await import("playwright");
  const timeout = options.timeoutMs ?? 120_000;

  const browser = await chromium.launch({
    ...(options.executablePath === undefined
      ? {}
      : { executablePath: options.executablePath }),
    args: [
      "--disable-extensions",
      "--disable-plugins",
      "--no-first-run",
      "--disable-background-networking",
    ],
  });

  try {
    const context = await browser.newContext({
      // The report must be entirely self-contained. Anything it tries to fetch
      // is a bug or an exfiltration attempt, and either way it is refused.
      offline: true,
      javaScriptEnabled: true,
    });

    await context.route("**/*", async (route) => {
      const url = route.request().url();

      if (url.startsWith("data:") || url.startsWith("about:")) {
        await route.continue();

        return;
      }

      await route.abort("blockedbyclient");
    });

    const page = await context.newPage();

    await page.setContent(options.html, {
      waitUntil: "domcontentloaded",
      timeout,
    });

    if (options.html.includes("data-cv-diagram")) {
      await drawDiagrams(page, timeout);
    }

    const polyfill = await pagedJsScript();

    if (polyfill !== null) {
      await page.addScriptTag({ content: polyfill });
      // Evaluated inside the page, where `document` exists; typed as a string
      // so this module needs no DOM library in its own compilation.
      await page
        .waitForFunction(
          `document.querySelector(".pagedjs_pages") !== null ||
           document.body.classList.contains("pagedjs_clear_inital_page_break")`,
          undefined,
          { timeout: Math.min(timeout, 60_000) },
        )
        .catch(() => {
          // Pagination failed; the document still prints with browser defaults.
        });
    }

    const bytes = await page.pdf({
      format: "A4",
      printBackground: true,
      // Paged.js draws the margins itself; a second set from Chromium would
      // push the running headers off the page.
      margin:
        polyfill === null
          ? { top: "20mm", bottom: "18mm", left: "18mm", right: "18mm" }
          : { top: "0", bottom: "0", left: "0", right: "0" },
      displayHeaderFooter: false,
      tagged: true,
      outline: true,
    });

    await context.close();

    const digest = createHash("sha256").update(bytes).digest("hex");

    return {
      bytes: new Uint8Array(bytes),
      sha256: digest,
      byteLength: bytes.byteLength,
    };
  } finally {
    await browser.close();
  }
}

/**
 * Extracts the text of a PDF.
 *
 * Used to validate an export: that the title, the reference and the TLP marking
 * really are on the page, and that nothing filtered out of the source reappears
 * in the output. Chromium compresses content streams and subsets fonts, so this
 * goes through a real PDF reader rather than scanning for parenthesised
 * strings, which returns binary noise.
 *
 * `pdfjs-dist` is a development dependency: this function exists for
 * verification, and a deployment that never calls it never loads it.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const document = await pdfjs.getDocument({
    data: bytes,
    // A report is self-contained by construction, and the extractor must not
    // reach the network any more than the renderer does.
    disableFontFace: true,
    useSystemFonts: false,
  }).promise;

  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();

    pages.push(
      content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
    );
  }

  await document.cleanup();

  return pages.join("\n");
}
