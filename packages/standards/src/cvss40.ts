import {
  MACRO_VECTOR_LOOKUP,
  MAX_COMPOSED,
  MAX_SEVERITY,
} from "./cvss40-lookup.js";
import {
  CVSS40_MANDATORY_METRICS,
  CVSS40_METRICS_BY_CODE,
  CVSS40_METRIC_ORDER,
} from "./cvss40-metrics.js";
import { severityFromScore, type SeverityRating } from "./severity.js";

/**
 * CVSS v4.0 scoring.
 *
 * This is a TypeScript port of the FIRST.org reference calculator
 * (https://github.com/FIRSTdotorg/cvss-v4-calculator, BSD-2-Clause). CodeVault
 * ports it rather than depending on a third-party calculator because the
 * available packages disagree with the normative implementation on threat and
 * environmental vectors, and a score a researcher publishes has to be the score
 * FIRST defines. `cvss40.test.ts` checks every vector against scores generated
 * from the reference implementation.
 */

export const CVSS40_PREFIX = "CVSS:4.0";

export type Cvss40Metrics = Readonly<Record<string, string>>;

export interface CvssScoreResult {
  /** Canonically ordered vector string. */
  vector: string;
  /** Score rounded to one decimal place, as the specification requires. */
  score: number;
  severity: SeverityRating;
  /** The six-digit equivalence-class vector, useful when explaining a score. */
  macroVector: string;
  metrics: Cvss40Metrics;
}

export class CvssVectorError extends Error {
  readonly metric: string | undefined;

  constructor(message: string, metric?: string) {
    super(message);

    this.name = "CvssVectorError";
    this.metric = metric;
  }
}

/**
 * Parses and validates a CVSS v4.0 vector string.
 *
 * Rejects unknown metrics, unknown values, duplicates and missing mandatory
 * metrics. Nothing downstream has to re-check those conditions.
 */
export function parseCvss40Vector(vector: string): Cvss40Metrics {
  const trimmed = vector.trim();
  const parts = trimmed.split("/");
  const prefix = parts.shift();

  if (prefix !== CVSS40_PREFIX) {
    throw new CvssVectorError(
      `A CVSS v4.0 vector must start with "${CVSS40_PREFIX}".`,
    );
  }

  const metrics = new Map<string, string>();

  for (const part of parts) {
    if (part.length === 0) {
      continue;
    }

    const separator = part.indexOf(":");

    if (separator < 0) {
      throw new CvssVectorError(`Malformed vector component "${part}".`);
    }

    const code = part.slice(0, separator);
    const selected = part.slice(separator + 1);
    const definition = CVSS40_METRICS_BY_CODE.get(code);

    if (definition === undefined) {
      throw new CvssVectorError(`Unknown CVSS v4.0 metric "${code}".`, code);
    }

    if (metrics.has(code)) {
      throw new CvssVectorError(
        `Metric "${code}" appears more than once.`,
        code,
      );
    }

    const isKnownValue = definition.values.some(
      (candidate) => candidate.code === selected,
    );

    if (!isKnownValue) {
      throw new CvssVectorError(
        `"${selected}" is not a valid value for ${definition.name}.`,
        code,
      );
    }

    metrics.set(code, selected);
  }

  for (const mandatory of CVSS40_MANDATORY_METRICS) {
    if (!metrics.has(mandatory)) {
      throw new CvssVectorError(
        `Vector is missing mandatory metric "${mandatory}".`,
        mandatory,
      );
    }
  }

  return Object.fromEntries(metrics);
}

/** Serialises metrics into a canonically ordered vector string. */
export function buildCvss40Vector(metrics: Cvss40Metrics): string {
  const parts: string[] = [CVSS40_PREFIX];

  for (const code of CVSS40_METRIC_ORDER) {
    const selected = metrics[code];

    if (selected === undefined || selected === "X") {
      continue;
    }

    parts.push(`${code}:${selected}`);
  }

  return parts.join("/");
}

/**
 * Resolves the effective value of a metric.
 *
 * Undefined threat and environmental metrics fall back to their worst case, and
 * a modified metric overrides its base counterpart. This mirrors `m()` in the
 * reference implementation.
 */
function effective(metrics: Cvss40Metrics, code: string): string {
  const selected = metrics[code] ?? "X";

  if (code === "E" && selected === "X") {
    return "A";
  }

  if ((code === "CR" || code === "IR" || code === "AR") && selected === "X") {
    return "H";
  }

  const modified = metrics[`M${code}`];

  if (modified !== undefined && modified !== "X") {
    return modified;
  }

  return selected;
}

const IMPACT_METRICS = ["VC", "VI", "VA", "SC", "SI", "SA"] as const;

/** Computes the six-digit MacroVector (equivalence classes EQ1..EQ6). */
export function macroVector(metrics: Cvss40Metrics): string {
  const get = (code: string): string => effective(metrics, code);

  const eq1 = ((): string => {
    if (get("AV") === "N" && get("PR") === "N" && get("UI") === "N") {
      return "0";
    }

    const anyOpen = get("AV") === "N" || get("PR") === "N" || get("UI") === "N";

    if (anyOpen && get("AV") !== "P") {
      return "1";
    }

    return "2";
  })();

  const eq2 = get("AC") === "L" && get("AT") === "N" ? "0" : "1";

  const eq3 = ((): string => {
    if (get("VC") === "H" && get("VI") === "H") {
      return "0";
    }

    if (get("VC") === "H" || get("VI") === "H" || get("VA") === "H") {
      return "1";
    }

    return "2";
  })();

  const eq4 = ((): string => {
    if (get("MSI") === "S" || get("MSA") === "S") {
      return "0";
    }

    if (get("SC") === "H" || get("SI") === "H" || get("SA") === "H") {
      return "1";
    }

    return "2";
  })();

  const eq5 = ((): string => {
    if (get("E") === "A") {
      return "0";
    }

    if (get("E") === "P") {
      return "1";
    }

    return "2";
  })();

  const eq6 = ((): string => {
    const criticalConfidentiality = get("CR") === "H" && get("VC") === "H";
    const criticalIntegrity = get("IR") === "H" && get("VI") === "H";
    const criticalAvailability = get("AR") === "H" && get("VA") === "H";

    if (criticalConfidentiality || criticalIntegrity || criticalAvailability) {
      return "0";
    }

    return "1";
  })();

  return `${eq1}${eq2}${eq3}${eq4}${eq5}${eq6}`;
}

/**
 * Severity-distance levels.
 *
 * Lower numbers are more severe, so a non-negative distance means the candidate
 * maximal vector is at least as severe as the vector being scored.
 */
const LEVELS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  AV: { N: 0.0, A: 0.1, L: 0.2, P: 0.3 },
  PR: { N: 0.0, L: 0.1, H: 0.2 },
  UI: { N: 0.0, P: 0.1, A: 0.2 },
  AC: { L: 0.0, H: 0.1 },
  AT: { N: 0.0, P: 0.1 },
  VC: { H: 0.0, L: 0.1, N: 0.2 },
  VI: { H: 0.0, L: 0.1, N: 0.2 },
  VA: { H: 0.0, L: 0.1, N: 0.2 },
  SC: { H: 0.1, L: 0.2, N: 0.3 },
  SI: { S: 0.0, H: 0.1, L: 0.2, N: 0.3 },
  SA: { S: 0.0, H: 0.1, L: 0.2, N: 0.3 },
  CR: { H: 0.0, M: 0.1, L: 0.2 },
  IR: { H: 0.0, M: 0.1, L: 0.2 },
  AR: { H: 0.0, M: 0.1, L: 0.2 },
};

const DISTANCE_METRICS = [
  "AV",
  "PR",
  "UI",
  "AC",
  "AT",
  "VC",
  "VI",
  "VA",
  "SC",
  "SI",
  "SA",
  "CR",
  "IR",
  "AR",
] as const;

type DistanceMetric = (typeof DISTANCE_METRICS)[number];

function levelOf(code: DistanceMetric, metricValue: string): number {
  const table = LEVELS[code];

  if (table === undefined) {
    throw new CvssVectorError(`No severity levels defined for "${code}".`);
  }

  const level = table[metricValue];

  if (level === undefined) {
    throw new CvssVectorError(
      `Value "${metricValue}" has no severity level for "${code}".`,
      code,
    );
  }

  return level;
}

/** Reads a metric out of a maximal vector fragment such as `AV:N/PR:N/UI:N/`. */
function readMaxVectorMetric(maxVector: string, code: string): string | null {
  for (const part of maxVector.split("/")) {
    const separator = part.indexOf(":");

    if (separator < 0) {
      continue;
    }

    if (part.slice(0, separator) === code) {
      return part.slice(separator + 1);
    }
  }

  return null;
}

type EquivalenceClassKey = "eq1" | "eq2" | "eq4" | "eq5";

function maxVectorsFor(
  key: EquivalenceClassKey,
  index: string,
): readonly string[] {
  const group = MAX_COMPOSED[key] as Readonly<
    Record<string, readonly string[]>
  >;
  const vectors = group[index];

  if (vectors === undefined) {
    throw new CvssVectorError(`No maximal vectors for ${key}=${index}.`);
  }

  return vectors;
}

function maxVectorsForEq3Eq6(eq3: string, eq6: string): readonly string[] {
  const byEq3 = MAX_COMPOSED.eq3 as Readonly<
    Record<string, Readonly<Record<string, readonly string[]>>>
  >;
  const group = byEq3[eq3];
  const vectors = group?.[eq6];

  if (vectors === undefined) {
    throw new CvssVectorError(`No maximal vectors for eq3=${eq3} eq6=${eq6}.`);
  }

  return vectors;
}

function maxSeverityFor(key: "eq1" | "eq2" | "eq4", index: string): number {
  const group = MAX_SEVERITY[key] as Readonly<Record<string, number>>;
  const severity = group[index];

  if (severity === undefined) {
    throw new CvssVectorError(`No maximal severity for ${key}=${index}.`);
  }

  return severity;
}

function maxSeverityForEq3Eq6(eq3: string, eq6: string): number {
  const group = MAX_SEVERITY.eq3eq6 as Readonly<
    Record<string, Readonly<Record<string, number>>>
  >;
  const severity = group[eq3]?.[eq6];

  if (severity === undefined) {
    throw new CvssVectorError(`No maximal severity for eq3=${eq3} eq6=${eq6}.`);
  }

  return severity;
}

interface SeverityDistances {
  eq1: number;
  eq2: number;
  eq3eq6: number;
  eq4: number;
}

/**
 * Finds the first composed maximal vector that is at least as severe as the
 * scored vector in every metric, then returns the per-equivalence-class
 * severity distances to it.
 */
function severityDistances(
  metrics: Cvss40Metrics,
  macro: string,
): SeverityDistances {
  const [eq1 = "", eq2 = "", eq3 = "", eq4 = "", eq5 = "", eq6 = ""] =
    macro.split("");

  const candidates: string[] = [];

  for (const first of maxVectorsFor("eq1", eq1)) {
    for (const second of maxVectorsFor("eq2", eq2)) {
      for (const third of maxVectorsForEq3Eq6(eq3, eq6)) {
        for (const fourth of maxVectorsFor("eq4", eq4)) {
          for (const fifth of maxVectorsFor("eq5", eq5)) {
            candidates.push(first + second + third + fourth + fifth);
          }
        }
      }
    }
  }

  for (const candidate of candidates) {
    const distances = new Map<DistanceMetric, number>();
    let viable = true;

    for (const code of DISTANCE_METRICS) {
      const maxValue = readMaxVectorMetric(candidate, code);

      if (maxValue === null) {
        // eq5's maximal fragments carry no metrics, so a metric missing from
        // the composed vector simply contributes no distance.
        distances.set(code, 0);
        continue;
      }

      const distance =
        levelOf(code, effective(metrics, code)) - levelOf(code, maxValue);

      if (distance < 0) {
        viable = false;
        break;
      }

      distances.set(code, distance);
    }

    if (!viable) {
      continue;
    }

    const at = (code: DistanceMetric): number => distances.get(code) ?? 0;

    return {
      eq1: at("AV") + at("PR") + at("UI"),
      eq2: at("AC") + at("AT"),
      eq3eq6: at("VC") + at("VI") + at("VA") + at("CR") + at("IR") + at("AR"),
      eq4: at("SC") + at("SI") + at("SA"),
    };
  }

  throw new CvssVectorError(
    `No maximal vector dominates MacroVector ${macro}; the lookup data is inconsistent.`,
  );
}

/** Computes the MacroVector one step lower in each equivalence class. */
function nextLowerMacroScores(macro: string): {
  eq1: number | undefined;
  eq2: number | undefined;
  eq3eq6: number | undefined;
  eq4: number | undefined;
  eq5: number | undefined;
} {
  const digits = macro.split("").map((digit) => Number(digit));
  const [eq1 = 0, eq2 = 0, eq3 = 0, eq4 = 0, eq5 = 0, eq6 = 0] = digits;
  const compose = (values: number[]): string => values.join("");
  const scoreOf = (key: string): number | undefined => MACRO_VECTOR_LOOKUP[key];

  const eq3eq6Score = ((): number | undefined => {
    if (eq3 === 0 && eq6 === 0) {
      // Two lower MacroVectors exist; the specification takes the higher score.
      const left = scoreOf(compose([eq1, eq2, eq3, eq4, eq5, eq6 + 1]));
      const right = scoreOf(compose([eq1, eq2, eq3 + 1, eq4, eq5, eq6]));

      if (left === undefined) {
        return right;
      }

      if (right === undefined) {
        return left;
      }

      return Math.max(left, right);
    }

    if (eq3 === 1 && eq6 === 0) {
      return scoreOf(compose([eq1, eq2, eq3, eq4, eq5, eq6 + 1]));
    }

    if (eq3 === 2) {
      return scoreOf(compose([eq1, eq2, eq3 + 1, eq4, eq5, eq6 + 1]));
    }

    return scoreOf(compose([eq1, eq2, eq3 + 1, eq4, eq5, eq6]));
  })();

  return {
    eq1: scoreOf(compose([eq1 + 1, eq2, eq3, eq4, eq5, eq6])),
    eq2: scoreOf(compose([eq1, eq2 + 1, eq3, eq4, eq5, eq6])),
    eq3eq6: eq3eq6Score,
    eq4: scoreOf(compose([eq1, eq2, eq3, eq4 + 1, eq5, eq6])),
    eq5: scoreOf(compose([eq1, eq2, eq3, eq4, eq5 + 1, eq6])),
  };
}

const SEVERITY_DISTANCE_STEP = 0.1;

/**
 * Scores a validated CVSS v4.0 vector.
 *
 * The algorithm is: take the MacroVector's score, then subtract the mean of the
 * proportional distances between this vector and the most severe vector in the
 * same MacroVector, per equivalence class.
 */
export function calculateCvss40(vector: string): CvssScoreResult {
  const metrics = parseCvss40Vector(vector);
  const macro = macroVector(metrics);
  const canonicalVector = buildCvss40Vector(metrics);

  const noImpact = IMPACT_METRICS.every(
    (code) => effective(metrics, code) === "N",
  );

  if (noImpact) {
    return {
      vector: canonicalVector,
      score: 0,
      severity: severityFromScore(0),
      macroVector: macro,
      metrics,
    };
  }

  const macroScore = MACRO_VECTOR_LOOKUP[macro];

  if (macroScore === undefined) {
    throw new CvssVectorError(`MacroVector ${macro} has no defined score.`);
  }

  const [eq1 = "", eq2 = "", eq3 = "", eq4 = "", , eq6 = ""] = macro.split("");
  const distances = severityDistances(metrics, macro);
  const lower = nextLowerMacroScores(macro);

  const contributions: number[] = [];

  const addContribution = (
    lowerScore: number | undefined,
    currentDistance: number,
    maxSeverityDistance: number,
  ): void => {
    if (lowerScore === undefined) {
      return;
    }

    const availableDistance = macroScore - lowerScore;
    const proportion =
      currentDistance / (maxSeverityDistance * SEVERITY_DISTANCE_STEP);

    contributions.push(availableDistance * proportion);
  };

  addContribution(lower.eq1, distances.eq1, maxSeverityFor("eq1", eq1));
  addContribution(lower.eq2, distances.eq2, maxSeverityFor("eq2", eq2));
  addContribution(
    lower.eq3eq6,
    distances.eq3eq6,
    maxSeverityForEq3Eq6(eq3, eq6),
  );
  addContribution(lower.eq4, distances.eq4, maxSeverityFor("eq4", eq4));

  if (lower.eq5 !== undefined) {
    // EQ5 has no severity depth, so it contributes zero while still counting
    // toward the mean.
    contributions.push(0);
  }

  const meanDistance =
    contributions.length === 0
      ? 0
      : contributions.reduce((total, it) => total + it, 0) /
        contributions.length;

  const raw = Math.min(10, Math.max(0, macroScore - meanDistance));
  const score = Math.round(raw * 10) / 10;

  return {
    vector: canonicalVector,
    score,
    severity: severityFromScore(score),
    macroVector: macro,
    metrics,
  };
}

/** Validates a vector without computing a score. */
export function isValidCvss40Vector(vector: string): boolean {
  try {
    parseCvss40Vector(vector);

    return true;
  } catch {
    return false;
  }
}
