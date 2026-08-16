import { describe, expect, it } from "vitest";

import { renderMarkdown } from "./pipeline.js";

/**
 * Sanitisation.
 *
 * Everything this package renders quotes strings an attacker chose: request
 * bodies, filenames, hostnames, payloads a researcher pasted out of a proxy.
 * The rendered output is displayed inside an Electron renderer and printed by
 * a Chromium, so a hole here is not a cosmetic bug.
 *
 * Each case is a payload that has worked against some other Markdown pipeline.
 */

async function render(markdown: string): Promise<string> {
  return renderMarkdown(markdown);
}

describe("raw HTML", () => {
  it("drops script tags", async () => {
    const html = await render('<script>alert("x")</script>');

    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert");
  });

  it("drops event handlers on injected elements", async () => {
    const html = await render('<img src="x" onerror="alert(1)">');

    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<img");
  });

  it("drops iframes and objects", async () => {
    const html = await render(
      '<iframe src="https://example.test"></iframe><object data="x"></object>',
    );

    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<object");
  });

  it("drops style elements and attributes", async () => {
    const html = await render(
      '<style>body{display:none}</style><p style="color:red">x</p>',
    );

    expect(html).not.toContain("<style");
    expect(html).not.toContain("style=");
  });

  /**
   * The payload below is a real report body, not a hypothetical: a researcher
   * quoting the XSS they found. It has to survive as text.
   */
  it("keeps a quoted payload readable as text", async () => {
    const html = await render("The parameter accepts `<svg onload=alert(1)>`.");

    expect(html).toContain("&#x3C;svg onload=alert(1)>");
    expect(html).not.toContain("<svg");
  });
});

describe("links", () => {
  it("drops javascript: URLs", async () => {
    const html = await render("[click](javascript:alert(1))");

    expect(html).not.toContain("javascript:");
  });

  it("drops data: URLs", async () => {
    const html = await render("[click](data:text/html;base64,PHNjcmlwdD4=)");

    expect(html).not.toContain("data:text/html");
  });

  it("drops vbscript: URLs", async () => {
    const html = await render("[click](vbscript:msgbox(1))");

    expect(html).not.toContain("vbscript:");
  });

  it("keeps http, https and mailto", async () => {
    const html = await render(
      "[a](https://example.test) [b](http://example.test) [c](mailto:x@example.test)",
    );

    expect(html).toContain('href="https://example.test"');
    expect(html).toContain('href="http://example.test"');
    expect(html).toContain('href="mailto:x@example.test"');
  });

  it("does not fetch images, because a report must not phone home", async () => {
    const html = await render("![tracker](https://example.test/pixel.png)");

    expect(html).not.toContain("<img");
    expect(html).not.toContain("pixel.png");
  });
});

describe("identifiers", () => {
  /**
   * DOM clobbering: a heading whose slug matches a global the application
   * reads would shadow it. Every generated id is namespaced so it cannot.
   */
  it("namespaces a heading that would otherwise clobber a global", async () => {
    const html = await render("# config");

    expect(html).toContain('id="cv-h-config"');
    expect(html).not.toContain('id="config"');
  });

  it("cannot be given an arbitrary id through raw HTML", async () => {
    const html = await render('<div id="attributes">x</div>');

    expect(html).not.toContain('id="attributes"');
  });
});

describe("class names", () => {
  it("cannot forge a CodeVault class through raw HTML", async () => {
    const html = await render('<div class="cv-callout">Official notice</div>');

    expect(html).not.toContain("cv-callout");
  });

  /**
   * A forged directive-error span would let a report claim that a reference
   * failed to resolve when it never existed.
   */
  it("cannot forge a directive error", async () => {
    const html = await render(
      '<span class="cv-directive-error">Evidence withheld</span>',
    );

    expect(html).not.toContain("cv-directive-error");
  });
});

describe("diagrams", () => {
  /**
   * The fence's contents stay text until `hydrateDiagrams` draws them, and
   * what mermaid then produces is re-sanitised — see `svg-sanitise.test.ts`.
   * Here the only claim is that nothing in the source becomes markup.
   */
  it("keeps a hostile node label as escaped text at render time", async () => {
    const html = await render(
      '```mermaid\ngraph TD;\nA["<img src=x onerror=alert(1)>"]-->B;\n```',
    );

    expect(html).not.toContain("<img");
    expect(html).toContain("&#x3C;img src=x onerror=alert(1)>");
  });

  it("cannot forge a diagram container through raw HTML", async () => {
    const html = await render(
      '<div class="cv-diagram" data-cv-diagram="mermaid">x</div>',
    );

    expect(html).not.toContain("data-cv-diagram");
  });
});

describe("maths", () => {
  /**
   * KaTeX has had command-injection issues in the past; `\href` and friends
   * are the usual route. The sanitiser is the backstop regardless.
   */
  it("produces no link from a javascript: URL smuggled through \\href", async () => {
    const html = await render("$\\href{javascript:alert(1)}{x}$");

    // KaTeX refuses \href unless explicitly trusted, so the command survives
    // only as the literal TeX it was. No href attribute is produced at all.
    expect(html).not.toContain("href=");
    expect(html).not.toMatch(/<a[\s>]/);
  });

  it("renders a malformed expression as flagged text rather than failing", async () => {
    const html = await render("$\\frac{1}$");

    expect(html).toContain("katex-error");
  });
});
