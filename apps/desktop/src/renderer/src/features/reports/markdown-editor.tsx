import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useEffect, useRef } from "react";

/**
 * The Markdown editor.
 *
 * CodeMirror, configured deliberately plainly: Markdown is the canonical form
 * of a report, and an editor that reformats or autocompletes it would be
 * editing the document behind the researcher's back.
 *
 * State is local to the section being edited. Keeping every section's text in
 * a shared store would re-render the whole report on each keystroke.
 */

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  className?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  readOnly = false,
  className,
}: MarkdownEditorProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);

  onChangeRef.current = onChange;

  useEffect(() => {
    if (hostRef.current === null) {
      return;
    }

    const extensions: Extension[] = [
      lineNumbers(),
      history(),
      drawSelection(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      markdown(),
      EditorView.lineWrapping,
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
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
  }, [readOnly]);

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
}

/** Inserts a CodeVault directive at the cursor. */
export function useDirectiveInsertion(): (
  view: EditorView | null,
  directive: string,
) => void {
  return (view, directive) => {
    if (view === null) {
      return;
    }

    const { from, to } = view.state.selection.main;

    view.dispatch({
      changes: { from, to, insert: directive },
      selection: { anchor: from + directive.length },
    });

    view.focus();
  };
}
