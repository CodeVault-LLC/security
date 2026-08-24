/**
 * Markdown editing commands.
 *
 * Pure transforms over `(text, selection)`. Keeping them out of CodeMirror is
 * deliberate: this is the part with all the awkward cases — a heading that is
 * already a heading, a list item continued at the end of a list, a URL pasted
 * over a phrase — and it is far easier to be sure they are right when they can
 * be tested as functions rather than driven through an editor.
 */

export interface Selection {
  from: number;
  to: number;
}

export interface Edit {
  text: string;
  selection: Selection;
}

export type Command = (text: string, selection: Selection) => Edit;

/** Start of the line containing `position`. */
function lineStart(text: string, position: number): number {
  return text.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
}

/** End of the line containing `position`, excluding the newline. */
function lineEnd(text: string, position: number): number {
  const index = text.indexOf("\n", position);

  return index === -1 ? text.length : index;
}

function replace(
  text: string,
  from: number,
  to: number,
  insert: string,
  selection: Selection,
): Edit {
  return {
    text: text.slice(0, from) + insert + text.slice(to),
    selection,
  };
}

/**
 * Wraps or unwraps the selection in an inline marker.
 *
 * Unwrapping also handles the case where the markers sit just outside the
 * selection, which is what happens when a researcher double-clicks a bold word
 * and presses the shortcut again to undo it.
 */
export function toggleInline(marker: string): Command {
  return (text, selection) => {
    const { from, to } = selection;
    const selected = text.slice(from, to);
    const width = marker.length;

    if (
      selected.startsWith(marker) &&
      selected.endsWith(marker) &&
      selected.length >= width * 2
    ) {
      const inner = selected.slice(width, selected.length - width);

      return replace(text, from, to, inner, {
        from,
        to: from + inner.length,
      });
    }

    const before = text.slice(Math.max(0, from - width), from);
    const after = text.slice(to, to + width);

    if (before === marker && after === marker) {
      return replace(text, from - width, to + width, selected, {
        from: from - width,
        to: from - width + selected.length,
      });
    }

    const wrapped = `${marker}${selected}${marker}`;

    return replace(text, from, to, wrapped, {
      // With nothing selected the cursor lands between the markers, ready to
      // type; with a selection it stays around the same words.
      from: from + width,
      to: from + width + selected.length,
    });
  };
}

/** Lines fully or partially covered by the selection. */
function selectedLines(text: string, selection: Selection): string[] {
  const start = lineStart(text, selection.from);
  const end = lineEnd(text, selection.to);

  return text.slice(start, end).split("\n");
}

/**
 * Adds a prefix to every selected line, or removes it if every line has it.
 *
 * Ordered lists are numbered as they are applied rather than repeating "1.",
 * because the number is what the author sees while writing even though
 * Markdown would renumber it on render.
 */
export function toggleLinePrefix(prefix: string): Command {
  return (text, selection) => {
    const start = lineStart(text, selection.from);
    const end = lineEnd(text, selection.to);
    const lines = selectedLines(text, selection);
    const ordered = prefix === "1. ";
    const matcher = ordered ? /^\d+\.\s/ : null;

    const has = (line: string): boolean =>
      matcher === null ? line.startsWith(prefix) : matcher.test(line);

    const allPrefixed = lines.every(
      (line) => line.trim().length === 0 || has(line),
    );

    const updated = lines.map((line, index) => {
      if (line.trim().length === 0) {
        return line;
      }

      if (allPrefixed) {
        return matcher === null
          ? line.slice(prefix.length)
          : line.replace(matcher, "");
      }

      return ordered ? `${String(index + 1)}. ${line}` : `${prefix}${line}`;
    });

    const insert = updated.join("\n");

    return replace(text, start, end, insert, {
      from: start,
      to: start + insert.length,
    });
  };
}

const HEADING = /^(#{1,6})\s+/;

/** Sets, or clears, the heading level of the selected lines. */
export function toggleHeading(level: number): Command {
  return (text, selection) => {
    const start = lineStart(text, selection.from);
    const end = lineEnd(text, selection.to);
    const marker = `${"#".repeat(level)} `;

    const updated = selectedLines(text, selection)
      .map((line) => {
        const match = HEADING.exec(line);

        if (match === null) {
          return `${marker}${line}`;
        }

        const body = line.slice(match[0].length);

        // Applying the level a line already has removes it, so the same
        // shortcut turns a heading back into a paragraph.
        return match[1]?.length === level ? body : `${marker}${body}`;
      })
      .join("\n");

    return replace(text, start, end, updated, {
      from: start,
      to: start + updated.length,
    });
  };
}

const URL_LIKE = /^(https?:\/\/|mailto:)\S+$/i;

/**
 * Turns the selection into a link.
 *
 * If the selection is itself a URL it becomes the target and the cursor goes
 * to the empty label; otherwise the selection becomes the label and the
 * placeholder target is selected, ready to be replaced by a paste.
 */
export function insertLink(text: string, selection: Selection): Edit {
  const { from, to } = selection;
  const selected = text.slice(from, to);

  if (URL_LIKE.test(selected.trim())) {
    const insert = `[](${selected.trim()})`;

    return replace(text, from, to, insert, { from: from + 1, to: from + 1 });
  }

  const target = "https://";
  const insert = `[${selected}](${target})`;
  const targetAt = from + selected.length + 3;

  return replace(text, from, to, insert, {
    from: targetAt,
    to: targetAt + target.length,
  });
}

/**
 * Applies a pasted URL to the selection instead of replacing it.
 *
 * Pasting an advisory link over a phrase almost always means "link this", and
 * having to retype the phrase afterwards is the kind of small friction that
 * makes writing a report feel like paperwork. Returns null when the paste is
 * not a URL, so the editor handles it normally.
 */
export function linkOnPaste(
  text: string,
  selection: Selection,
  pasted: string,
): Edit | null {
  const url = pasted.trim();

  if (selection.from === selection.to || !URL_LIKE.test(url)) {
    return null;
  }

  const selected = text.slice(selection.from, selection.to);

  if (URL_LIKE.test(selected.trim())) {
    return null;
  }

  const insert = `[${selected}](${url})`;

  return replace(text, selection.from, selection.to, insert, {
    from: selection.from + insert.length,
    to: selection.from + insert.length,
  });
}

/**
 * Inserts a block on its own lines.
 *
 * The blank lines matter: a table or a fence butted against the paragraph
 * above it is a different document to Markdown, and the mistake is invisible
 * until the preview.
 */
export function insertBlock(block: string): Command {
  return (text, selection) => {
    const start = lineStart(text, selection.from);
    const atLineStart = start === selection.from;
    const before = text.slice(0, selection.from);
    const after = text.slice(selection.to);

    const lead =
      before.length === 0
        ? ""
        : before.endsWith("\n\n")
          ? ""
          : before.endsWith("\n")
            ? "\n"
            : atLineStart
              ? "\n"
              : "\n\n";

    const tail = after.startsWith("\n") || after.length === 0 ? "\n" : "\n\n";
    const insert = `${lead}${block}${tail}`;
    const cursor = selection.from + lead.length + block.length;

    return replace(text, selection.from, selection.to, insert, {
      from: cursor,
      to: cursor,
    });
  };
}

/** Markers a list item can start with, longest first so `- [ ]` wins. */
const LIST_ITEM =
  /^(\s*)(?:([-*+])\s+\[([ xX])\]\s+|([-*+])\s+|(\d+)([.)])\s+|(>)\s?)/;

/**
 * Continues a list, quote or task list onto the next line.
 *
 * Pressing Enter on an item that has no content ends the list instead, which
 * is what every editor a researcher already uses does. Returns null when the
 * cursor is not in a list, leaving Enter alone.
 */
export function continueList(text: string, position: number): Edit | null {
  const start = lineStart(text, position);
  const line = text.slice(start, lineEnd(text, position));
  const match = LIST_ITEM.exec(line);

  if (match === null) {
    return null;
  }

  const [marker = ""] = match;
  const indent = match[1] ?? "";
  const content = line.slice(marker.length);

  if (content.trim().length === 0) {
    // An empty item: clear the line and leave the list.
    return replace(text, start, start + line.length, indent, {
      from: start + indent.length,
      to: start + indent.length,
    });
  }

  const task = match[3];
  const bullet = match[2] ?? match[4];
  const number = match[5];
  const quote = match[7];

  let next: string;

  if (task !== undefined && bullet !== undefined) {
    // A checked item continues as an unchecked one; carrying the tick over
    // would silently mark the next step done.
    next = `${indent}${bullet} [ ] `;
  } else if (number !== undefined) {
    next = `${indent}${String(Number(number) + 1)}${match[6] ?? "."} `;
  } else if (bullet !== undefined) {
    next = `${indent}${bullet} `;
  } else if (quote !== undefined) {
    next = `${indent}> `;
  } else {
    return null;
  }

  const insert = `\n${next}`;
  const cursor = position + insert.length;

  return replace(text, position, position, insert, {
    from: cursor,
    to: cursor,
  });
}

/** Blocks offered by the toolbar and the insert menu. */
export const BLOCK_SNIPPETS = {
  table: [
    "| Parameter | Value | Notes |",
    "| --- | --- | --- |",
    "|  |  |  |",
    "|  |  |  |",
  ].join("\n"),
  chart: [
    "```chart",
    "{",
    '  "title": "Findings by severity",',
    '  "unit": "findings",',
    '  "data": [',
    '    { "label": "Critical", "value": 2 },',
    '    { "label": "High", "value": 5 },',
    '    { "label": "Medium", "value": 3 }',
    "  ]",
    "}",
    "```",
  ].join("\n"),
  diagram: [
    "```mermaid",
    "graph LR;",
    "  Attacker-->|request| Endpoint;",
    "  Endpoint-->Database;",
    "```",
  ].join("\n"),
  sequence: [
    "```mermaid",
    "sequenceDiagram",
    "  Attacker->>Server: POST /session",
    "  Server-->>Attacker: 200 with victim's token",
    "```",
  ].join("\n"),
  code: [
    "```http",
    "POST /api/v1/export HTTP/1.1",
    "Host: target.example",
    "```",
  ].join("\n"),
  callout: "> [!WARNING]\n> ",
  quote: "> ",
  footnote: "Claim[^1]\n\n[^1]: Source.",
  math: "$$\n\\text{impact} = f(x)\n$$",
} as const;
