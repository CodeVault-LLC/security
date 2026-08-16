import { defaultSchema } from "rehype-sanitize";

/**
 * The sanitisation allow-list.
 *
 * Report and finding Markdown is authored by researchers, revised by AI and
 * quotes attacker-controlled strings — request bodies, filenames, payloads,
 * hostnames. All of it is treated as untrusted: raw HTML never enters the tree,
 * and what leaves this schema is an allow-list of elements and attributes we
 * have individually decided are safe to print.
 *
 * Everything here is additive to what a plain document needs. Each block below
 * says which feature required it, because an allow-list nobody can justify
 * line-by-line stops being one.
 */

/**
 * Identifier prefixes.
 *
 * Every `id` in rendered output carries one of these. Headings are slugged by
 * us, footnotes by mdast-util-to-hast, and both are namespaced so a document
 * cannot mint an id that collides with the application's own DOM — a heading
 * called "app" must not become `window.app` in the Electron renderer.
 */
export const HEADING_ID_PREFIX = "cv-h-";
export const FOOTNOTE_ID_PREFIX = "cv-fn-";

/** Matches only the identifiers this pipeline generates. */
const SAFE_ID = new RegExp(`^(?:${HEADING_ID_PREFIX}|${FOOTNOTE_ID_PREFIX})`);

const MATHML_TAGS = [
  "math",
  "semantics",
  "annotation",
  "mrow",
  "mi",
  "mo",
  "mn",
  "ms",
  "mtext",
  "mspace",
  "msup",
  "msub",
  "msubsup",
  "mfrac",
  "msqrt",
  "mroot",
  "mstyle",
  "munder",
  "mover",
  "munderover",
  "mtable",
  "mtr",
  "mtd",
  "mpadded",
  "mphantom",
  "menclose",
  "mmultiscripts",
  "mprescripts",
  "none",
];

export const SANITIZE_SCHEMA = {
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
    // Task lists render a disabled checkbox; it is never interactive.
    "input",
    // GFM footnotes are emitted as a labelled <section> at the end.
    "section",
    ...MATHML_TAGS,
  ],
  attributes: {
    ...defaultSchema.attributes,
    // `id` is allowed anywhere, but only in the namespaces above. Anything
    // else — including an id an author wrote by hand — is dropped.
    //
    // `cv-` class names are ours: they are attached by this package's own
    // plugins, never by anything an author can write, since raw HTML never
    // reaches the tree.
    "*": [
      ["id", SAFE_ID],
      ["className", /^cv-/],
    ],
    a: [
      ["href"],
      ["title"],
      ["className", "cv-footnote-ref", "cv-footnote-backref"],
      ["id", SAFE_ID],
      ["dataFootnoteRef"],
      ["dataFootnoteBackref"],
      ["ariaLabel"],
    ],
    code: [["className", /^language-./, "hljs"]],
    // Highlighting emits nothing but class names; the theme is ours.
    span: [["className", /^cv-/, /^hljs-/, /^katex/]],
    div: [["className", /^cv-/], ["dataCvDiagram"]],
    section: [["className", /^cv-/], ["dataFootnotes"]],
    li: [["id", SAFE_ID]],
    th: [["align"]],
    td: [["align"]],
    // A task-list checkbox, and strictly nothing else: never a text field, a
    // file picker or an enabled control.
    input: [["type", "checkbox"], ["checked"], ["disabled"]],
    math: [["display"]],
    annotation: [["encoding"]],
  },
  // A report must not fetch anything when it is opened or printed, so only
  // link protocols a reader clicks deliberately are allowed. Fragment links
  // carry no protocol and are constrained by the `href` patterns above.
  protocols: {
    href: ["http", "https", "mailto"],
  },
  // Identifiers are namespaced at the point they are generated, so the
  // sanitiser must not prefix them a second time.
  clobber: [],
} satisfies typeof defaultSchema;
