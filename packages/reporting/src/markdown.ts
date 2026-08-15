import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import type { ReportAudience } from "@codevault/core";

import {
  applyResolvedDirectives,
  resolveDirectives,
  type DirectiveError,
  type DirectiveResolver,
  type ResolvedDirective,
} from "./directives.js";

/**
 * Markdown rendering.
 *
 * Report Markdown is authored by researchers and revised by AI, and it quotes
 * attacker-controlled strings — request bodies, filenames, payloads. It is
 * therefore treated as untrusted: raw HTML is never passed through, the output
 * is sanitised against an allow-list, and nothing in a rendered report can
 * reach the network.
 */

/**
 * Sanitisation schema.
 *
 * Built from rehype's defaults, then narrowed: no `img` from arbitrary URLs, no
 * `iframe`, no `style`, and only the class names our own directive HTML uses.
 */
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [
    "p",
    "br",
    "hr",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "strong",
    "em",
    "del",
    "code",
    "pre",
    "blockquote",
    "ul",
    "ol",
    "li",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "a",
    "sup",
    "sub",
    "span",
    "div",
  ],
  attributes: {
    ...defaultSchema.attributes,
    a: [["href"], ["title"]],
    code: [["className", /^language-./]],
    span: [["className", /^cv-/]],
    div: [["className", /^cv-/]],
    th: [["align"]],
    td: [["align"]],
  },
  // A report must not fetch anything when it is opened or printed, so only
  // link protocols that a reader clicks deliberately are allowed.
  protocols: {
    href: ["http", "https", "mailto"],
  },
  clobberPrefix: "cv-user-content-",
} satisfies typeof defaultSchema;

export interface RenderResult {
  html: string;
  directiveErrors: DirectiveError[];
  resolvedDirectives: ResolvedDirective[];
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  // `allowDangerousHtml` stays off: raw HTML in report Markdown is dropped at
  // the AST boundary rather than sanitised later.
  .use(remarkRehype)
  .use(rehypeSanitize, SANITIZE_SCHEMA)
  .use(rehypeStringify);

/** Renders Markdown with no directive resolution, for previews of raw text. */
export async function renderMarkdown(markdown: string): Promise<string> {
  const file = await processor.process(markdown);

  return String(file);
}

/**
 * Renders a report section: resolve directives, sanitise, then substitute.
 *
 * The order matters. Directives resolve to trusted HTML we generate ourselves,
 * so they are held back until after the untrusted content has been sanitised.
 */
export async function renderSection(
  markdown: string,
  audience: ReportAudience,
  resolver: DirectiveResolver,
): Promise<RenderResult> {
  const resolution = await resolveDirectives(markdown, audience, resolver);
  const sanitised = await renderMarkdown(resolution.markdown);
  const html = applyResolvedDirectives(sanitised, resolution.substitutions);

  return {
    html,
    directiveErrors: resolution.errors,
    resolvedDirectives: resolution.resolved,
  };
}

/** Escapes text destined for generated HTML fragments. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Strips Markdown syntax for plain-text contexts such as PDF metadata. */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
