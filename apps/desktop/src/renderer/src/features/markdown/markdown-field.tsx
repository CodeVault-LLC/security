import { Button } from "@codevault/ui";
import { Maximize2, Minimize2, Pilcrow } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Command } from "./commands.js";
import { clearDraft, readDraft, writeDraft } from "./drafts.js";
import { InsertMenu } from "./insert-menu.js";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "./markdown-editor.js";
import { MarkdownPreview } from "./markdown-preview.js";
import { MarkdownToolbar } from "./markdown-toolbar.js";

/**
 * A Markdown field.
 *
 * The unit every place that stores Markdown uses: an editor with a toolbar, a
 * preview of exactly what the report will show, autosave, and a local draft in
 * case something goes wrong. It exists so that writing up a finding is one
 * consistent experience rather than eight text areas with different rules.
 */

export interface MarkdownFieldProps {
  /** Accessible name for the CodeMirror textbox. */
  ariaLabel: string;
  /** The stored value. Changes to it are adopted unless there is a draft. */
  value: string;
  onSave?: (value: string) => void;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  /** Stable key for local draft recovery, e.g. `finding:<id>:impact`. */
  draftKey: string;
  /** Enables directive insertion for a case's own records. */
  caseId?: string | undefined;
  placeholder?: string;
  /** Editor height when not in focus mode. */
  minHeight?: string;
  /** Fill the height supplied by the parent workspace. */
  fill?: boolean;
  showLineNumbers?: boolean;
  /** Debounced autosave, off when there is no `onSave`. */
  autosaveMs?: number;
  /** Set while the parent's save is in flight. */
  saving?: boolean;
  /** Current save error, shown until the next edit. */
  error?: string | null;
}

type Mode = "write" | "preview";

export function MarkdownField({
  ariaLabel,
  value,
  onSave,
  onChange,
  readOnly = false,
  draftKey,
  caseId,
  placeholder = "Markdown. Tables, diagrams and callouts all render in the report.",
  minHeight = "18rem",
  fill = false,
  showLineNumbers = false,
  autosaveMs = 1_200,
  saving = false,
  error = null,
}: MarkdownFieldProps): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const [mode, setMode] = useState<Mode>("write");
  const [menuOpen, setMenuOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [showFormatting, setShowFormatting] = useState(false);
  // Read while initialising rather than in an effect: the banner is part of
  // the field's first paint, and setting it afterwards renders the page twice.
  const [recovered, setRecovered] = useState<string | null>(() => {
    const stored = readDraft(draftKey);

    return stored !== null && stored.text !== value ? stored.text : null;
  });
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const onSaveRef = useRef(onSave);
  const dirty = draft !== value;
  const dirtyRef = useRef(dirty);

  useEffect(() => {
    onSaveRef.current = onSave;
    dirtyRef.current = dirty;
  }, [onSave, dirty]);

  // A draft that matches what is stored has nothing left to recover, so it is
  // dropped rather than left to be offered on the next visit.
  useEffect(() => {
    const stored = readDraft(draftKey);

    if (stored !== null && stored.text === value) {
      clearDraft(draftKey);
    }
  }, [draftKey, value]);

  /**
   * Adopts a new stored value — an accepted AI proposal, a save landing —
   * unless there are local edits, which would be lost by taking it.
   */
  useEffect(() => {
    if (!dirtyRef.current) {
      setDraft(value);
    }
  }, [value]);

  const save = useCallback((text: string): void => {
    onSaveRef.current?.(text);
  }, []);

  useEffect(() => {
    if (!dirty || readOnly || onSave === undefined) {
      return;
    }

    const timer = setTimeout(() => save(draft), autosaveMs);

    return () => clearTimeout(timer);
  }, [draft, dirty, readOnly, autosaveMs, onSave, save]);

  const edit = (next: string): void => {
    setDraft(next);
    onChange?.(next);

    if (!readOnly) {
      writeDraft(draftKey, next);
    }
  };

  const runCommand = (command: Command): void => {
    setMode("write");
    editorRef.current?.run(command);
  };

  const insert = (snippet: string): void => {
    editorRef.current?.dropSlash();
    editorRef.current?.insert(snippet);
  };

  const status = readOnly
    ? null
    : error !== null
      ? { tone: "text-danger", text: error }
      : saving
        ? { tone: "text-text-muted", text: "Saving…" }
        : dirty
          ? { tone: "text-text-muted", text: "Edited" }
          : null;

  const body = (
    <div
      className={`flex min-h-0 flex-col rounded-(--cv-radius) border border-border bg-surface ${
        focusMode ? "h-full" : fill ? "flex-1 rounded-none border-0" : ""
      } focus-within:border-focus focus-within:ring-1 focus-within:ring-focus/30`}
    >
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        {(["write", "preview"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setMode(item)}
            aria-pressed={mode === item}
            className={`min-h-10 rounded-(--cv-radius) px-3 text-[11px] capitalize focus-visible:outline-2 focus-visible:outline-focus ${
              mode === item
                ? "bg-surface-hover text-text"
                : "text-text-muted hover:text-text"
            }`}
          >
            {item}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          {status === null ? null : (
            <span className={`text-[11px] ${status.tone}`}>{status.text}</span>
          )}
          {readOnly ? null : (
            <button
              type="button"
              disabled={mode === "preview"}
              aria-pressed={showFormatting}
              onClick={() => setShowFormatting((current) => !current)}
              className={`flex min-h-10 items-center gap-1.5 rounded-(--cv-radius) px-2.5 text-[11px] focus-visible:outline-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-40 ${
                showFormatting
                  ? "bg-surface-hover text-text"
                  : "text-text-muted hover:text-text"
              }`}
            >
              <Pilcrow aria-hidden className="size-3.5" />
              Format
            </button>
          )}
          {readOnly ? null : (
            <button
              type="button"
              onClick={() => setFocusMode((current) => !current)}
              title={focusMode ? "Leave focus mode (Esc)" : "Focus mode"}
              aria-label={focusMode ? "Leave focus mode" : "Focus mode"}
              className="flex size-10 items-center justify-center rounded-(--cv-radius) text-text-muted hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-focus"
            >
              {focusMode ? (
                <Minimize2 aria-hidden className="size-3.5" />
              ) : (
                <Maximize2 aria-hidden className="size-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      {readOnly || !showFormatting || mode === "preview" ? null : (
        <MarkdownToolbar
          onCommand={runCommand}
          onInsertMenu={() => setMenuOpen(true)}
        />
      )}

      {recovered === null ? null : (
        <div className="flex flex-wrap items-center gap-2 border-b border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px]">
          <span className="flex-1">
            An unsaved draft of this field was recovered from this machine.
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              edit(recovered);
              setRecovered(null);
            }}
          >
            Restore
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              clearDraft(draftKey);
              setRecovered(null);
            }}
          >
            Discard
          </Button>
        </div>
      )}

      <div
        className={
          focusMode || fill ? "min-h-0 flex-1 overflow-auto" : "overflow-auto"
        }
        // A fixed height rather than a minimum: the editor scrolls internally,
        // so a long attack path does not push the rest of the page away.
        style={focusMode || fill ? undefined : { height: minHeight }}
      >
        {mode === "write" ? (
          <MarkdownEditor
            ref={editorRef}
            ariaLabel={ariaLabel}
            value={draft}
            onChange={edit}
            readOnly={readOnly}
            placeholder={placeholder}
            showLineNumbers={showLineNumbers}
            onSlash={() => setMenuOpen(true)}
            className="h-full"
          />
        ) : (
          <MarkdownPreview markdown={draft} />
        )}
      </div>
    </div>
  );

  useEffect(() => {
    if (!focusMode) {
      return;
    }

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setFocusMode(false);
      }
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode]);

  // Cmd-S saves immediately. Autosave already will, but a writer who has just
  // finished a paragraph wants to be told it is safe now, not in a second.
  useEffect(() => {
    if (readOnly || onSave === undefined) {
      return;
    }

    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();

        if (dirtyRef.current) {
          save(draft);
        }
      }
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [draft, readOnly, onSave, save]);

  return (
    <>
      {focusMode ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-surface-base p-4">
          {body}
        </div>
      ) : (
        body
      )}

      <InsertMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        onInsert={insert}
        caseId={caseId}
      />
    </>
  );
}
