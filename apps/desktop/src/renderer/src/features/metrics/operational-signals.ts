import type { MetricsResponse } from "@codevault/contracts";

export interface OperationalSignal {
  label: string;
  value: string;
  detail: string;
}

function percent(part: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((part / total) * 100)}%`;
}

/**
 * Derived, explainable metrics for operational decisions.
 *
 * Every signal keeps its numerator and denominator visible in the detail. This
 * is analysis of recorded facts, not a synthetic risk score.
 */
export function buildOperationalSignals(
  data: MetricsResponse,
): OperationalSignal[] {
  const opened = data.trend.reduce((sum, point) => sum + point.opened, 0);
  const published = data.trend.reduce((sum, point) => sum + point.published, 0);
  const unresolved =
    data.age.under30Days +
    data.age.from30To89Days +
    data.age.from90To179Days +
    data.age.atLeast180Days;
  const longLived = data.age.from90To179Days + data.age.atLeast180Days;
  const coverageFields = [
    data.coverage.scored,
    data.coverage.weaknessClassified,
    data.coverage.assetLinked,
    data.coverage.evidenceLinked,
    data.coverage.affectedRangeRecorded,
    data.coverage.priorArtChecked,
  ];
  const coverageSlots = data.coverage.total * coverageFields.length;
  const coveredSlots = coverageFields.reduce((sum, count) => sum + count, 0);
  const acknowledgement = data.stages.find(
    (stage) => stage.stage === "CONTACT_TO_ACKNOWLEDGEMENT",
  );
  const acknowledgementSpread =
    acknowledgement?.p50Days === null ||
    acknowledgement?.p50Days === undefined ||
    acknowledgement.p90Days === null
      ? null
      : Math.max(0, acknowledgement.p90Days - acknowledgement.p50Days);

  return [
    {
      label: "Publication to intake",
      value: percent(published, opened),
      detail:
        opened === 0
          ? "No findings entered in this window."
          : `${published} published for ${opened} findings entered in this window.`,
    },
    {
      label: "Long-lived backlog",
      value: percent(longLived, unresolved),
      detail:
        unresolved === 0
          ? "No unresolved findings."
          : `${longLived} of ${unresolved} unresolved findings are at least 90 days old.`,
    },
    {
      label: "Research completeness",
      value: percent(coveredSlots, coverageSlots),
      detail:
        data.coverage.total === 0
          ? "No findings available for coverage analysis."
          : "Mean coverage across score, weakness, asset, evidence, affected range, and prior art.",
    },
    {
      label: "Critical remediation gap",
      value: percent(data.totals.criticalsUnfixed, data.severity.critical),
      detail:
        data.severity.critical === 0
          ? "No critical findings."
          : `${data.totals.criticalsUnfixed} of ${data.severity.critical} critical findings lack a verified fix.`,
    },
    {
      label: "Review queue share",
      value: percent(data.totals.awaitingReview, data.totals.findings),
      detail:
        data.totals.findings === 0
          ? "No findings available for review analysis."
          : `${data.totals.awaitingReview} of ${data.totals.findings} findings await review.`,
    },
    {
      label: "Acknowledgement variability",
      value:
        acknowledgementSpread === null
          ? "—"
          : `${acknowledgementSpread.toFixed(0)}d`,
      detail:
        acknowledgementSpread === null || acknowledgement === undefined
          ? "Too few complete acknowledgement intervals."
          : `The 90th percentile is ${acknowledgementSpread.toFixed(1)} days above the median across ${acknowledgement.sampleSize} cases.`,
    },
  ];
}
