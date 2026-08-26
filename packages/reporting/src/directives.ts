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
  "poc",
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

const INDENTED_CODE_PATTERN = /^(?: {4}|\t).*$/gm;
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?(?:-->|$)/g;

function linkRanges(markdown: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let cursor = 0;

  while (cursor < markdown.length) {
    const open = markdown.indexOf("[", cursor);
    if (open === -1) break;
    const labelEnd = markdown.indexOf("]", open + 1);
    if (labelEnd === -1) break;
    const destinationOpen = markdown[labelEnd + 1];

    if (destinationOpen === "(" || destinationOpen === "[") {
      const destinationClose = markdown.indexOf(
        destinationOpen === "(" ? ")" : "]",
        labelEnd + 2,
      );
      if (destinationClose !== -1) {
        ranges.push([open, destinationClose + 1]);
        cursor = destinationClose + 1;
        continue;
      }
    }

    cursor = labelEnd + 1;
  }

  let lineStart = 0;
  while (lineStart < markdown.length) {
    const lineEnd = markdown.indexOf("\n", lineStart);
    const end = lineEnd === -1 ? markdown.length : lineEnd;
    let open = lineStart;
    while (open < end && markdown[open] === " " && open - lineStart < 3) {
      open += 1;
    }
    if (markdown[open] === "[") {
      const labelEnd = markdown.indexOf("]", open + 1);
      if (labelEnd !== -1 && labelEnd < end && markdown[labelEnd + 1] === ":") {
        ranges.push([open, end]);
      }
    }
    if (lineEnd === -1) break;
    lineStart = lineEnd + 1;
  }

  return ranges;
}

function inlineCodeRanges(markdown: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let cursor = 0;

  while (cursor < markdown.length) {
    const open = markdown.indexOf("`", cursor);
    if (open === -1) break;
    const delimiterLength = repeatedCharacterLength(markdown, open, "`");
    let candidate = open + delimiterLength;

    while (candidate < markdown.length && markdown[candidate] !== "\n") {
      const close = markdown.indexOf("`", candidate);
      if (close === -1 || markdown.slice(candidate, close).includes("\n")) {
        candidate = markdown.length;
        break;
      }
      const closeLength = repeatedCharacterLength(markdown, close, "`");
      if (closeLength >= delimiterLength) {
        ranges.push([open, close + delimiterLength]);
        candidate = close + closeLength;
        break;
      }
      candidate = close + closeLength;
    }

    cursor = candidate > open ? candidate : open + delimiterLength;
  }

  return ranges;
}

function repeatedCharacterLength(
  value: string,
  start: number,
  character: string,
): number {
  let end = start;
  while (value[end] === character) end += 1;
  return end - start;
}

function indentedCodeRanges(markdown: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const match of markdown.matchAll(INDENTED_CODE_PATTERN)) {
    if (match.index !== undefined) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  return ranges;
}

function htmlCommentRanges(markdown: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const match of markdown.matchAll(HTML_COMMENT_PATTERN)) {
    if (match.index !== undefined) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  return ranges;
}

function fencedCodeRanges(markdown: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let open: { character: "`" | "~"; length: number; start: number } | null =
    null;
  let offset = 0;

  for (const rawLine of markdown.split(/(?<=\n)/u)) {
    const line = rawLine.replace(/\r?\n$/u, "");
    if (open === null) {
      const match = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
      const fence = match?.[1];
      if (fence !== undefined) {
        open = {
          character: fence[0] as "`" | "~",
          length: fence.length,
          start: offset,
        };
      }
    } else {
      const match = /^ {0,3}(`+|~+)\s*$/u.exec(line);
      const fence = match?.[1];
      if (
        fence !== undefined &&
        fence[0] === open.character &&
        fence.length >= open.length
      ) {
        ranges.push([open.start, offset + rawLine.length]);
        open = null;
      }
    }
    offset += rawLine.length;
  }

  if (open !== null) ranges.push([open.start, markdown.length]);
  return ranges;
}

function isEscaped(markdown: string, offset: number): boolean {
  let backslashes = 0;
  for (
    let index = offset - 1;
    index >= 0 && markdown[index] === "\\";
    index -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

export function parseDirectives(markdown: string): ParsedDirective[] {
  const ignoredRanges = [
    ...linkRanges(markdown),
    ...inlineCodeRanges(markdown),
    ...fencedCodeRanges(markdown),
    ...indentedCodeRanges(markdown),
    ...htmlCommentRanges(markdown),
  ];
  const directives: ParsedDirective[] = [];
  let line = 1;
  let lineCursor = 0;

  for (const match of markdown.matchAll(DIRECTIVE_PATTERN)) {
    const start = match.index;

    if (start === undefined) {
      continue;
    }

    while (lineCursor < start) {
      if (
        markdown[lineCursor] === "\r" ||
        (markdown[lineCursor] === "\n" && markdown[lineCursor - 1] !== "\r")
      ) {
        line += 1;
      }
      lineCursor += 1;
    }

    if (isEscaped(markdown, start)) continue;

    const ignored = ignoredRanges.some(
      ([from, to]) => start >= from && start < to,
    );

    if (ignored) {
      continue;
    }

    const [raw, kind = "", argument = ""] = match;

    directives.push({
      kind,
      argument,
      start,
      end: start + raw.length,
      raw,
      line,
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
    "UNKNOWN_DIRECTIVE" | "NOT_FOUND" | "VISIBILITY_DENIED" | "RESOLVER_FAILED";
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

/** A placeholder and the HTML it stands for, resolved or failed. */
export interface DirectiveSubstitution {
  placeholder: string;
  html: string;
  text: string;
}

export interface DirectiveResolutionResult {
  /** Markdown with every directive replaced by an opaque placeholder. */
  markdown: string;
  resolved: ResolvedDirective[];
  errors: DirectiveError[];
  /** Every placeholder in the Markdown, including the error markers. */
  substitutions: DirectiveSubstitution[];
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
  const substitutions: DirectiveSubstitution[] = [];
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  const resolutionCache = new Map<string, Promise<ResolvedDirective | null>>();

  let placeholderIndex = 0;
  const nextPlaceholder = (): string => {
    let placeholder = placeholderFor(placeholderIndex);
    while (markdown.includes(placeholder)) {
      placeholderIndex += 1;
      placeholder = placeholderFor(placeholderIndex);
    }
    placeholderIndex += 1;
    return placeholder;
  };

  /**
   * Replaces a failed directive with a visible error marker.
   *
   * Never with the original text and never with nothing: a reader has to be
   * able to see that something was meant to be here and is not.
   */
  const fail = (
    directive: ParsedDirective,
    reason: DirectiveError["reason"],
    message: string,
  ): void => {
    errors.push({
      kind: directive.kind,
      argument: directive.argument,
      line: directive.line,
      reason,
      message,
    });

    const placeholder = nextPlaceholder();
    substitutions.push({
      placeholder,
      html: `<span class="cv-directive-error">${escapeForError(message)}</span>`,
      text: `[Directive error: ${message}]`,
    });
    replacements.push({
      start: directive.start,
      end: directive.end,
      text: placeholder,
    });
  };

  for (const directive of directives) {
    if (!isKnownDirectiveKind(directive.kind)) {
      fail(
        directive,
        "UNKNOWN_DIRECTIVE",
        `Unknown directive "${directive.raw}".`,
      );
      continue;
    }

    let item: ResolvedDirective | null;

    try {
      const cacheKey = `${directive.kind}\0${directive.argument}`;
      let resolution = resolutionCache.get(cacheKey);
      if (resolution === undefined) {
        resolution = resolver.resolve(directive.kind, directive.argument);
        resolutionCache.set(cacheKey, resolution);
      }
      item = await resolution;
    } catch {
      fail(
        directive,
        "RESOLVER_FAILED",
        `Could not resolve "${directive.raw}".`,
      );
      continue;
    }

    if (item === null) {
      fail(
        directive,
        "NOT_FOUND",
        `"${directive.raw}" does not refer to anything in this case.`,
      );
      continue;
    }

    if (!canInclude(item.visibility, audience)) {
      // The message deliberately omits the reference itself: a public preview
      // should not print the identifier of internal evidence.
      fail(
        directive,
        "VISIBILITY_DENIED",
        `A referenced ${directive.kind} is ${item.visibility} content and ` +
          `cannot appear in a ${audience} report.`,
      );
      continue;
    }

    const placeholder = nextPlaceholder();
    substitutions.push({ placeholder, html: item.html, text: item.text });
    replacements.push({
      start: directive.start,
      end: directive.end,
      text: placeholder,
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

  return { markdown: output, resolved, errors, substitutions };
}

/** Minimal escaping for text placed inside a generated error span. */
function escapeForError(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Substitutes generated HTML back in after sanitisation.
 *
 * Covers both resolved directives and the error markers that replaced the ones
 * which failed, so no placeholder can survive into the rendered output.
 */
export function applyResolvedDirectives(
  html: string,
  substitutions: readonly DirectiveSubstitution[],
): string {
  let output = html;

  for (const substitution of substitutions) {
    // A directive standing alone on its line became its own paragraph during
    // Markdown rendering. Evidence and score blocks are block-level elements,
    // and a <div> inside a <p> is closed early by the parser, which leaves a
    // stray empty paragraph in the page flow. Unwrap that case first.
    if (isBlockLevel(substitution.html)) {
      output = output
        .split(`<p>${substitution.placeholder}</p>`)
        .join(substitution.html);
    }

    output = output.split(substitution.placeholder).join(substitution.html);
  }

  return output;
}

/** Substitutes portable plain text for directives in a Markdown export. */
export function applyResolvedDirectiveText(
  markdown: string,
  substitutions: readonly DirectiveSubstitution[],
): string {
  let output = markdown;

  for (const substitution of substitutions) {
    output = output.split(substitution.placeholder).join(substitution.text);
  }

  return output;
}

/** Whether generated directive HTML is a block element rather than a span. */
function isBlockLevel(html: string): boolean {
  return html.startsWith("<div") || html.startsWith("<table");
}
