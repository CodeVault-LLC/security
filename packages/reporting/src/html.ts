import type { ReportAudience } from "@codevault/core";
import { TLP_DEFINITIONS, type TlpLabel } from "@codevault/standards";

import { escapeHtml } from "./markdown.js";
import { REPORT_STYLESHEET } from "./styles.js";

/**
 * Report HTML document.
 *
 * The document is entirely self-contained: styles are inlined and there are no
 * script tags, no web fonts and no remote images. A report that fetched
 * anything while being rendered would be a way to signal that an embargoed
 * document had been opened.
 */

export interface RenderedSection {
  title: string;
  html: string;
}

export interface ReportDocumentInput {
  title: string;
  reference: string;
  audience: ReportAudience;
  tlp: TlpLabel;
  caseReference: string;
  /** ISO date shown on the cover. */
  generatedAt: string;
  organisation: string;
  authorName: string;
  templateVersion: string;
  sections: readonly RenderedSection[];
  /** Extra line on the cover, e.g. an embargo notice. */
  notice?: string | null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function coverPage(input: ReportDocumentInput): string {
  const tlp = TLP_DEFINITIONS[input.tlp];
  const notice =
    input.notice === undefined || input.notice === null
      ? ""
      : `<p class="cv-cover-notice">${escapeHtml(input.notice)}</p>`;

  return `
    <section class="cv-cover">
      <div class="cv-cover-mark">
        <span class="cv-brand">CodeVault</span>
        <span class="cv-audience">${escapeHtml(input.audience)} REPORT</span>
      </div>
      <h1 class="cv-cover-title">${escapeHtml(input.title)}</h1>
      <dl class="cv-cover-meta">
        <div><dt>Report</dt><dd class="cv-mono">${escapeHtml(input.reference)}</dd></div>
        <div><dt>Case</dt><dd class="cv-mono">${escapeHtml(input.caseReference)}</dd></div>
        <div><dt>Date</dt><dd>${escapeHtml(input.generatedAt)}</dd></div>
        <div><dt>Prepared by</dt><dd>${escapeHtml(input.authorName)}</dd></div>
        <div><dt>Organisation</dt><dd>${escapeHtml(input.organisation)}</dd></div>
      </dl>
      <div class="cv-cover-tlp cv-tlp-${slugify(tlp.shortName)}">
        <span class="cv-tlp-label">${escapeHtml(tlp.label)}</span>
        <span class="cv-tlp-rule">${escapeHtml(tlp.sharingRule)}</span>
      </div>
      ${notice}
    </section>
  `;
}

function tableOfContents(sections: readonly RenderedSection[]): string {
  const entries = sections
    .map(
      (section) =>
        `<li><a href="#${slugify(section.title)}">${escapeHtml(section.title)}</a></li>`,
    )
    .join("\n");

  return `
    <section class="cv-toc">
      <h2>Contents</h2>
      <ol>${entries}</ol>
    </section>
  `;
}

/**
 * Builds the complete printable document.
 *
 * The TLP marking is repeated in the running header and footer through CSS
 * `@page` margin boxes, so the marking survives a page being printed, photo-
 * graphed or forwarded on its own.
 */
export function buildReportHtml(input: ReportDocumentInput): string {
  const body = input.sections
    .map(
      (section) => `
        <section class="cv-section" id="${slugify(section.title)}">
          <h2>${escapeHtml(section.title)}</h2>
          ${section.html}
        </section>
      `,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(input.title)}</title>
<meta name="author" content="${escapeHtml(input.authorName)}">
<meta name="subject" content="${escapeHtml(`${input.audience} security report ${input.reference}`)}">
<meta name="generator" content="CodeVault ${escapeHtml(input.templateVersion)}">
<style>
:root {
  --cv-tlp-marking: "${input.tlp}";
  --cv-report-reference: "${input.reference}";
}
${REPORT_STYLESHEET}
</style>
</head>
<body>
${coverPage(input)}
${tableOfContents(input.sections)}
<main>
${body}
</main>
</body>
</html>`;
}
