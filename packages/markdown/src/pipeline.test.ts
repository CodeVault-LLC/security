import { describe, expect, it } from "vitest";

import { renderMarkdown } from "./pipeline.js";

/**
 * Syntax coverage.
 *
 * One test per construct a researcher is told they can use. The assertions are
 * on rendered output rather than on the tree, because the tree is not what
 * ships — the sanitiser sits between the two and has removed a construct
 * before now.
 */

describe("GFM", () => {
  it("renders tables with column alignment", async () => {
    const html = await renderMarkdown(
      ["| Parameter | Value |", "| :-- | --: |", "| `id` | 7 |"].join("\n"),
    );

    expect(html).toContain("<table>");
    expect(html).toContain('<th align="left">Parameter</th>');
    expect(html).toContain('<td align="right">7</td>');
  });

  it("renders task lists as disabled checkboxes", async () => {
    const html = await renderMarkdown("- [x] Reproduced\n- [ ] Reported");

    expect(html).toContain('type="checkbox"');
    expect(html).toContain("disabled");
    expect(html).toContain("checked");
  });

  it("renders strikethrough", async () => {
    expect(await renderMarkdown("~~withdrawn~~")).toContain("<del>");
  });

  it("renders autolinks without inventing a protocol", async () => {
    const html = await renderMarkdown("See https://example.test/advisory");

    expect(html).toContain('href="https://example.test/advisory"');
  });

  it("renders footnotes and links them to the notes section", async () => {
    const html = await renderMarkdown(
      "Affected since 2.1[^v]\n\n[^v]: Confirmed against 2.1.4.",
    );

    expect(html).toContain('class="cv-footnotes"');
    expect(html).toContain('href="#cv-fn-fn-v"');
    expect(html).toContain('id="cv-fn-fn-v"');
  });
});

describe("headings", () => {
  it("gives every heading a namespaced id", async () => {
    const html = await renderMarkdown("## Attack path");

    expect(html).toContain('id="cv-h-attack-path"');
  });

  it("keeps ids unique across repeated headings", async () => {
    const html = await renderMarkdown("# Step\n\n# Step");

    expect(html).toContain('id="cv-h-step"');
    expect(html).toContain('id="cv-h-step-1"');
  });
});

describe("callouts", () => {
  it("renders a marked blockquote as a labelled panel", async () => {
    const html = await renderMarkdown(
      "> [!WARNING]\n> Destructive against production.",
    );

    expect(html).toContain('class="cv-callout cv-callout-warning"');
    expect(html).toContain('class="cv-callout-label">Warning<');
    expect(html).toContain("Destructive against production.");
    expect(html).not.toContain("[!WARNING]");
  });

  it("accepts every documented kind, case-insensitively", async () => {
    const html = await renderMarkdown("> [!note]\n> Ordinary.");

    expect(html).toContain("cv-callout-note");
  });

  it("keeps text on the marker's own line", async () => {
    const html = await renderMarkdown("> [!TIP] Try the staging host first.");

    expect(html).toContain("cv-callout-tip");
    expect(html).toContain("Try the staging host first.");
  });

  /**
   * A mistyped kind stays visible. Rendering `[!WARNIG]` as an ordinary
   * blockquote loses the author's intent quietly; leaving the marker in the
   * text is how they notice.
   */
  it("leaves an unknown kind as a plain blockquote", async () => {
    const html = await renderMarkdown("> [!WARNIG]\n> Typo.");

    expect(html).toContain("<blockquote>");
    expect(html).not.toContain("cv-callout");
    expect(html).toContain("[!WARNIG]");
  });

  it("does not mistake a CodeVault directive for a callout", async () => {
    const html = await renderMarkdown("> [evidence:EVID-000123]");

    expect(html).not.toContain("cv-callout");
    expect(html).toContain("[evidence:EVID-000123]");
  });
});

describe("code", () => {
  it("highlights a fence that declares its language", async () => {
    const html = await renderMarkdown('```js\nconst a = "x";\n```');

    expect(html).toContain("hljs-keyword");
    expect(html).toContain("hljs-string");
  });

  it("leaves an unlabelled fence unhighlighted", async () => {
    const html = await renderMarkdown("```\nGET /admin HTTP/1.1\n```");

    expect(html).not.toContain("hljs-");
    expect(html).toContain("GET /admin HTTP/1.1");
  });

  /**
   * The most common code block in this application, and not one of
   * highlight.js's defaults. A finding without a highlighted request is the
   * case that matters most.
   */
  it("highlights an HTTP request", async () => {
    const html = await renderMarkdown(
      "```http\nPOST /api/export HTTP/1.1\nHost: target.example\n```",
    );

    expect(html).toContain("hljs-");
    expect(html).toContain("POST");
  });

  it("highlights the configuration languages findings quote", async () => {
    for (const language of ["nginx", "dockerfile", "powershell", "x86asm"]) {
      const html = await renderMarkdown(
        `\`\`\`${language}\n# comment\nlisten 80;\n\`\`\``,
      );

      expect(html, language).toContain("hljs-");
    }
  });

  /**
   * Reports quote payloads in whatever language the target is written in. An
   * unknown one must degrade to plain text rather than fail the render.
   */
  it("survives a language it does not know", async () => {
    const html = await renderMarkdown("```hcl-but-not-really\npayload\n```");

    expect(html).toContain("payload");
  });
});

describe("maths", () => {
  it("renders inline maths as MathML", async () => {
    const html = await renderMarkdown("Complexity is $O(n^2)$ here.");

    expect(html).toContain("<math");
    expect(html).not.toContain("<img");
  });

  it("renders display maths", async () => {
    const html = await renderMarkdown("$$\n\\frac{a}{b}\n$$");

    expect(html).toContain("<math");
    expect(html).toContain("mfrac");
  });

  /**
   * MathML is the whole point of the KaTeX configuration: its HTML output
   * needs KaTeX's own web fonts, and a report may not fetch anything.
   */
  it("emits no stylesheet or font reference", async () => {
    const html = await renderMarkdown("$x^2$");

    expect(html).not.toContain("katex.min.css");
    expect(html).not.toContain("font");
  });
});

describe("mermaid fences", () => {
  it("becomes an inert diagram container holding its source", async () => {
    const html = await renderMarkdown("```mermaid\ngraph TD;\nA-->B;\n```");

    expect(html).toContain('class="cv-diagram"');
    expect(html).toContain('data-cv-diagram="mermaid"');
    expect(html).toContain('class="cv-diagram-source"');
    expect(html).toContain("A-->B;");
  });

  it("is not sent through the syntax highlighter", async () => {
    const html = await renderMarkdown("```mermaid\ngraph TD;\nA-->B;\n```");

    expect(html).not.toContain("hljs-");
    expect(html).not.toContain("language-mermaid");
  });

  it("leaves other fenced languages alone", async () => {
    const html = await renderMarkdown("```python\nprint(1)\n```");

    expect(html).not.toContain("cv-diagram");
  });
});
