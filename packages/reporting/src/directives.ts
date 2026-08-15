import type { ContentVisibility, ReportAudience } from "@codevault/core";
import { canInclude } from "@codevault/core";

/**
 * CodeVault Markdown directives.
 *
 * A directive such as `[evidence:EVID-000123]` is a reference to structured
 * data, not a formatting instruction. Resolving it through the database is what
 * lets the visibility rules apply to report content: an evidence directive in a
 * public report is checked against that evidence's actual visibility, rather
 * than trusting whatever the author pasted in.
 *
 * An unknown or unresolvable directive renders as a visible error. Silently
 * dropping it would let a report ship with a hole where a figure should be.
 */

export const DIRECTIVE_KINDS = [
  "evidence",
  "asset",
  "finding",
  "reference",
  "score",
  "disclosure-timeline",
] as const;

export type DirectiveKind = (typeof DIRECTIVE_KINDS)[number];

export interface ParsedDirective {
  kind: string;
  /** Argument after the colon, e.g. `EVID-000123`. Empty for bare directives. */
  argument: string;
  /** Character offset of the directive within the source Markdown. */
  start: number;
  end: number;
  raw: string;
  /** 1-indexed line, for lint messages. */
  line: number;
}

/**
 * Matches `[kind:ARGUMENT]` and bare `[kind]`.
 *
 * Deliberately narrow: only uppercase references, digits and a few separators
 * are accepted as arguments, so a directive can never carry markup or a URL.
 */
const DIRECTIVE_PATTERN = /\[([a-z][a-z-]*)(?::([A-Za-z0-9:_.-]+))?\]/g;

/**
 * Markdown link syntax, used to skip `[text](url)`.
 *
 * Without this, an ordinary link whose text happens to look like a directive
 * would be parsed as one.
 */
const LINK_PATTERN = /\[[^\]]*\]\([^)]*\)/g;

function linkRanges(markdown: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];

  for (const match of markdown.matchAll(LINK_PATTERN)) {
    if (match.index !== undefined) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }

  return ranges;
}

function lineNumberAt(markdown: string, offset: number): number {
  let line = 1;

  for (let index = 0; index < offset && index < markdown.length; index += 1) {
    if (markdown[index] === "\n") {
      line += 1;
    }
  }

  return line;
}

export function parseDirectives(markdown: string): ParsedDirective[] {
  const links = linkRanges(markdown);
  const directives: ParsedDirective[] = [];

  for (const match of markdown.matchAll(DIRECTIVE_PATTERN)) {
    const start = match.index;

    if (start === undefined) {
      continue;
    }

    const insideLink = links.some(
      ([from, to]) => start >= from && start < to,
    );

    if (insideLink) {
      continue;
    }

    const [raw, kind = "", argument = ""] = match;

    directives.push({
      kind,
      argument,
      start,
      end: start + raw.length,
      raw,
      line: lineNumberAt(markdown, start),
    });
  }

  return directives;
}

export function isKnownDirectiveKind(kind: string): kind is DirectiveKind {
  return (DIRECTIVE_KINDS as readonly string[]).includes(kind);
}

/** A directive successfully resolved against structured data. */
export interface ResolvedDirective {
  kind: DirectiveKind;
  argument: string;
  /** HTML fragment substituted into the rendered output. */
  html: string;
  /** Plain-text replacement used when rendering to Markdown. */
  text: string;
  visibility: ContentVisibility;
}

export interface DirectiveError {
  kind: string;
  argument: string;
  line: number;
  reason:
    | "UNKNOWN_DIRECTIVE"
    | "NOT_FOUND"
    | "VISIBILITY_DENIED"
    | "RESOLVER_FAILED";
  message: string;
}

/**
 * Supplies the data behind each directive kind.
 *
 * Implemented by the server against the database and by tests against
 * fixtures, which is what keeps this package free of any database dependency.
 */
export interface DirectiveResolver {
  resolve(
    kind: DirectiveKind,
    argument: string,
  ): Promise<ResolvedDirective | null>;
}

export interface DirectiveResolutionResult {
  /** Markdown with every resolvable directive replaced by an HTML placeholder. */
  markdown: string;
  resolved: ResolvedDirective[];
  errors: DirectiveError[];
}

/**
 * Placeholder wrapper.
 *
 * Resolved HTML is parked behind an opaque token while the Markdown pipeline
 * runs, then substituted afterwards. Injecting HTML into the Markdown before
 * sanitisation would mean the sanitiser strips our own generated markup.
 */
export const PLACEHOLDER_PREFIX = "cvdirective";

export function placeholderFor(index: number): string {
  return `${PLACEHOLDER_PREFIX}${index}x`;
}

/**
 * Resolves every directive in a section.
 *
 * Directives the audience may not see become errors rather than being silently
 * removed: a public report that references internal evidence is a mistake the
 * author has to see and fix, not something to paper over.
 */
export async function resolveDirectives(
  markdown: string,
  audience: ReportAudience,
  resolver: DirectiveResolver,
): Promise<DirectiveResolutionResult> {
  const directives = parseDirectives(markdown);
  const resolved: ResolvedDirective[] = [];
  const errors: DirectiveError[] = [];
  const replacements: Array<{ start: number; end: number; text: string }> = [];

  for (const directive of directives) {
    if (!isKnownDirectiveKind(directive.kind)) {
      errors.push({
        kind: directive.kind,
        argument: directive.argument,
        line: directive.line,
        reason: "UNKNOWN_DIRECTIVE",
        message: `Unknown directive "${directive.raw}".`,
      });
      continue;
    }

    let item: ResolvedDirective | null;

    try {
      item = await resolver.resolve(directive.kind, directive.argument);
    } catch {
      errors.push({
        kind: directive.kind,
        argument: directive.argument,
        line: directive.line,
        reason: "RESOLVER_FAILED",
        message: `Could not resolve "${directive.raw}".`,
      });
      continue;
    }

    if (item === null) {
      errors.push({
        kind: directive.kind,
        argument: directive.argument,
        line: directive.line,
        reason: "NOT_FOUND",
        message: `"${directive.raw}" does not refer to anything in this case.`,
      });
      continue;
    }

    if (!canInclude(item.visibility, audience)) {
      errors.push({
        kind: directive.kind,
        argument: directive.argument,
        line: directive.line,
        reason: "VISIBILITY_DENIED",
        message:
          `"${directive.raw}" is ${item.visibility} content and cannot appear ` +
          `in a ${audience} report.`,
      });
      continue;
    }

    replacements.push({
      start: directive.start,
      end: directive.end,
      text: placeholderFor(resolved.length),
    });
    resolved.push(item);
  }

  let output = "";
  let cursor = 0;

  for (const replacement of replacements) {
    output += markdown.slice(cursor, replacement.start) + replacement.text;
    cursor = replacement.end;
  }

  output += markdown.slice(cursor);

  return { markdown: output, resolved, errors };
}

/** Substitutes resolved HTML back in after sanitisation. */
export function applyResolvedDirectives(
  html: string,
  resolved: readonly ResolvedDirective[],
): string {
  let output = html;

  for (const [index, directive] of resolved.entries()) {
    output = output.split(placeholderFor(index)).join(directive.html);
  }

  return output;
}
