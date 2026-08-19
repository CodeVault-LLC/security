import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExtension,
} from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import {
  continueList,
  insertLink,
  linkOnPaste,
  toggleHeading,
  toggleInline,
  type Command,
} from "./commands.js";
import { editorTheme } from "./editor-theme.js";

/**
 * The Markdown editor.
 *
 * CodeMirror, still configured plainly: Markdown is the canonical form of a
 * finding, and an editor that reformats or autocompletes it would be editing
 * the document behind the researcher's back. What it does do is the work a
 * writer would otherwise do by hand — continuing a list, wrapping a selection,
 * turning a pasted URL into a link — and nothing else.
 *
 * State is local to the field being edited. Keeping every field's text in a
 * shared store would re-render the whole page on each keystroke.
 */

export interface MarkdownEditorHandle {
  /** Applies a pure command from `commands.ts` to the current selection. */
  run: (command: Command) => void;
  /** Replaces the selection with literal text. */
  insert: (text: string) => void;
  /** Removes the `/` immediately before the cursor, if there is one. */
  dropSlash: () => void;
  focus: () => void;
}

export interface MarkdownEditorProps {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  className?: string;
  placeholder?: string;
  /** Line numbers suit a long report section and clutter a short field. */
  showLineNumbers?: boolean;
  /** Called when `/` is typed where an insert menu would make sense. */
  onSlash?: () => void;
}

export const MarkdownEditor = forwardRef<
  MarkdownEditorHandle,
  MarkdownEditorProps
>(function MarkdownEditor(
  {
    ariaLabel,
    value,
    onChange,
    readOnly = false,
    className,
    placeholder,
    showLineNumbers = false,
    onSlash,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSlashRef = useRef(onSlash);

  // Kept in refs so the editor is not torn down and rebuilt whenever the
  // parent re-renders with new closures. Assigned in an effect rather than
  // during render, which would be a write to a ref while React is rendering.
  useEffect(() => {
    onChangeRef.current = onChange;
    onSlashRef.current = onSlash;
  }, [onChange, onSlash]);

  /** Applies a pure command to the document and moves the selection with it. */
  const runOn = (view: EditorView, command: Command): void => {
    const text = view.state.doc.toString();
    const { from, to } = view.state.selection.main;
    const result = command(text, { from, to });

    view.dispatch({
      changes: { from: 0, to: text.length, insert: result.text },
      selection: { anchor: result.selection.from, head: result.selection.to },
    });
    view.focus();
  };

  useImperativeHandle(
    ref,
    (): MarkdownEditorHandle => ({
      run: (command) => {
        const view = viewRef.current;

        if (view !== null) {
          runOn(view, command);
        }
      },
      insert: (text) => {
        const view = viewRef.current;

        if (view === null) {
          return;
        }

        const { from, to } = view.state.selection.main;

        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
        });
        view.focus();
      },
      dropSlash: () => {
        const view = viewRef.current;

        if (view === null) {
          return;
        }

        const { from } = view.state.selection.main;

        if (from > 0 && view.state.doc.sliceString(from - 1, from) === "/") {
          view.dispatch({ changes: { from: from - 1, to: from } });
        }
      },
      focus: () => viewRef.current?.focus(),
    }),
    [],
  );

  useEffect(() => {
    if (hostRef.current === null) {
      return;
    }

    /** Wraps a pure command as a CodeMirror keybinding. */
    const bind = (command: Command) => (view: EditorView) => {
      runOn(view, command);

      return true;
    };

    const extensions: Extension[] = [
      ...(showLineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
      history(),
      drawSelection(),
      highlightActiveLine(),
      markdown(),
      editorTheme,
      EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
      EditorView.lineWrapping,
      ...(placeholder === undefined ? [] : [placeholderExtension(placeholder)]),
      keymap.of([
        { key: "Mod-b", run: bind(toggleInline("**")) },
        { key: "Mod-i", run: bind(toggleInline("*")) },
        { key: "Mod-e", run: bind(toggleInline("`")) },
        { key: "Mod-k", run: bind(insertLink) },
        { key: "Mod-1", run: bind(toggleHeading(1)) },
        { key: "Mod-2", run: bind(toggleHeading(2)) },
        { key: "Mod-3", run: bind(toggleHeading(3)) },
        {
          key: "Enter",
          run: (view) => {
            const text = view.state.doc.toString();
            const result = continueList(text, view.state.selection.main.head);

            if (result === null) {
              return false;
            }

            view.dispatch({
              changes: { from: 0, to: text.length, insert: result.text },
              selection: { anchor: result.selection.from },
            });

            return true;
          },
        },
      ]),
      // Ahead of the default keymap so the bindings above win.
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.domEventHandlers({
        paste: (event, view) => {
          const pasted = event.clipboardData?.getData("text/plain") ?? "";
          const text = view.state.doc.toString();
          const { from, to } = view.state.selection.main;
          const result = linkOnPaste(text, { from, to }, pasted);

          if (result === null) {
            return false;
          }

          event.preventDefault();
          view.dispatch({
            changes: { from: 0, to: text.length, insert: result.text },
            selection: { anchor: result.selection.from },
          });

          return true;
        },
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) {
          return;
        }

        onChangeRef.current(update.state.doc.toString());

        if (onSlashRef.current === undefined) {
          return;
        }

        // A `/` opens the insert menu, but only where it starts a word.
        // Mid-word — a path, a date, a CVSS vector — it is just a character.
        update.changes.iterChanges((_fromA, _toA, fromB, toB, inserted) => {
          if (inserted.toString() !== "/") {
            return;
          }

          const before = update.state.doc.sliceString(
            Math.max(0, fromB - 1),
            fromB,
          );

          if (before === "" || before === " " || before === "\n") {
            onSlashRef.current?.();
          }

          void toB;
        });
      }),
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
    ];

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: hostRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once per mount; external value changes are applied
    // through the effect below so local typing is never interrupted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ariaLabel, readOnly, showLineNumbers, placeholder]);

  useEffect(() => {
    const view = viewRef.current;

    if (view === null) {
      return;
    }

    const current = view.state.doc.toString();

    if (current === value) {
      return;
    }

    // Only replace the document when it genuinely differs — for instance after
    // an AI proposal was accepted — so the cursor survives ordinary editing.
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  return <div ref={hostRef} className={className} />;
});
