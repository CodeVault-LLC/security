import { markdownToPlainText, renderMarkdown } from "@codevault/markdown";

import type { ReportAudience } from "@codevault/core";

import {
  applyResolvedDirectives,
  resolveDirectives,
  type DirectiveError,
  type DirectiveResolver,
  type ResolvedDirective,
} from "./directives.js";

/**
 * Report section rendering.
 *
 * The Markdown pipeline itself lives in `@codevault/markdown`, shared with the
 * desktop app so a live preview and an exported PDF cannot disagree. What this
 * module adds is the part that only makes sense with a database behind it:
 * resolving CodeVault directives and applying the audience's visibility rules.
 */

export interface RenderResult {
  html: string;
  directiveErrors: DirectiveError[];
  resolvedDirectives: ResolvedDirective[];
}

export { renderMarkdown };

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
export { markdownToPlainText };
