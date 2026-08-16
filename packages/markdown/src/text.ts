/**
 * Plain text from Markdown.
 *
 * For the places that need words without markup: PDF metadata, a search index,
 * and the clamped one-line summaries on cards, where rendering real Markdown
 * would put a table inside a two-line preview.
 *
 * Deliberately a scan rather than a parse, and deliberately its own module
 * with no dependencies, so a caller that only wants a summary line does not
 * pull in the whole rendering pipeline.
 */
export function markdownToPlainText(markdown: string): string {
  return (
    markdown
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      // Table pipes and separator rows, which otherwise read as punctuation
      // soup once the line breaks are collapsed.
      .replace(/^\s*\|?[\s:|-]{4,}\|?\s*$/gm, " ")
      .replace(/\|/g, " ")
      .replace(/^\s*>\s?/gm, "")
      .replace(/[*_~]/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}
