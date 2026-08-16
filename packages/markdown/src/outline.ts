import { HEADING_ID_PREFIX } from "./sanitize.js";

/**
 * Document outline.
 *
 * Used by the editor to show where you are in a long finding and to jump
 * around it. Deliberately a scan of the source rather than a parse of the
 * tree: it runs on every keystroke of a half-written document, where a real
 * parse would be both slower and wrong about text the author is mid-way
 * through typing.
 */

export interface OutlineEntry {
  depth: number;
  text: string;
  /** 1-indexed line in the source, for scrolling the editor to it. */
  line: number;
  /** Matches the `id` the renderer gives this heading. */
  id: string;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/** Mirrors github-slugger closely enough for anchors the editor generates. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

export function collectHeadings(markdown: string): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  const seen = new Map<string, number>();

  let fence: string | null = null;

  markdown.split("\n").forEach((raw, index) => {
    const fenceMatch = FENCE.exec(raw);

    if (fenceMatch !== null) {
      const marker = fenceMatch[1] ?? "";

      // A `#` inside a code fence is a comment or a shell prompt, not a
      // heading. Tracking the fence is the whole reason this is not one regex.
      if (fence === null) {
        fence = marker[0] ?? null;
      } else if (marker.startsWith(fence)) {
        fence = null;
      }

      return;
    }

    if (fence !== null) {
      return;
    }

    const match = HEADING.exec(raw);

    if (match === null) {
      return;
    }

    const text = (match[2] ?? "").trim();
    const base = slug(text);
    const count = seen.get(base) ?? 0;

    seen.set(base, count + 1);

    entries.push({
      depth: (match[1] ?? "#").length,
      text,
      line: index + 1,
      id: `${HEADING_ID_PREFIX}${base}${count === 0 ? "" : `-${String(count)}`}`,
    });
  });

  return entries;
}
