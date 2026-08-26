import { EditorView } from "@codemirror/view";

/**
 * The editor's appearance.
 *
 * This has to be a CodeMirror theme rather than rules in `app.css`, and the
 * reason is specificity. CodeMirror injects its base theme scoped to a
 * generated class — `.ͼ2 .cm-activeLine` — which outranks a plain
 * `.cm-activeLine` in a stylesheet no matter what order they load in. A rule
 * written the ordinary way looks correct in the source and does nothing on the
 * page.
 *
 * It also picks which base theme to apply from its own `dark` setting, not
 * from the document, so an editor left unconfigured uses the *light* palette
 * inside a dark window: a pale band across the current line, a near-white
 * gutter, a black caret that cannot be seen, and a light-grey selection.
 *
 * Every value below is a token, so one theme covers both palettes and nothing
 * has to detect, observe or re-apply when the window's theme changes.
 */
export const EDITOR_THEME_SPEC = {
  "&": {
    color: "var(--cv-text)",
    // The surrounding field owns the background; the editor sits on it.
    backgroundColor: "transparent",
    height: "100%",
  },

  "&.cm-focused": {
    // The field is what shows focus, so the editor does not draw its own ring.
    outline: "none",
  },

  // CodeMirror sets `font-family: monospace` on the scroller itself, which
  // beats anything inherited from the editor element. Without this the app's
  // mono face is never used.
  ".cm-scroller": {
    fontFamily: "var(--font-editor)",
    lineHeight: "1.618",
  },

  ".cm-content": {
    caretColor: "var(--cv-text)",
    padding: "20px 24px 34px",
  },

  ".cm-line": {
    padding: "0 4px",
  },

  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--cv-text)",
  },

  // CodeMirror hides the native selection inside its lines and paints this
  // layer instead, so without it a drag in the editor is invisible. The same
  // token the rest of the window uses, so selecting text in a finding looks
  // the same whether the cursor is in the editor or the preview beside it.
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      background: "var(--cv-selection)",
    },

  ".cm-activeLine": {
    backgroundColor: "var(--cv-surface-hover)",
  },

  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--cv-text-muted)",
    borderRight: "1px solid var(--cv-border)",
    paddingLeft: "8px",
  },

  ".cm-activeLineGutter": {
    backgroundColor: "var(--cv-surface-hover)",
  },

  ".cm-placeholder": {
    color: "var(--cv-text-muted)",
  },
};

export const editorTheme = EditorView.theme(EDITOR_THEME_SPEC);
