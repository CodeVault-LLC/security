import { createHash } from "node:crypto";

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

/** Extracts plain text from a PDF, used by the export validation test. */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  // Uncompressed text objects are enough to assert that a title, TLP marking
  // and footer are present, without adding a PDF parsing dependency.
  const raw = Buffer.from(bytes).toString("latin1");
  const chunks: string[] = [];

  for (const match of raw.matchAll(/\((?:\\.|[^\\)])*\)/g)) {
    chunks.push(
      match[0]
        .slice(1, -1)
        .replace(/\\([()\\])/g, "$1")
        .replace(/\\(\d{1,3})/g, (_, code: string) =>
          String.fromCharCode(Number.parseInt(code, 8)),
        ),
    );
  }

  return chunks.join("");
}
