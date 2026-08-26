export type IntelligenceFreshnessState = "FRESH" | "STALE" | "UNKNOWN";

export interface IntelligenceFreshness {
  state: IntelligenceFreshnessState;
  ageDays: number | null;
  thresholdDays: number;
}

const MILLIS_PER_DAY = 24 * 60 * 60 * 1_000;

/** Freshness windows follow how often each external source is expected to move. */
export function intelligenceFreshness(
  scheme: string,
  retrievedAt: string | null,
  now: Date = new Date(),
): IntelligenceFreshness {
  const thresholdDays = scheme === "EVSS" ? 30 : 2;
  if (retrievedAt === null) {
    return { state: "UNKNOWN", ageDays: null, thresholdDays };
  }

  const retrievedTime = Date.parse(retrievedAt);
  if (!Number.isFinite(retrievedTime)) {
    return { state: "UNKNOWN", ageDays: null, thresholdDays };
  }

  const ageDays = Math.max(0, (now.getTime() - retrievedTime) / MILLIS_PER_DAY);
  return {
    state: ageDays > thresholdDays ? "STALE" : "FRESH",
    ageDays,
    thresholdDays,
  };
}

export function isFreshnessTrackedIntelligence(scheme: string): boolean {
  return scheme === "EPSS" || scheme === "KEV" || scheme === "EVSS";
}
