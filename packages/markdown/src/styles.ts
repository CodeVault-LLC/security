/**
 * Markdown feature stylesheet.
 *
 * One set of rules for callouts, diagrams, footnotes, task lists, syntax
 * highlighting and maths, shared by the desktop preview and the printed
 * report. They differ in palette and in units, not in structure, so the rules
 * are written once against `--cvm-*` variables and each consumer supplies a
 * theme block below.
 *
 * The point is that a researcher previewing a finding is looking at the same
 * layout the vendor will receive. Two hand-maintained copies drift, and the
 * first anyone hears about it is a malformed PDF.
 */

export const MARKDOWN_STYLESHEET = `
/* --- Callouts ---------------------------------------------------------- */

.cv-callout {
  border: 1px solid var(--cvm-border);
  border-left: 3px solid var(--cvm-callout-accent, var(--cvm-border-strong));
  background: var(--cvm-callout-surface, var(--cvm-surface));
  padding: var(--cvm-callout-padding);
  margin: 0 0 var(--cvm-block-gap) 0;
  break-inside: avoid;
}

.cv-callout > :last-child {
  margin-bottom: 0;
}

/* The kind is stated in words. A reader printing in greyscale, or one who
   cannot distinguish the accent colours, still gets the severity. */
.cv-callout-label {
  font-weight: 600;
  font-size: var(--cvm-label-size);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--cvm-callout-accent, var(--cvm-text-muted));
  margin: 0 0 3px 0;
}

.cv-callout-note { --cvm-callout-accent: var(--cvm-info); }
.cv-callout-tip { --cvm-callout-accent: var(--cvm-success); }
.cv-callout-important { --cvm-callout-accent: var(--cvm-accent); }
.cv-callout-warning { --cvm-callout-accent: var(--cvm-warning); }
.cv-callout-caution { --cvm-callout-accent: var(--cvm-danger); }

/* --- Diagrams ---------------------------------------------------------- */

.cv-diagram {
  margin: 0 0 var(--cvm-block-gap) 0;
  text-align: center;
  break-inside: avoid;
}

.cv-diagram svg {
  max-width: 100%;
  height: auto;
}

/* Shown only until hydration replaces it, and left in place when a diagram
   fails to parse, so the source is never lost behind an empty frame. */
.cv-diagram-source {
  text-align: left;
}

.cv-diagram-error {
  color: var(--cvm-danger);
  font-size: var(--cvm-label-size);
  margin: 4px 0 0 0;
  text-align: left;
}

/* --- Task lists -------------------------------------------------------- */

.contains-task-list,
ul:has(> li > input[type="checkbox"]) {
  list-style: none;
  padding-left: 2px;
}

li > input[type="checkbox"] {
  margin-right: 6px;
  vertical-align: middle;
}

/* --- Footnotes --------------------------------------------------------- */

.cv-footnotes {
  border-top: 1px solid var(--cvm-border);
  margin-top: var(--cvm-block-gap);
  padding-top: 6px;
  font-size: var(--cvm-label-size);
  color: var(--cvm-text-muted);
}

.cv-footnotes h2 {
  font-size: var(--cvm-label-size);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

sup a {
  text-decoration: none;
}

/* --- Maths ------------------------------------------------------------- */

/* Rendered as MathML, which the browser lays out with the document's own
   fonts. Nothing here loads one. */
math {
  font-size: 1.05em;
}

.katex-error {
  color: var(--cvm-danger);
  font-family: var(--cvm-mono);
}

/* --- Syntax highlighting ----------------------------------------------- */

.hljs-comment,
.hljs-quote {
  color: var(--cvm-tok-comment);
  font-style: italic;
}

.hljs-keyword,
.hljs-selector-tag,
.hljs-literal,
.hljs-doctag,
.hljs-name,
.hljs-tag {
  color: var(--cvm-tok-keyword);
}

.hljs-string,
.hljs-regexp,
.hljs-addition,
.hljs-bullet {
  color: var(--cvm-tok-string);
}

.hljs-number,
.hljs-symbol,
.hljs-meta,
.hljs-link {
  color: var(--cvm-tok-number);
}

.hljs-title,
.hljs-section,
.hljs-built_in,
.hljs-class .hljs-title,
.hljs-type {
  color: var(--cvm-tok-title);
}

.hljs-attr,
.hljs-attribute,
.hljs-variable,
.hljs-template-variable,
.hljs-property,
.hljs-params {
  color: var(--cvm-tok-attr);
}

.hljs-deletion {
  color: var(--cvm-danger);
}

.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: 600; }
`;

/**
 * Print theme.
 *
 * Point sizes and fixed colours: the PDF is rendered by a Chromium that never
 * sees the application's design tokens, and a report must print identically
 * on a machine that has none of them.
 */
export const MARKDOWN_PRINT_THEME = `
:root {
  --cvm-border: #d0d5dd;
  --cvm-border-strong: #98a2b3;
  --cvm-surface: #f9fafb;
  --cvm-text-muted: #667085;
  --cvm-mono: "DejaVu Sans Mono", "Liberation Mono", monospace;
  --cvm-accent: #175cd3;
  --cvm-danger: #b42318;
  --cvm-warning: #b54708;
  --cvm-success: #027a48;
  --cvm-info: #175cd3;
  --cvm-block-gap: 10px;
  --cvm-callout-padding: 8px 11px;
  --cvm-label-size: 8.5pt;
  --cvm-tok-comment: #667085;
  --cvm-tok-keyword: #6941c6;
  --cvm-tok-string: #027a48;
  --cvm-tok-number: #b54708;
  --cvm-tok-title: #175cd3;
  --cvm-tok-attr: #c11574;
}
`;

/**
 * Screen theme.
 *
 * Bound to the application's own tokens, so the preview follows the app's
 * light and dark themes rather than pretending to be paper.
 */
export const MARKDOWN_SCREEN_THEME = `
.cv-preview {
  --cvm-border: var(--cv-border);
  --cvm-border-strong: var(--cv-border-strong);
  --cvm-surface: var(--cv-surface-raised);
  --cvm-text-muted: var(--cv-text-muted);
  --cvm-mono: var(--font-mono);
  --cvm-accent: var(--cv-accent);
  --cvm-danger: var(--cv-danger);
  --cvm-warning: var(--cv-warning);
  --cvm-success: var(--cv-success);
  --cvm-info: var(--cv-accent);
  --cvm-block-gap: 0.75em;
  --cvm-callout-padding: 7px 10px;
  --cvm-label-size: 10.5px;
  --cvm-tok-comment: var(--cv-text-muted);
  --cvm-tok-keyword: var(--cv-accent);
  --cvm-tok-string: var(--cv-success);
  --cvm-tok-number: var(--cv-warning);
  --cvm-tok-title: var(--cv-accent);
  --cvm-tok-attr: var(--cv-danger);
}
`;
