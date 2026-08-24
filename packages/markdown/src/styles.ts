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
  background: var(--cvm-callout-surface, var(--cvm-surface));
  padding: var(--cvm-callout-padding);
  margin: 0 0 var(--cvm-block-gap) 0;
  border-radius: var(--cvm-radius, 4px);
  break-inside: avoid;
}

.cv-callout > :last-child {
  margin-bottom: 0;
}

/* The kind is stated in words. A reader printing in greyscale, or one who
   cannot distinguish the accent colours, still gets the severity. */
.cv-callout-label {
  display: flex;
  align-items: center;
  gap: 7px;
  font-weight: 600;
  font-size: var(--cvm-label-size);
  letter-spacing: 0.055em;
  text-transform: uppercase;
  color: var(--cvm-callout-accent, var(--cvm-text-muted));
  margin: 0 0 5px 0;
}

.cv-callout-label::before {
  width: 6px;
  height: 6px;
  border-radius: 2px;
  background: currentColor;
  content: "";
  flex: 0 0 auto;
}

.cv-callout-note { --cvm-callout-accent: var(--cvm-info); }
.cv-callout-tip { --cvm-callout-accent: var(--cvm-success); }
.cv-callout-important { --cvm-callout-accent: var(--cvm-accent); }
.cv-callout-warning { --cvm-callout-accent: var(--cvm-warning); }
.cv-callout-caution { --cvm-callout-accent: var(--cvm-danger); }

/* --- Diagrams ---------------------------------------------------------- */

.cv-diagram {
  margin: 0 0 var(--cvm-block-gap) 0;
  padding: var(--cvm-diagram-padding, 0);
  border: var(--cvm-diagram-border, 0);
  border-radius: var(--cvm-radius, 4px);
  background: var(--cvm-diagram-surface, transparent);
  text-align: center;
  break-inside: avoid;
  overflow-x: auto;
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

/* --- Structured data charts ------------------------------------------- */

.cv-data-chart {
  margin: 0 0 var(--cvm-block-gap) 0;
  padding: var(--cvm-chart-padding);
  border: 1px solid var(--cvm-border);
  border-radius: var(--cvm-radius, 4px);
  background: var(--cvm-chart-surface, var(--cvm-surface));
  break-inside: avoid;
}

.cv-data-chart-title {
  margin: 0 0 var(--cvm-chart-title-gap) 0;
  color: var(--cvm-text);
  font-size: var(--cvm-chart-title-size);
  font-weight: 650;
  line-height: 1.3;
  text-align: left;
}

.cv-data-chart-plot {
  display: grid;
  gap: var(--cvm-chart-row-gap);
}

.cv-data-chart-row {
  display: grid;
  grid-template-columns: minmax(74px, 0.8fr) minmax(120px, 2fr) minmax(64px, auto);
  align-items: center;
  gap: var(--cvm-chart-column-gap);
  min-width: 0;
}

.cv-data-chart-label {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--cvm-text-muted);
  font-size: var(--cvm-label-size);
  text-align: right;
}

.cv-data-chart-track {
  display: block;
  height: var(--cvm-chart-bar-height);
  overflow: hidden;
  border-radius: 2px;
  background: var(--cvm-chart-track);
}

.cv-data-chart-fill {
  display: block;
  width: var(--cv-data-ratio);
  height: 100%;
  border-radius: inherit;
  background: var(--cvm-chart-accent);
}

.cv-data-chart-fill--visible {
  min-width: 2px;
}

.cv-data-chart-value {
  color: var(--cvm-text);
  font-family: var(--cvm-mono);
  font-size: var(--cvm-label-size);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.cv-data-chart-error {
  margin: 0 0 6px 0;
  color: var(--cvm-danger);
  font-size: var(--cvm-label-size);
  text-align: left;
}

.cv-data-chart-source {
  margin: 0;
  text-align: left;
}

@media (max-width: 480px) {
  .cv-data-chart-row {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.35em 0.7em;
  }

  .cv-data-chart-label {
    text-align: left;
  }

  .cv-data-chart-track {
    grid-column: 1 / -1;
    grid-row: 2;
  }
}

/* --- Task lists -------------------------------------------------------- */

.contains-task-list,
ul:has(> li > input[type="checkbox"]) {
  list-style: none;
  padding-left: 2px;
}

li > input[type="checkbox"] {
  width: 1em;
  height: 1em;
  margin: 0 0.5em 0 0;
  accent-color: var(--cvm-accent);
  vertical-align: -0.1em;
}

/* --- Footnotes --------------------------------------------------------- */

.cv-footnotes {
  border-top: 1px solid var(--cvm-border);
  margin-top: calc(var(--cvm-block-gap) * 2);
  padding-top: var(--cvm-block-gap);
  font-size: var(--cvm-label-size);
  color: var(--cvm-text-muted);
}

.cv-footnotes h2 {
  font-size: var(--cvm-label-size);
  letter-spacing: 0.055em;
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
  --cvm-text: #101828;
  --cvm-text-muted: #667085;
  --cvm-mono: "DejaVu Sans Mono", "Liberation Mono", monospace;
  --cvm-accent: #175cd3;
  --cvm-danger: #b42318;
  --cvm-warning: #b54708;
  --cvm-success: #027a48;
  --cvm-info: #175cd3;
  --cvm-block-gap: 10px;
  --cvm-callout-padding: 8px 11px;
  --cvm-radius: 4px;
  --cvm-label-size: 8.5pt;
  --cvm-chart-surface: #ffffff;
  --cvm-chart-track: #eaecf0;
  --cvm-chart-accent: #175cd3;
  --cvm-chart-padding: 11px 13px;
  --cvm-chart-title-gap: 9px;
  --cvm-chart-title-size: 10pt;
  --cvm-chart-row-gap: 6px;
  --cvm-chart-column-gap: 8px;
  --cvm-chart-bar-height: 9px;
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
  --cvm-text: var(--cv-text);
  --cvm-text-muted: var(--cv-text-muted);
  --cvm-mono: var(--font-mono);
  --cvm-accent: var(--cv-accent);
  --cvm-danger: var(--cv-danger);
  --cvm-warning: var(--cv-warning);
  --cvm-success: var(--cv-success);
  --cvm-info: var(--cv-accent);
  --cvm-block-gap: 0.75em;
  --cvm-callout-padding: 0.85em 1em;
  --cvm-radius: var(--cv-radius-lg);
  --cvm-diagram-border: 1px solid var(--cv-border);
  --cvm-diagram-padding: 1.25em;
  --cvm-diagram-surface: var(--cv-surface-raised);
  --cvm-label-size: 0.78em;
  --cvm-chart-surface: var(--cv-surface);
  --cvm-chart-track: var(--cv-surface-hover);
  --cvm-chart-accent: var(--cv-accent);
  --cvm-chart-padding: 1.1em 1.2em;
  --cvm-chart-title-gap: 0.85em;
  --cvm-chart-title-size: 0.96em;
  --cvm-chart-row-gap: 0.6em;
  --cvm-chart-column-gap: 0.8em;
  --cvm-chart-bar-height: 0.65em;
  --cvm-tok-comment: var(--cv-text-muted);
  --cvm-tok-keyword: var(--cv-accent);
  --cvm-tok-string: var(--cv-success);
  --cvm-tok-number: var(--cv-warning);
  --cvm-tok-title: var(--cv-accent);
  --cvm-tok-attr: var(--cv-danger);
}
`;
