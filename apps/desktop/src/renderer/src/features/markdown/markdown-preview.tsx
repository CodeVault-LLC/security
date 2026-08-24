import {
  MARKDOWN_SCREEN_THEME,
  MARKDOWN_STYLESHEET,
  renderMarkdown,
} from "@codevault/markdown";
import { hydrateDiagrams } from "@codevault/markdown/diagrams";
import { useEffect, useRef, useState } from "react";

/**
 * Rendered Markdown.
 *
 * The same pipeline that produces the PDF, so what a researcher approves on
 * screen is what the vendor receives. Diagrams are drawn afterwards by the
 * same hydration code the PDF worker injects into its Chromium.
 */

const STYLE_ID = "cv-markdown-styles";

/**
 * Installs the shared stylesheet once.
 *
 * It arrives as a string from `@codevault/markdown` rather than a CSS file
 * because the printed report needs the identical rules inlined into a document
 * that never sees this application's build.
 */
function ensureStyles(): void {
  if (
    typeof document === "undefined" ||
    document.getElementById(STYLE_ID) !== null
  ) {
    return;
  }

  const style = document.createElement("style");

  style.id = STYLE_ID;
  style.textContent = `${MARKDOWN_SCREEN_THEME}\n${MARKDOWN_STYLESHEET}`;
  document.head.append(style);
}

export interface RenderedMarkdownProps {
  /** Sanitised HTML, from this package's pipeline or the report endpoint. */
  html: string;
  className?: string | undefined;
  /** Reading layout for reports, compact layout for dense activity feeds. */
  variant?: "document" | "compact";
}

/**
 * Displays already-rendered HTML and draws any diagrams in it.
 *
 * Used directly by the report editor, whose preview comes from the server:
 * only the server can resolve `[evidence:EVID-000123]` against the database
 * and check it against the audience's visibility rules.
 */
export function RenderedMarkdown({
  html,
  className,
  variant = "document",
}: RenderedMarkdownProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);

  ensureStyles();

  useEffect(() => {
    const host = hostRef.current;

    if (host === null) {
      return;
    }

    let cancelled = false;

    void hydrateDiagrams(host).then(() => {
      void cancelled;
    });

    return () => {
      cancelled = true;
    };
  }, [html]);

  return (
    <div
      ref={hostRef}
      // The HTML has been through the sanitising pipeline, which drops raw
      // HTML at the Markdown AST and allow-lists what remains. It is the same
      // renderer the exported PDF uses.
      dangerouslySetInnerHTML={{ __html: html }}
      className={`cv-preview cv-preview--${variant} ${className ?? ""}`}
    />
  );
}

export interface MarkdownPreviewProps {
  markdown: string;
  className?: string;
  /** Reading layout for reports, compact layout for dense activity feeds. */
  variant?: "document" | "compact";
  /** Shown when there is nothing written yet. */
  emptyLabel?: string;
  /** Milliseconds to wait after typing stops. */
  debounceMs?: number;
}

/**
 * Renders Markdown as it is typed.
 *
 * Debounced: rendering is cheap, but drawing a diagram is not, and redrawing
 * one on every keystroke makes a live preview feel worse than no preview.
 */
export function MarkdownPreview({
  markdown,
  className,
  variant = "document",
  emptyLabel = "Nothing to preview yet.",
  debounceMs = 200,
}: MarkdownPreviewProps): React.JSX.Element {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    // Nothing to render, and nothing to clear: the empty case is handled
    // below without consulting `html` at all.
    if (markdown.trim().length === 0) {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void renderMarkdown(markdown).then((rendered) => {
        if (!cancelled) {
          setHtml(rendered);
        }
      });
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [markdown, debounceMs]);

  if (markdown.trim().length === 0) {
    return (
      <p
        className={`cv-preview-state cv-preview-state--${variant} ${className ?? ""}`}
      >
        {emptyLabel}
      </p>
    );
  }

  if (html === null) {
    return (
      <p
        aria-live="polite"
        className={`cv-preview-state cv-preview-state--${variant} ${className ?? ""}`}
      >
        Rendering…
      </p>
    );
  }

  return (
    <RenderedMarkdown html={html} className={className} variant={variant} />
  );
}
