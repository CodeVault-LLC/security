import { describe, expect, it } from "vitest";

import {
  continueList,
  insertBlock,
  insertLink,
  linkOnPaste,
  toggleHeading,
  toggleInline,
  toggleLinePrefix,
  type Selection,
} from "./commands.js";

/**
 * Editing commands.
 *
 * The cases here are the ones that make an editor feel either thoughtful or
 * broken: pressing bold twice, ending a list, pasting a link over a phrase.
 * Cursor positions are asserted as carefully as text, because a command that
 * leaves the cursor in the wrong place is one the author has to undo.
 */

/** Writes a case as `a|b` for a cursor, `a[sel]b` for a selection. */
function parse(marked: string): { text: string; selection: Selection } {
  const cursor = marked.indexOf("|");

  if (cursor !== -1) {
    return {
      text: marked.replace("|", ""),
      selection: { from: cursor, to: cursor },
    };
  }

  const from = marked.indexOf("[");
  const to = marked.indexOf("]") - 1;

  return {
    text: marked.replace("[", "").replace("]", ""),
    selection: { from, to },
  };
}

function show(text: string, selection: Selection): string {
  if (selection.from === selection.to) {
    return `${text.slice(0, selection.from)}|${text.slice(selection.from)}`;
  }

  return `${text.slice(0, selection.from)}[${text.slice(
    selection.from,
    selection.to,
  )}]${text.slice(selection.to)}`;
}

function apply(
  command: (
    text: string,
    selection: Selection,
  ) => { text: string; selection: Selection },
  marked: string,
): string {
  const { text, selection } = parse(marked);
  const result = command(text, selection);

  return show(result.text, result.selection);
}

describe("toggleInline", () => {
  const bold = toggleInline("**");

  /**
   * The words stay selected, not the markers: applying a second marker on top
   * has to nest rather than wrap the asterisks, and pressing the shortcut
   * again has to undo it.
   */
  it("wraps a selection and keeps the words selected", () => {
    expect(apply(bold, "an [urgent] fix")).toBe("an **[urgent]** fix");
    expect(apply(bold, "an **[urgent]** fix")).toBe("an [urgent] fix");
  });

  it("puts the cursor between the markers when nothing is selected", () => {
    expect(apply(bold, "an |fix")).toBe("an **|**fix");
  });

  it("unwraps a selection that includes the markers", () => {
    expect(apply(bold, "an [**urgent**] fix")).toBe("an [urgent] fix");
  });

  /**
   * Double-clicking a bold word selects the word, not the asterisks. Pressing
   * the shortcut again has to still turn it off.
   */
  it("unwraps when the markers sit just outside the selection", () => {
    expect(apply(bold, "an **[urgent]** fix")).toBe("an [urgent] fix");
  });

  it("handles a single-character marker", () => {
    expect(apply(toggleInline("`"), "the [id] parameter")).toBe(
      "the `[id]` parameter",
    );
  });
});

describe("toggleLinePrefix", () => {
  it("adds a bullet to each selected line", () => {
    expect(apply(toggleLinePrefix("- "), "[one\ntwo]")).toBe("[- one\n- two]");
  });

  it("removes bullets when every line already has one", () => {
    expect(apply(toggleLinePrefix("- "), "[- one\n- two]")).toBe("[one\ntwo]");
  });

  it("numbers an ordered list as it goes", () => {
    expect(apply(toggleLinePrefix("1. "), "[one\ntwo\nthree]")).toBe(
      "[1. one\n2. two\n3. three]",
    );
  });

  it("removes an ordered list whatever its numbers are", () => {
    expect(apply(toggleLinePrefix("1. "), "[1. one\n2. two]")).toBe(
      "[one\ntwo]",
    );
  });

  it("leaves blank lines alone", () => {
    expect(apply(toggleLinePrefix("> "), "[one\n\ntwo]")).toBe(
      "[> one\n\n> two]",
    );
  });

  it("works from a bare cursor on one line", () => {
    expect(apply(toggleLinePrefix("- "), "on|e")).toBe("[- one]");
  });
});

describe("toggleHeading", () => {
  it("adds a heading marker", () => {
    expect(apply(toggleHeading(2), "Imp|act")).toBe("[## Impact]");
  });

  it("changes an existing heading's level", () => {
    expect(apply(toggleHeading(3), "## Imp|act")).toBe("[### Impact]");
  });

  it("removes the heading when applied at its own level", () => {
    expect(apply(toggleHeading(2), "## Imp|act")).toBe("[Impact]");
  });
});

describe("insertLink", () => {
  it("keeps the selection as the label and selects the target", () => {
    expect(apply(insertLink, "see [the advisory] here")).toBe(
      "see [the advisory]([https://]) here",
    );
  });

  it("uses a selected URL as the target and waits for a label", () => {
    expect(apply(insertLink, "[https://example.test/a]")).toBe(
      "[|](https://example.test/a)",
    );
  });
});

describe("linkOnPaste", () => {
  it("links the selection instead of replacing it", () => {
    const { text, selection } = parse("see [the advisory] here");
    const result = linkOnPaste(text, selection, "https://example.test/a");

    expect(result).not.toBeNull();
    expect(result?.text).toBe(
      "see [the advisory](https://example.test/a) here",
    );
  });

  it("declines when nothing is selected", () => {
    const { text, selection } = parse("see |here");

    expect(linkOnPaste(text, selection, "https://example.test")).toBeNull();
  });

  it("declines when the paste is not a URL", () => {
    const { text, selection } = parse("see [this] here");

    expect(linkOnPaste(text, selection, "some notes")).toBeNull();
  });

  /**
   * Replacing one URL with another is a correction, not a link.
   */
  it("declines when the selection is already a URL", () => {
    const { text, selection } = parse("[https://old.example]");

    expect(linkOnPaste(text, selection, "https://new.example")).toBeNull();
  });
});

describe("continueList", () => {
  function press(marked: string): string | null {
    const { text, selection } = parse(marked);
    const result = continueList(text, selection.from);

    return result === null ? null : show(result.text, result.selection);
  }

  it("continues a bullet list", () => {
    expect(press("- one|")).toBe("- one\n- |");
  });

  it("preserves the bullet character", () => {
    expect(press("* one|")).toBe("* one\n* |");
  });

  it("increments an ordered list", () => {
    expect(press("3. three|")).toBe("3. three\n4. |");
  });

  it("preserves indentation of a nested item", () => {
    expect(press("  - one|")).toBe("  - one\n  - |");
  });

  it("continues a quote", () => {
    expect(press("> quoted|")).toBe("> quoted\n> |");
  });

  /**
   * A ticked step carries over unticked. Copying the tick would quietly mark
   * the next reproduction step as done.
   */
  it("continues a task list unchecked", () => {
    expect(press("- [x] reproduced|")).toBe("- [x] reproduced\n- [ ] |");
  });

  it("ends the list when the item is empty", () => {
    expect(press("- one\n- |")).toBe("- one\n|");
  });

  it("ends a nested list back at its indentation", () => {
    expect(press("  - |")).toBe("  |");
  });

  it("declines outside a list", () => {
    expect(press("ordinary prose|")).toBeNull();
  });
});

describe("insertBlock", () => {
  const table = insertBlock("| a |\n| - |");

  it("separates the block from the paragraph above", () => {
    const result = apply(table, "prose|");

    expect(result).toBe("prose\n\n| a |\n| - ||\n");
  });

  it("does not add blank lines that are already there", () => {
    const result = apply(table, "prose\n\n|");

    expect(result).toBe("prose\n\n| a |\n| - ||\n");
  });

  it("inserts into an empty document without leading blank lines", () => {
    expect(apply(table, "|")).toBe("| a |\n| - ||\n");
  });
});
