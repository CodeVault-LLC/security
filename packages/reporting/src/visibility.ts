import {
  canInclude,
  type ContentVisibility,
  type ReportAudience,
} from "@codevault/core";

/**
 * Report-side visibility enforcement.
 *
 * The same `canInclude` rule as the domain layer, applied to the shapes the
 * reporting pipeline actually handles. It runs twice on purpose: once when the
 * AI context is built, and again at export. A single check would be a single
 * point of failure for the property that matters most in this product.
 */

export interface VisibilityTagged {
  visibility: ContentVisibility;
}

export interface VisibilityViolation {
  label: string;
  visibility: ContentVisibility;
  audience: ReportAudience;
  reason: string;
}

export function partitionByAudience<T extends VisibilityTagged>(
  items: readonly T[],
  audience: ReportAudience,
  labelOf: (item: T) => string,
): { allowed: T[]; violations: VisibilityViolation[] } {
  const allowed: T[] = [];
  const violations: VisibilityViolation[] = [];

  for (const item of items) {
    if (canInclude(item.visibility, audience)) {
      allowed.push(item);
      continue;
    }

    violations.push({
      label: labelOf(item),
      visibility: item.visibility,
      audience,
      reason: `${item.visibility} content cannot appear in a ${audience} report.`,
    });
  }

  return { allowed, violations };
}

/**
 * Final gate before an export is written.
 *
 * Throws rather than filtering: at this point silently dropping content would
 * produce a report whose numbering and cross-references no longer match what
 * the reviewer approved.
 */
export function assertNoVisibilityViolations(
  violations: readonly VisibilityViolation[],
): void {
  if (violations.length === 0) {
    return;
  }

  const summary = violations
    .map((violation) => `${violation.label} (${violation.visibility})`)
    .join(", ");

  throw new VisibilityViolationError(
    `This export references content the audience may not see: ${summary}.`,
    violations,
  );
}

export class VisibilityViolationError extends Error {
  readonly violations: readonly VisibilityViolation[];

  constructor(message: string, violations: readonly VisibilityViolation[]) {
    super(message);

    this.name = "VisibilityViolationError";
    this.violations = violations;
  }
}
