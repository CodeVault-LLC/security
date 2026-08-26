export interface PreviewRedactionRule {
  match: string;
  replacement: string;
}

/** Applies ordered literal substitutions without invoking a regex engine. */
export function applyPreviewRedactions(
  source: string,
  rules: readonly PreviewRedactionRule[],
): string {
  return rules.reduce(
    (current, rule) =>
      rule.match.length === 0
        ? current
        : current.split(rule.match).join(rule.replacement),
    source,
  );
}
