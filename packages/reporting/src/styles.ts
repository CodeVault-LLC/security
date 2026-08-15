/**
 * Report print stylesheet.
 *
 * Written for paged media: A4 by default, running TLP markings in the page
 * margins, code blocks that wrap instead of clipping, and tables that stay
 * readable when a row spans a page break. Kept as a string so the PDF worker
 * has no filesystem dependency and no chance of loading a remote stylesheet.
 */

export const REPORT_STYLESHEET = `
@page {
  size: A4;
  margin: 22mm 18mm 20mm 18mm;

  @top-left {
    content: var(--cv-tlp-marking);
    font-family: "DejaVu Sans Mono", "Liberation Mono", monospace;
    font-size: 8pt;
    letter-spacing: 0.08em;
    color: #b42318;
  }

  @top-right {
    content: var(--cv-report-reference);
    font-family: "DejaVu Sans Mono", "Liberation Mono", monospace;
    font-size: 8pt;
    color: #667085;
  }

  @bottom-left {
    content: "CodeVault";
    font-size: 8pt;
    color: #667085;
  }

  @bottom-right {
    content: "Page " counter(page) " of " counter(pages);
    font-size: 8pt;
    color: #667085;
  }
}

@page :first {
  @top-left { content: none; }
  @top-right { content: none; }
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: "DejaVu Sans", "Liberation Sans", system-ui, sans-serif;
  font-size: 10.5pt;
  line-height: 1.55;
  color: #101828;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.cv-mono,
code,
pre {
  font-family: "DejaVu Sans Mono", "Liberation Mono", monospace;
}

/* --- Cover ------------------------------------------------------------- */

.cv-cover {
  break-after: page;
  padding-top: 24mm;
}

.cv-cover-mark {
  display: flex;
  align-items: baseline;
  gap: 10px;
  border-bottom: 2px solid #101828;
  padding-bottom: 8px;
  margin-bottom: 28mm;
}

.cv-brand {
  font-size: 15pt;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.cv-audience {
  font-family: "DejaVu Sans Mono", monospace;
  font-size: 8.5pt;
  letter-spacing: 0.14em;
  color: #667085;
}

.cv-cover-title {
  font-size: 26pt;
  line-height: 1.2;
  font-weight: 700;
  margin: 0 0 16mm 0;
  max-width: 90%;
}

.cv-cover-meta {
  margin: 0 0 14mm 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6mm 10mm;
}

.cv-cover-meta div {
  border-top: 1px solid #e4e7ec;
  padding-top: 4px;
}

.cv-cover-meta dt {
  font-size: 8pt;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #667085;
  margin-bottom: 2px;
}

.cv-cover-meta dd {
  margin: 0;
  font-size: 11pt;
}

/* TLP is never signalled by colour alone: the label text and the sharing rule
   are always present, which is what a photocopy or a colour-blind reader gets. */
.cv-cover-tlp {
  border: 1.5px solid #101828;
  border-left-width: 6px;
  padding: 10px 14px;
}

.cv-tlp-label {
  display: block;
  font-family: "DejaVu Sans Mono", monospace;
  font-weight: 700;
  font-size: 11pt;
  letter-spacing: 0.06em;
}

.cv-tlp-rule {
  display: block;
  font-size: 9pt;
  color: #344054;
  margin-top: 3px;
}

.cv-tlp-red { border-color: #b42318; }
.cv-tlp-amber-strict,
.cv-tlp-amber { border-color: #b54708; }
.cv-tlp-green { border-color: #027a48; }
.cv-tlp-clear { border-color: #475467; }

.cv-cover-notice {
  margin-top: 8mm;
  font-size: 9.5pt;
  padding: 8px 12px;
  border: 1px dashed #b42318;
  color: #b42318;
}

/* --- Contents ---------------------------------------------------------- */

.cv-toc {
  break-after: page;
}

.cv-toc h2 {
  font-size: 13pt;
  border-bottom: 1px solid #e4e7ec;
  padding-bottom: 6px;
}

.cv-toc ol {
  padding-left: 18px;
}

.cv-toc li {
  margin: 4px 0;
}

.cv-toc a {
  color: #101828;
  text-decoration: none;
}

/* --- Sections ---------------------------------------------------------- */

.cv-section {
  break-inside: auto;
  margin-bottom: 10mm;
}

.cv-section h2 {
  font-size: 14pt;
  margin: 0 0 6px 0;
  padding-bottom: 5px;
  border-bottom: 1px solid #d0d5dd;
  break-after: avoid;
}

.cv-section h3 {
  font-size: 11.5pt;
  margin: 14px 0 4px;
  break-after: avoid;
}

.cv-section h4 {
  font-size: 10.5pt;
  margin: 12px 0 4px;
  color: #344054;
  break-after: avoid;
}

p {
  margin: 0 0 9px 0;
  orphans: 3;
  widows: 3;
}

a {
  color: #175cd3;
  word-break: break-word;
}

/* Code wraps rather than clipping: a truncated payload in a printed report is
   worse than an ugly line break. */
pre {
  background: #f9fafb;
  border: 1px solid #e4e7ec;
  border-left: 3px solid #98a2b3;
  padding: 9px 11px;
  font-size: 8.5pt;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  break-inside: avoid;
}

code {
  font-size: 9pt;
  background: #f2f4f7;
  padding: 0.5px 3px;
  border-radius: 2px;
}

pre code {
  background: none;
  padding: 0;
}

blockquote {
  margin: 0 0 9px 0;
  padding: 2px 12px;
  border-left: 3px solid #d0d5dd;
  color: #344054;
}

ul, ol {
  margin: 0 0 9px 0;
  padding-left: 20px;
}

li {
  margin: 2px 0;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 9pt;
  margin: 0 0 10px 0;
  break-inside: auto;
}

thead {
  display: table-header-group;
}

th, td {
  border: 1px solid #d0d5dd;
  padding: 5px 7px;
  text-align: left;
  vertical-align: top;
  word-break: break-word;
}

th {
  background: #f9fafb;
  font-weight: 600;
}

tr {
  break-inside: avoid;
}

hr {
  border: none;
  border-top: 1px solid #e4e7ec;
  margin: 14px 0;
}

/* --- Resolved directives ----------------------------------------------- */

.cv-evidence {
  border: 1px solid #d0d5dd;
  padding: 8px 11px;
  margin: 0 0 10px 0;
  break-inside: avoid;
}

.cv-evidence-title {
  font-weight: 600;
  font-size: 9.5pt;
}

.cv-evidence-meta {
  font-family: "DejaVu Sans Mono", monospace;
  font-size: 8pt;
  color: #667085;
  word-break: break-all;
}

.cv-caption {
  font-size: 8.5pt;
  color: #667085;
  margin-top: 3px;
}

.cv-inline-ref {
  font-family: "DejaVu Sans Mono", monospace;
  font-size: 9pt;
  background: #f2f4f7;
  border: 1px solid #e4e7ec;
  padding: 0 4px;
  border-radius: 2px;
}

.cv-score {
  border: 1px solid #d0d5dd;
  padding: 8px 11px;
  margin: 0 0 10px 0;
  break-inside: avoid;
}

.cv-score-value {
  font-weight: 700;
  font-size: 12pt;
}

.cv-score-vector {
  font-family: "DejaVu Sans Mono", monospace;
  font-size: 8.5pt;
  word-break: break-all;
  color: #344054;
}

.cv-timeline {
  border-collapse: collapse;
  width: 100%;
  font-size: 9pt;
}

.cv-timeline td {
  border: none;
  border-bottom: 1px solid #e4e7ec;
  padding: 5px 8px 5px 0;
}

.cv-timeline-date {
  font-family: "DejaVu Sans Mono", monospace;
  white-space: nowrap;
  width: 26mm;
  color: #344054;
}

.cv-directive-error {
  display: inline-block;
  border: 1px solid #b42318;
  color: #b42318;
  background: #fef3f2;
  font-family: "DejaVu Sans Mono", monospace;
  font-size: 8.5pt;
  padding: 1px 5px;
}
`;
