/**
 * Content visibility and report audience.
 *
 * This module is a security control, not presentation logic. Every path that
 * builds an AI context, renders a report or exports a PDF funnels through
 * `canInclude` so there is exactly one place where "may this audience see this
 * item?" is answered.
 */

export const CONTENT_VISIBILITIES = ["INTERNAL", "VENDOR", "PUBLIC"] as const;

export type ContentVisibility = (typeof CONTENT_VISIBILITIES)[number];

export const REPORT_AUDIENCES = ["INTERNAL", "VENDOR", "PUBLIC"] as const;

export type ReportAudience = (typeof REPORT_AUDIENCES)[number];

/**
 * Sensitivity order, most restricted first.
 *
 * INTERNAL content is the most sensitive; PUBLIC is the least. An audience may
 * consume its own level and everything less sensitive than it.
 */
const SENSITIVITY_RANK: Record<ContentVisibility, number> = {
  INTERNAL: 2,
  VENDOR: 1,
  PUBLIC: 0,
};

/**
 * The single visibility rule:
 *
 * - INTERNAL reports may consume INTERNAL, VENDOR and PUBLIC content.
 * - VENDOR reports may consume VENDOR and PUBLIC content.
 * - PUBLIC reports may consume PUBLIC content only.
 */
export function canInclude(
  itemVisibility: ContentVisibility,
  audience: ReportAudience,
): boolean {
  return SENSITIVITY_RANK[itemVisibility] <= SENSITIVITY_RANK[audience];
}

/** Filters any collection of visibility-tagged records down to one audience. */
export function filterForAudience<T extends { visibility: ContentVisibility }>(
  items: readonly T[],
  audience: ReportAudience,
): T[] {
  return items.filter((item) => canInclude(item.visibility, audience));
}

/**
 * Promotion is always a deliberate human step, so it is only ever allowed to
 * move content toward *less* sensitive. Widening happens through an explicit
 * action; nothing in the platform promotes content as a side effect.
 */
export function isPromotion(
  from: ContentVisibility,
  to: ContentVisibility,
): boolean {
  return SENSITIVITY_RANK[to] < SENSITIVITY_RANK[from];
}

/** The visibility a report of this audience assigns to content it produces. */
export function defaultVisibilityForAudience(
  audience: ReportAudience,
): ContentVisibility {
  return audience;
}

/**
 * The most sensitive visibility an audience is permitted to hold.
 *
 * Report templates carry this as their "visibility ceiling", which the linter
 * uses to explain *why* an item was rejected rather than only that it was.
 */
export function visibilityCeiling(audience: ReportAudience): ContentVisibility {
  return audience;
}

export function isMoreSensitiveThan(
  a: ContentVisibility,
  b: ContentVisibility,
): boolean {
  return SENSITIVITY_RANK[a] > SENSITIVITY_RANK[b];
}
