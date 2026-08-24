import { describe, expect, it } from "vitest";

import { renderMarkdown } from "@codevault/markdown";

import { buildReportHtml } from "./html.js";
import { extractPdfText, renderPdf } from "./pdf.js";

/**
 * PDF output.
 *
 * Renders a real document with a real browser and reads the text back. The
 * assertions are the ones a researcher's reputation depends on: the TLP marking
 * is on the page, the reference and title are there, and nothing that was
 * filtered out of the source reappears in the output.
 *
 * Skipped unless a browser is installed, so `bun install` alone still gives a
 * green suite.
 */

const SENTINEL = "INTERNAL_SECRET_SENTINEL";

async function browserAvailable(): Promise<boolean> {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();

    await browser.close();

    return true;
  } catch {
    return false;
  }
}

const hasBrowser = await browserAvailable();
const describeIfBrowser = hasBrowser ? describe : describe.skip;

describeIfBrowser("PDF rendering", () => {
  const html = buildReportHtml({
    title: "Unauthenticated command injection in the update handler",
    reference: "RPT-000042",
    audience: "PUBLIC",
    tlp: "TLP:CLEAR",
    caseReference: "CASE-2026-0007",
    generatedAt: "2026-08-15",
    organisation: "CodeVault Research",
    authorName: "A. Researcher",
    templateVersion: "1.0.0",
    sections: [
      {
        title: "Summary",
        html: "<p>The firmware update handler passes a filename to a shell.</p>",
      },
      {
        title: "Affected Versions",
        html: "<p>Firmware 2.8.0 through 2.8.4. Fixed in 2.8.5.</p>",
      },
    ],
  });

  it("produces a PDF whose text carries the title and reference", async () => {
    const result = await renderPdf({ html, title: "Public advisory" });
    const text = await extractPdfText(result.bytes);

    expect(result.byteLength).toBeGreaterThan(1_000);
    expect(text).toContain("Unauthenticated command injection");
    expect(text).toContain("RPT-000042");
    expect(text).toContain("CASE-2026-0007");
  }, 180_000);

  it("marks the document with its TLP label", async () => {
    const result = await renderPdf({ html, title: "Public advisory" });
    const text = await extractPdfText(result.bytes);

    expect(text).toContain("TLP:CLEAR");
    expect(text).toContain("share this without restriction");
  }, 180_000);

  it("includes the section content and a page footer", async () => {
    const result = await renderPdf({ html, title: "Public advisory" });
    const text = await extractPdfText(result.bytes);

    expect(text).toContain("Affected Versions");
    expect(text).toContain("2.8.5");
    expect(text).toContain("CodeVault");
  }, 180_000);

  it("contains nothing that was filtered out of the source", async () => {
    const result = await renderPdf({ html, title: "Public advisory" });
    const text = await extractPdfText(result.bytes);

    expect(text).not.toContain(SENTINEL);
  }, 180_000);

  it("hashes deterministically for the same input", async () => {
    const first = await renderPdf({ html, title: "Public advisory" });

    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.bytes.slice(0, 5)).toEqual(
      new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
    );
  }, 180_000);

  /**
   * The end of the diagram path: a mermaid fence written in the editor,
   * rendered by the shared pipeline, drawn by the same hydration code the
   * preview uses, and printed. The label is read back out of the PDF text,
   * which is only there if the SVG survived sanitisation and pagination.
   */
  it("draws a mermaid diagram into the printed page", async () => {
    const section = await renderMarkdown(
      [
        "```mermaid",
        "graph LR;",
        "  Attacker-->|crafted filename| UpdateHandler;",
        "  UpdateHandler-->Shell;",
        "```",
      ].join("\n"),
    );

    const withDiagram = buildReportHtml({
      title: "Attack path",
      reference: "RPT-000043",
      audience: "PUBLIC",
      tlp: "TLP:CLEAR",
      caseReference: "CASE-2026-0007",
      generatedAt: "2026-08-15",
      organisation: "CodeVault Research",
      authorName: "A. Researcher",
      templateVersion: "1.0.0",
      sections: [{ title: "Attack path", html: section }],
    });

    const result = await renderPdf({
      html: withDiagram,
      title: "Attack path",
    });
    const text = await extractPdfText(result.bytes);
    // Each label is its own text run in the SVG, so the extractor spaces them
    // more generously than the prose around them.
    const collapsed = text.replace(/\s+/g, " ");

    expect(collapsed).toContain("Attacker");
    expect(collapsed).toContain("UpdateHandler");
    expect(collapsed).toContain("crafted filename");
    // The source block is replaced by the drawing, not printed beside it.
    expect(collapsed).not.toContain("graph LR;");
  }, 180_000);

  it("prints a structured data chart with its labels and values", async () => {
    const section = await renderMarkdown(
      [
        "```chart",
        JSON.stringify({
          title: "Findings by severity",
          unit: "findings",
          data: [
            { label: "Critical", value: 2 },
            { label: "High", value: 5 },
          ],
        }),
        "```",
      ].join("\n"),
    );

    const withChart = buildReportHtml({
      title: "Security review",
      reference: "RPT-000044",
      audience: "INTERNAL",
      tlp: "TLP:AMBER",
      caseReference: "CASE-2026-0007",
      generatedAt: "2026-08-24",
      organisation: "CodeVault Research",
      authorName: "A. Researcher",
      templateVersion: "1.0.0",
      sections: [{ title: "Finding distribution", html: section }],
    });

    const result = await renderPdf({
      html: withChart,
      title: "Security review",
    });
    const text = (await extractPdfText(result.bytes)).replace(/\s+/g, " ");

    expect(text).toContain("Findings by severity");
    expect(text).toContain("Critical");
    expect(text).toContain("2 findings");
    expect(text).toContain("High");
    expect(text).toContain("5 findings");
  }, 180_000);

  it("refuses to load a remote resource while rendering", async () => {
    // A report that fetched a remote image would be a way to learn that an
    // embargoed document had been opened, and by whom.
    const withRemoteImage = html.replace(
      "<main>",
      '<main><img src="https://tracker.example/pixel.png" alt="">',
    );

    const result = await renderPdf({
      html: withRemoteImage,
      title: "Public advisory",
    });

    expect(result.byteLength).toBeGreaterThan(1_000);
  }, 180_000);
});
