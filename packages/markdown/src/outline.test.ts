import { describe, expect, it } from "vitest";

import { collectHeadings } from "./outline.js";
import { renderMarkdown } from "./pipeline.js";

/**
 * Document outline.
 *
 * Drives the editor's jump list, so its line numbers and its ids both have to
 * be right: one scrolls the editor, the other has to match what the renderer
 * put in the preview.
 */

describe("collectHeadings", () => {
  it("reads depth, text and line", () => {
    const outline = collectHeadings(
      ["# Finding", "", "text", "", "## Attack path"].join("\n"),
    );

    expect(outline).toEqual([
      { depth: 1, text: "Finding", line: 1, id: "cv-h-finding" },
      { depth: 2, text: "Attack path", line: 5, id: "cv-h-attack-path" },
    ]);
  });

  /**
   * The reason this is a scan and not a regex: a shell prompt inside a fence
   * looks exactly like a level-one heading.
   */
  it("ignores headings inside a fenced code block", () => {
    const outline = collectHeadings(
      ["```bash", "# root@host: id", "```", "# Real"].join("\n"),
    );

    expect(outline).toHaveLength(1);
    expect(outline[0]?.text).toBe("Real");
  });

  it("handles tilde fences and longer fence markers", () => {
    const outline = collectHeadings(
      ["~~~", "# not a heading", "~~~", "````", "# nor this", "````"].join(
        "\n",
      ),
    );

    expect(outline).toEqual([]);
  });

  it("does not close a long fence with a shorter marker", () => {
    const outline = collectHeadings(
      ["````markdown", "```", "# still code", "````", "# Real heading"].join(
        "\n",
      ),
    );

    expect(outline.map((entry) => entry.text)).toEqual(["Real heading"]);
  });

  it("disambiguates repeated headings the way the renderer does", async () => {
    const markdown = "# Step\n\n# Step";
    const outline = collectHeadings(markdown);
    const html = await renderMarkdown(markdown);

    expect(outline.map((entry) => entry.id)).toEqual([
      "cv-h-step",
      "cv-h-step-1",
    ]);

    for (const entry of outline) {
      expect(html).toContain(`id="${entry.id}"`);
    }
  });

  it("produces ids the renderer agrees with for punctuated headings", async () => {
    const markdown = "## CVE-2026-1234: the `id` parameter";
    const [entry] = collectHeadings(markdown);
    const html = await renderMarkdown(markdown);

    expect(entry).toBeDefined();
    expect(html).toContain(`id="${entry?.id ?? ""}"`);
  });

  it("ignores trailing closing hashes", () => {
    expect(collectHeadings("## Impact ##")[0]?.text).toBe("Impact");
  });

  it("returns nothing for a document with no headings", () => {
    expect(collectHeadings("just prose\n\nand more")).toEqual([]);
  });
});
