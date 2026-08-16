import type { Element, Root } from "hast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

import { HEADING_ID_PREFIX } from "./sanitize.js";

/**
 * Identifier namespacing.
 *
 * Heading slugs come from author-controlled text, so an unprefixed one can
 * collide with the application's own DOM — a heading called "Config" becoming
 * `window.config` in the Electron renderer is a real, well-known trick. Every
 * generated id therefore lives under a prefix the rest of the app never uses,
 * and the sanitiser drops any id that does not.
 *
 * Footnote identifiers are namespaced upstream instead, by passing the same
 * prefix to mdast-util-to-hast, because it has to rewrite the links that point
 * at them at the same time.
 */

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

export const rehypeNamespaceIds: Plugin<[], Root> = () => (tree) => {
  visit(tree, "element", (node: Element) => {
    if (HEADINGS.has(node.tagName)) {
      const id = node.properties?.id;

      if (typeof id === "string" && !id.startsWith(HEADING_ID_PREFIX)) {
        node.properties = {
          ...node.properties,
          id: `${HEADING_ID_PREFIX}${id}`,
        };
      }

      return;
    }

    // The footnote section is emitted with GitHub's own class name, which the
    // sanitiser does not allow. Restate it in our namespace so it can be
    // styled without widening the allow-list to arbitrary class names.
    if (node.tagName === "section" && node.properties?.dataFootnotes === true) {
      node.properties = { ...node.properties, className: ["cv-footnotes"] };
    }
  });
};
