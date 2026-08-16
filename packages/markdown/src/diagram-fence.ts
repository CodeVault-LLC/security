import type { Element, Root } from "hast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

/**
 * Mermaid fences.
 *
 * A ```mermaid block becomes an inert container holding its own source. No
 * diagram is drawn here: this package renders in Node, in the Electron
 * renderer and inside the PDF worker's Chromium, and only the last two have a
 * DOM. Drawing is left to `hydrateDiagrams`, which runs where there is one.
 *
 * The source is kept as a visible `<pre>` rather than hidden in an attribute.
 * If hydration never runs — an old export, a stylesheet that failed, a reader
 * who printed the HTML directly — the reader gets the diagram's source instead
 * of an empty box, which is the same rule the directive renderer follows.
 */

export const DIAGRAM_CLASS = "cv-diagram";
export const DIAGRAM_SOURCE_CLASS = "cv-diagram-source";
export const DIAGRAM_ATTRIBUTE = "data-cv-diagram";

function languageOf(node: Element): string | null {
  const className = node.properties?.className;

  if (!Array.isArray(className)) {
    return null;
  }

  for (const entry of className) {
    if (typeof entry === "string" && entry.startsWith("language-")) {
      return entry.slice("language-".length).toLowerCase();
    }
  }

  return null;
}

/** Rewrites `<pre><code class="language-mermaid">` into a diagram container. */
export const rehypeDiagramFence: Plugin<[], Root> = () => (tree) => {
  visit(tree, "element", (node: Element, index, parent) => {
    if (node.tagName !== "pre" || parent === undefined || index === undefined) {
      return;
    }

    const [code] = node.children.filter(
      (child): child is Element =>
        child.type === "element" && child.tagName === "code",
    );

    if (code === undefined || languageOf(code) !== "mermaid") {
      return;
    }

    // The class is dropped from the inner <code>: leaving `language-mermaid`
    // there would send the block through the syntax highlighter, which has no
    // mermaid grammar and would colour it as an unknown language.
    code.properties = {};

    const container: Element = {
      type: "element",
      tagName: "div",
      // `dataCvDiagram` is the hast spelling of `data-cv-diagram`; writing the
      // dashed form here produces a property the sanitiser will not recognise.
      properties: {
        className: [DIAGRAM_CLASS],
        dataCvDiagram: "mermaid",
      },
      children: [
        {
          ...node,
          properties: { className: [DIAGRAM_SOURCE_CLASS] },
        },
      ],
    };

    parent.children[index] = container;
  });
};
