import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import apache from "highlight.js/lib/languages/apache";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import http from "highlight.js/lib/languages/http";
import nginx from "highlight.js/lib/languages/nginx";
import powershell from "highlight.js/lib/languages/powershell";
import properties from "highlight.js/lib/languages/properties";
import x86asm from "highlight.js/lib/languages/x86asm";
import { common } from "lowlight";

import { remarkCallouts } from "./callouts.js";
import { rehypeDiagramFence } from "./diagram-fence.js";
import { rehypeNamespaceIds } from "./ids.js";
import { FOOTNOTE_ID_PREFIX, SANITIZE_SCHEMA } from "./sanitize.js";

/**
 * The Markdown pipeline.
 *
 * One processor, shared by everything that renders CodeVault Markdown: the
 * live preview in the desktop app, the report preview endpoint, and the PDF
 * the vendor eventually receives. They are the same code path on purpose — a
 * preview that renders differently from the exported document is a preview
 * that cannot be trusted before sending.
 *
 * The plugin order is load-bearing and is commented where it is.
 */

/**
 * The grammars available to a fenced code block.
 *
 * `common` is highlight.js's default set — Python, C, shell, SQL, JSON and the
 * rest — and has to be spread back in, because supplying `languages` replaces
 * that set rather than extending it. Added to it is what a vulnerability
 * report actually quotes: an HTTP request is the most common code block in
 * this application by a wide margin and is not one of the defaults, and the
 * others cover the configuration and disassembly that turn up in findings.
 */
const LANGUAGES = {
  ...common,
  http,
  nginx,
  apache,
  dockerfile,
  powershell,
  properties,
  x86asm,
};

const processor = unified()
  .use(remarkParse)
  // Tables, task lists, strikethrough, autolinks and footnotes.
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkCallouts)
  .use(remarkRehype, {
    // `allowDangerousHtml` stays off: raw HTML in authored Markdown is dropped
    // at the AST boundary rather than sanitised later.
    clobberPrefix: FOOTNOTE_ID_PREFIX,
    footnoteLabel: "Footnotes",
  })
  .use(rehypeSlug)
  .use(rehypeNamespaceIds)
  // Before the highlighter: a mermaid fence must be claimed as a diagram
  // rather than coloured as an unknown programming language.
  .use(rehypeDiagramFence)
  .use(rehypeHighlight, {
    // Only fences that declare a language are highlighted. Guessing at an
    // unlabelled block is how a raw HTTP request ends up coloured as Perl.
    detect: false,
    // An unknown language renders as plain code instead of throwing. Reports
    // quote all sorts of things, and none of them are worth a failed render.
    ignoreMissing: true,
    languages: LANGUAGES,
  })
  .use(rehypeKatex, {
    // MathML, not KaTeX's HTML: the HTML output depends on KaTeX's own font
    // files, and a report that fetches a font is exactly the signal an
    // embargoed document must not emit. Chromium renders MathML natively.
    //
    // rehype-katex never throws on a malformed expression; it renders the
    // source flagged as an error instead, which is what a draft needs.
    output: "mathml",
  })
  .use(rehypeSanitize, SANITIZE_SCHEMA)
  .use(rehypeStringify);

/**
 * Renders Markdown to sanitised HTML.
 *
 * Diagrams are left as inert containers; see `hydrateDiagrams` for the step
 * that draws them, which needs a DOM and therefore does not run here.
 */
export async function renderMarkdown(markdown: string): Promise<string> {
  const file = await processor.process(markdown);

  return String(file);
}
