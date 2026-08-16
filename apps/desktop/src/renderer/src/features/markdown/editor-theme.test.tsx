import { describe, expect, it } from "vitest";

import { EDITOR_THEME_SPEC } from "./editor-theme.js";

/**
 * The editor's theme.
 *
 * This exists because of a bug that was invisible in review: CodeMirror's base
 * theme is scoped to a generated class, so the colour rules in `app.css`
 * out-ranked by it did nothing at all, and the editor rendered with the light
 * palette inside a dark window. The checks below are the ones that would have
 * caught it.
 */

const DECLARATIONS = Object.entries(EDITOR_THEME_SPEC).flatMap(
  ([selector, block]) =>
    Object.entries(block).map(([property, value]) => ({
      selector,
      property,
      value: String(value),
    })),
);

/**
 * Rules CodeMirror's own base theme gives a hard-coded colour to, for the
 * extensions this editor loads. Each one has to be overridden here, or the
 * light palette shows through.
 */
const MUST_OVERRIDE = [
  ".cm-activeLine",
  ".cm-activeLineGutter",
  ".cm-gutters",
  ".cm-content",
  ".cm-scroller",
];

describe("coverage", () => {
  it.each(MUST_OVERRIDE)("overrides %s", (selector) => {
    const selectors = Object.keys(EDITOR_THEME_SPEC);

    expect(selectors.some((candidate) => candidate.includes(selector))).toBe(
      true,
    );
  });

  it("sets the caret colour, which the light base theme paints black", () => {
    const cursor = DECLARATIONS.find(
      (entry) =>
        entry.selector.includes(".cm-cursor") &&
        entry.property === "borderLeftColor",
    );

    expect(cursor?.value).toContain("var(--cv-");
  });

  it("sets the selection colour, which the light base theme paints grey", () => {
    const selection = DECLARATIONS.filter((entry) =>
      entry.selector.includes(".cm-selectionBackground"),
    );

    expect(selection.length).toBeGreaterThan(0);
  });

  /**
   * Two mechanisms paint selected text — the browser's `::selection` and the
   * layer CodeMirror draws over its own lines — and a researcher dragging
   * across a finding crosses between them. They have to name the same token or
   * they drift apart, which is exactly how one of them ended up unstyled.
   */
  it("selects with the same token the rest of the window uses", () => {
    const selection = DECLARATIONS.find((entry) =>
      entry.selector.includes(".cm-selectionBackground"),
    );

    expect(selection?.value).toBe("var(--cv-selection)");
  });

  it("is matched by a global rule for everything outside the editor", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    // Vitest's projects are rooted at the repository, so this is the working
    // directory whichever package the run was started from.
    const css = await readFile(
      resolve(process.cwd(), "apps/desktop/src/renderer/src/styles/app.css"),
      "utf8",
    );

    // Chromium's default selection colour ignores `color-scheme`, so without
    // this rule a dark window paints a near-white block over the text.
    expect(css).toMatch(/::selection\s*\{[^}]*var\(--cv-selection\)/);
  });
});

describe("theming", () => {
  /**
   * The whole reason one theme can serve a light and a dark window: every
   * colour is a token that the document re-defines. A literal here would be
   * correct in one palette and wrong in the other, and nothing would fail.
   */
  it("states every colour as a token, never a literal", () => {
    const colourish = DECLARATIONS.filter((entry) =>
      /color|background/i.test(entry.property),
    );

    expect(colourish.length).toBeGreaterThan(0);

    for (const entry of colourish) {
      if (entry.value === "transparent") {
        continue;
      }

      expect(entry.value, `${entry.selector} { ${entry.property} }`).toContain(
        "var(--cv-",
      );
      expect(entry.value).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(entry.value).not.toMatch(/\brgba?\(/i);
    }
  });

  it("takes its font from the application's own token", () => {
    const font = DECLARATIONS.find((entry) => entry.property === "fontFamily");

    expect(font?.value).toBe("var(--font-mono)");
  });
});
