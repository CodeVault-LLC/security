import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readDraft, writeDraft } from "./drafts.js";
import { MarkdownField } from "./markdown-field.js";

/**
 * The Markdown field.
 *
 * CodeMirror does not lay out under jsdom, so these exercise the parts around
 * it: the mode switch, the preview, autosave, and draft recovery. The editing
 * commands themselves are covered as pure functions in `commands.test.tsx`.
 */

function renderField(props: Partial<Parameters<typeof MarkdownField>[0]> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <MarkdownField value="" draftKey="test:field" {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("preview", () => {
  it("renders the value as Markdown when the preview tab is chosen", async () => {
    const user = userEvent.setup();

    renderField({ value: "## Attack path\n\n| a | b |\n| - | - |\n| 1 | 2 |" });

    await user.click(screen.getByRole("button", { name: "preview" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Attack path" })).toBeTruthy();
    });

    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("says so when there is nothing to preview", async () => {
    const user = userEvent.setup();

    renderField({ value: "" });
    await user.click(screen.getByRole("button", { name: "preview" }));

    expect(screen.getByText("Nothing to preview yet.")).toBeTruthy();
  });

  it("renders a callout as a labelled panel", async () => {
    const user = userEvent.setup();

    renderField({ value: "> [!CAUTION]\n> Destructive." });
    await user.click(screen.getByRole("button", { name: "preview" }));

    await waitFor(() => {
      expect(screen.getByText("Caution")).toBeTruthy();
    });
  });
});

describe("counts", () => {
  it("reports words and characters", () => {
    renderField({ value: "three words here" });

    expect(screen.getByText("3 words · 16 characters")).toBeTruthy();
  });

  it("counts an empty field as no words", () => {
    renderField({ value: "" });

    expect(screen.getByText("0 words · 0 characters")).toBeTruthy();
  });
});

describe("draft recovery", () => {
  /**
   * The draft is offered, never applied. The stored value may have moved on —
   * an accepted AI proposal, an edit from another window — and only the author
   * knows which of the two they want.
   */
  it("offers a recovered draft rather than applying it", async () => {
    writeDraft("test:field", "text I was in the middle of");

    renderField({ value: "what the server has" });

    expect(
      screen.getByText(/unsaved draft of this field was recovered/i),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restore" })).toBeTruthy();
  });

  it("does not offer a draft that matches the stored value", () => {
    writeDraft("test:field", "identical");

    renderField({ value: "identical" });

    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  });

  it("forgets the draft when it is discarded", async () => {
    const user = userEvent.setup();

    writeDraft("test:field", "stale");
    renderField({ value: "current" });

    await user.click(screen.getByRole("button", { name: "Discard" }));

    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
    expect(readDraft("test:field")).toBeNull();
  });

  it("restores the draft into the field when asked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    writeDraft("test:field", "recovered text");
    renderField({ value: "current", onChange });

    await user.click(screen.getByRole("button", { name: "Restore" }));

    expect(onChange).toHaveBeenCalledWith("recovered text");
  });
});

/**
 * Autosave, driven through draft recovery.
 *
 * CodeMirror will not accept typing under jsdom, so the change is made the one
 * other way the component allows — restoring a recovered draft — which goes
 * through exactly the same path an edit does.
 */
describe("autosave", () => {
  it("saves after a change, once the delay has passed", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    writeDraft("test:field", "the recovered paragraph");
    renderField({ value: "stored", onSave, autosaveMs: 50 });

    await user.click(screen.getByRole("button", { name: "Restore" }));

    expect(onSave).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("the recovered paragraph");
    });
  });

  it("reports the field as saved afterwards", async () => {
    const user = userEvent.setup();

    writeDraft("test:field", "recovered");
    renderField({ value: "stored", onSave: vi.fn(), autosaveMs: 50 });

    await user.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(screen.getByText("Saved")).toBeTruthy();
    });
  });

  /**
   * Once saved, the local copy is redundant. Leaving it behind means the next
   * visit offers to "recover" text that is already stored.
   */
  it("clears the local draft once it has been saved", async () => {
    const user = userEvent.setup();

    writeDraft("test:field", "recovered");
    renderField({ value: "stored", onSave: vi.fn(), autosaveMs: 50 });

    await user.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(readDraft("test:field")).toBeNull();
    });
  });

  it("does nothing without an onSave", async () => {
    const user = userEvent.setup();

    writeDraft("test:field", "recovered");
    renderField({ value: "stored", autosaveMs: 50 });

    await user.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(screen.queryByText("Saving…")).toBeNull();
    });

    expect(screen.getByText("Unsaved")).toBeTruthy();
  });

  it("does not autosave a read-only field", () => {
    vi.useFakeTimers();

    const onSave = vi.fn();

    renderField({ value: "text", onSave, readOnly: true });
    vi.advanceTimersByTime(5_000);

    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("read-only", () => {
  it("hides the formatting toolbar", () => {
    renderField({ value: "text", readOnly: true });

    expect(screen.queryByRole("button", { name: "Bold" })).toBeNull();
  });

  it("still allows previewing", async () => {
    const user = userEvent.setup();

    renderField({ value: "**bold**", readOnly: true });
    await user.click(screen.getByRole("button", { name: "preview" }));

    await waitFor(() => {
      expect(screen.getByText("bold")).toBeTruthy();
    });
  });
});

describe("toolbar", () => {
  it("offers the formatting actions a writer reaches for", () => {
    renderField({ value: "" });

    for (const label of ["Bold", "Italic", "Link", "Table", "Insert"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("opens the insert menu", async () => {
    const user = userEvent.setup();

    renderField({ value: "" });
    await user.click(screen.getByRole("button", { name: "Insert" }));

    expect(screen.getByLabelText(/search things to insert/i)).toBeTruthy();
    expect(screen.getByText("Flowchart")).toBeTruthy();
    expect(screen.getByText("Table")).toBeTruthy();
  });
});
