import type { Blockquote, Paragraph, Root, Text } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

/**
 * Callouts.
 *
 * GitHub's `> [!WARNING]` blockquote syntax, rendered as a labelled panel. A
 * security report leans on these more than most documents: "do not run this
 * against production", "this payload is destructive", "embargoed until".
 *
 * The marker is matched only at the very start of a blockquote's first
 * paragraph. `[!WARNING]` cannot collide with a CodeVault directive such as
 * `[evidence:EVID-000123]`, whose grammar requires a lowercase letter first.
 */

export const CALLOUT_KINDS = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
] as const;

export type CalloutKind = (typeof CALLOUT_KINDS)[number];

/** Human labels. Rendered as text, never signalled by colour alone. */
const CALLOUT_LABELS: Record<CalloutKind, string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};

const MARKER = /^\[!([A-Za-z]+)\][ \t]*\r?\n?/;

function isCalloutKind(value: string): value is CalloutKind {
  return (CALLOUT_KINDS as readonly string[]).includes(value);
}

/**
 * Reads the callout marker from a blockquote, and strips it when found.
 *
 * Returns null for an ordinary blockquote, and for `[!NONSENSE]` — an unknown
 * kind stays a plain blockquote with its marker text intact, so the author can
 * see that they mistyped rather than losing the line.
 */
function takeMarker(node: Blockquote): CalloutKind | null {
  const [first] = node.children;

  if (first === undefined || first.type !== "paragraph") {
    return null;
  }

  const paragraph: Paragraph = first;
  const [firstChild] = paragraph.children;

  if (firstChild === undefined || firstChild.type !== "text") {
    return null;
  }

  const text: Text = firstChild;
  const match = MARKER.exec(text.value);

  if (match === null) {
    return null;
  }

  const kind = (match[1] ?? "").toLowerCase();

  if (!isCalloutKind(kind)) {
    return null;
  }

  const remainder = text.value.slice(match[0].length);

  if (remainder.length === 0 && paragraph.children.length === 1) {
    // The marker was the whole first line: drop the now-empty paragraph.
    node.children.shift();
  } else {
    text.value = remainder;
  }

  return kind;
}

/**
 * Rewrites marked blockquotes into `cv-callout` containers.
 *
 * The label is emitted as real text rather than a CSS pseudo-element so it
 * survives into plain-text extraction and into a printed page whose stylesheet
 * failed to load.
 */
export const remarkCallouts: Plugin<[], Root> = () => (tree) => {
  visit(tree, "blockquote", (node: Blockquote) => {
    const kind = takeMarker(node);

    if (kind === null) {
      return;
    }

    node.data = {
      ...node.data,
      hName: "div",
      hProperties: { className: ["cv-callout", `cv-callout-${kind}`] },
    };

    node.children.unshift({
      type: "paragraph",
      data: {
        hName: "p",
        hProperties: { className: ["cv-callout-label"] },
      },
      children: [{ type: "text", value: CALLOUT_LABELS[kind] }],
    });
  });
};
