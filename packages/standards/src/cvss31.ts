import { severityFromScore, type SeverityRating } from "./severity.js";

/**
 * CVSS v3.1 scoring.
 *
 * Implemented directly from the CVSS v3.1 specification (FIRST.org), including
 * its `roundup` definition, which is not ordinary rounding: it rounds to one
 * decimal place *away from zero* using integer arithmetic, precisely to avoid
 * the floating-point discrepancies that plagued v3.0 implementations.
 *
 * Vendors and programmes still require 3.1 alongside 4.0, so CodeVault keeps
 * both as first-class, independently approved scores.
 */

export const CVSS31_PREFIX = "CVSS:3.1";

export interface CvssMetricValueDefinition {
  code: string;
  label: string;
  description: string;
}

export interface Cvss31MetricDefinition {
  code: string;
  name: string;
  group: "Base" | "Temporal" | "Environmental";
  optional: boolean;
  values: readonly CvssMetricValueDefinition[];
}

const value = (
  code: string,
  label: string,
  description: string,
): CvssMetricValueDefinition => ({ code, label, description });

export const CVSS31_METRICS: readonly Cvss31MetricDefinition[] = [
  {
    code: "AV",
    name: "Attack Vector",
    group: "Base",
    optional: false,
    values: [
      value("N", "Network", "Remotely exploitable across a network."),
      value("A", "Adjacent Network", "Limited to a shared network segment."),
      value("L", "Local", "Requires local access or a local account."),
      value("P", "Physical", "Requires physical access to the component."),
    ],
  },
  {
    code: "AC",
    name: "Attack Complexity",
    group: "Base",
    optional: false,
    values: [
      value("L", "Low", "Repeatable success against the vulnerable component."),
      value("H", "High", "Success depends on conditions outside attacker control."),
    ],
  },
  {
    code: "PR",
    name: "Privileges Required",
    group: "Base",
    optional: false,
    values: [
      value("N", "None", "No authorisation required before the attack."),
      value("L", "Low", "Basic user-level privileges required."),
      value("H", "High", "Administrative or equivalent privileges required."),
    ],
  },
  {
    code: "UI",
    name: "User Interaction",
    group: "Base",
    optional: false,
    values: [
      value("N", "None", "No user other than the attacker is involved."),
      value("R", "Required", "A user must take an action for exploitation."),
    ],
  },
  {
    code: "S",
    name: "Scope",
    group: "Base",
    optional: false,
    values: [
      value("U", "Unchanged", "Impact is confined to the vulnerable component."),
      value("C", "Changed", "Impact reaches beyond the security authority."),
    ],
  },
  {
    code: "C",
    name: "Confidentiality",
    group: "Base",
    optional: false,
    values: [
      value("H", "High", "Total loss of confidentiality."),
      value("L", "Low", "Limited information disclosure."),
      value("N", "None", "No loss of confidentiality."),
    ],
  },
  {
    code: "I",
    name: "Integrity",
    group: "Base",
    optional: false,
    values: [
      value("H", "High", "Total loss of integrity."),
      value("L", "Low", "Limited modification of data."),
      value("N", "None", "No loss of integrity."),
    ],
  },
  {
    code: "A",
    name: "Availability",
    group: "Base",
    optional: false,
    values: [
      value("H", "High", "Total loss of availability."),
      value("L", "Low", "Reduced performance or interruptions."),
      value("N", "None", "No loss of availability."),
    ],
  },
  {
    code: "E",
    name: "Exploit Code Maturity",
    group: "Temporal",
    optional: true,
    values: [
      value("X", "Not Defined", "Skipped in the temporal calculation."),
      value("H", "High", "Reliable, widely available exploit code exists."),
      value("F", "Functional", "Functional exploit code exists."),
      value("P", "Proof-of-Concept", "Proof-of-concept code exists."),
      value("U", "Unproven", "No exploit code is available."),
    ],
  },
  {
    code: "RL",
    name: "Remediation Level",
    group: "Temporal",
    optional: true,
    values: [
      value("X", "Not Defined", "Skipped in the temporal calculation."),
      value("U", "Unavailable", "No remediation is available."),
      value("W", "Workaround", "An unofficial workaround exists."),
      value("T", "Temporary Fix", "An official temporary fix exists."),
      value("O", "Official Fix", "A complete vendor fix is available."),
    ],
  },
  {
    code: "RC",
    name: "Report Confidence",
    group: "Temporal",
    optional: true,
    values: [
      value("X", "Not Defined", "Skipped in the temporal calculation."),
      value("C", "Confirmed", "Detailed reports or reproduction exist."),
      value("R", "Reasonable", "Significant detail but not fully confirmed."),
      value("U", "Unknown", "Reports are unconfirmed or contradictory."),
    ],
  },
  {
    code: "CR",
    name: "Confidentiality Requirement",
    group: "Environmental",
    optional: true,
    values: [
      value("X", "Not Defined", "Treated as Medium."),
      value("H", "High", "Confidentiality loss is catastrophic here."),
      value("M", "Medium", "Confidentiality loss is serious here."),
      value("L", "Low", "Confidentiality loss has limited effect here."),
    ],
  },
  {
    code: "IR",
    name: "Integrity Requirement",
    group: "Environmental",
    optional: true,
    values: [
      value("X", "Not Defined", "Treated as Medium."),
      value("H", "High", "Integrity loss is catastrophic here."),
      value("M", "Medium", "Integrity loss is serious here."),
      value("L", "Low", "Integrity loss has limited effect here."),
    ],
  },
  {
    code: "AR",
    name: "Availability Requirement",
    group: "Environmental",
    optional: true,
    values: [
      value("X", "Not Defined", "Treated as Medium."),
      value("H", "High", "Availability loss is catastrophic here."),
      value("M", "Medium", "Availability loss is serious here."),
      value("L", "Low", "Availability loss has limited effect here."),
    ],
  },
  ...(
    [
      ["MAV", "Modified Attack Vector", ["N", "A", "L", "P"]],
      ["MAC", "Modified Attack Complexity", ["L", "H"]],
      ["MPR", "Modified Privileges Required", ["N", "L", "H"]],
      ["MUI", "Modified User Interaction", ["N", "R"]],
      ["MS", "Modified Scope", ["U", "C"]],
      ["MC", "Modified Confidentiality", ["H", "L", "N"]],
      ["MI", "Modified Integrity", ["H", "L", "N"]],
      ["MA", "Modified Availability", ["H", "L", "N"]],
    ] as const
  ).map(
    ([code, name, codes]): Cvss31MetricDefinition => ({
      code,
      name,
      group: "Environmental",
      optional: true,
      values: [
        value("X", "Not Defined", "Falls back to the corresponding base metric."),
        ...codes.map((it) =>
          value(it, it, `Overrides the base metric with ${it}.`),
        ),
      ],
    }),
  ),
];

export const CVSS31_METRICS_BY_CODE: ReadonlyMap<
  string,
  Cvss31MetricDefinition
> = new Map(CVSS31_METRICS.map((metric) => [metric.code, metric]));

export const CVSS31_MANDATORY_METRICS: readonly string[] =
  CVSS31_METRICS.filter((metric) => !metric.optional).map(
    (metric) => metric.code,
  );

export const CVSS31_METRIC_ORDER: readonly string[] = CVSS31_METRICS.map(
  (metric) => metric.code,
);

export type Cvss31Metrics = Readonly<Record<string, string>>;

export interface Cvss31ScoreResult {
  vector: string;
  /** Base score, always present. */
  baseScore: number;
  /** Temporal score; equals the base score when no temporal metrics are set. */
  temporalScore: number;
  /** Environmental score; equals the temporal score when unmodified. */
  environmentalScore: number;
  /** The score CodeVault displays: the most specific one supplied. */
  score: number;
  severity: SeverityRating;
  metrics: Cvss31Metrics;
}

export class Cvss31VectorError extends Error {
  readonly metric: string | undefined;

  constructor(message: string, metric?: string) {
    super(message);

    this.name = "Cvss31VectorError";
    this.metric = metric;
  }
}

export function parseCvss31Vector(vector: string): Cvss31Metrics {
  const parts = vector.trim().split("/");
  const prefix = parts.shift();

  if (prefix !== CVSS31_PREFIX) {
    throw new Cvss31VectorError(
      `A CVSS v3.1 vector must start with "${CVSS31_PREFIX}".`,
    );
  }

  const metrics = new Map<string, string>();

  for (const part of parts) {
    if (part.length === 0) {
      continue;
    }

    const separator = part.indexOf(":");

    if (separator < 0) {
      throw new Cvss31VectorError(`Malformed vector component "${part}".`);
    }

    const code = part.slice(0, separator);
    const selected = part.slice(separator + 1);
    const definition = CVSS31_METRICS_BY_CODE.get(code);

    if (definition === undefined) {
      throw new Cvss31VectorError(`Unknown CVSS v3.1 metric "${code}".`, code);
    }

    if (metrics.has(code)) {
      throw new Cvss31VectorError(
        `Metric "${code}" appears more than once.`,
        code,
      );
    }

    const isKnownValue = definition.values.some(
      (candidate) => candidate.code === selected,
    );

    if (!isKnownValue) {
      throw new Cvss31VectorError(
        `"${selected}" is not a valid value for ${definition.name}.`,
        code,
      );
    }

    metrics.set(code, selected);
  }

  for (const mandatory of CVSS31_MANDATORY_METRICS) {
    if (!metrics.has(mandatory)) {
      throw new Cvss31VectorError(
        `Vector is missing mandatory metric "${mandatory}".`,
        mandatory,
      );
    }
  }

  return Object.fromEntries(metrics);
}

export function buildCvss31Vector(metrics: Cvss31Metrics): string {
  const parts: string[] = [CVSS31_PREFIX];

  for (const code of CVSS31_METRIC_ORDER) {
    const selected = metrics[code];

    if (selected === undefined || selected === "X") {
      continue;
    }

    parts.push(`${code}:${selected}`);
  }

  return parts.join("/");
}

/**
 * The specification's `Roundup`: round up to one decimal place using integer
 * arithmetic so that, for example, 4.02 becomes 4.1 and 4.00 stays 4.0.
 */
function roundUp(value: number): number {
  const scaled = Math.round(value * 100_000);

  if (scaled % 10_000 === 0) {
    return scaled / 100_000;
  }

  return (Math.floor(scaled / 10_000) + 1) / 10;
}

const AV_WEIGHTS: Readonly<Record<string, number>> = {
  N: 0.85,
  A: 0.62,
  L: 0.55,
  P: 0.2,
};

const AC_WEIGHTS: Readonly<Record<string, number>> = { L: 0.77, H: 0.44 };

const PR_WEIGHTS_UNCHANGED: Readonly<Record<string, number>> = {
  N: 0.85,
  L: 0.62,
  H: 0.27,
};

const PR_WEIGHTS_CHANGED: Readonly<Record<string, number>> = {
  N: 0.85,
  L: 0.68,
  H: 0.5,
};

const UI_WEIGHTS: Readonly<Record<string, number>> = { N: 0.85, R: 0.62 };

const CIA_WEIGHTS: Readonly<Record<string, number>> = {
  H: 0.56,
  L: 0.22,
  N: 0,
};

const E_WEIGHTS: Readonly<Record<string, number>> = {
  X: 1,
  H: 1,
  F: 0.97,
  P: 0.94,
  U: 0.91,
};

const RL_WEIGHTS: Readonly<Record<string, number>> = {
  X: 1,
  U: 1,
  W: 0.97,
  T: 0.96,
  O: 0.95,
};

const RC_WEIGHTS: Readonly<Record<string, number>> = {
  X: 1,
  C: 1,
  R: 0.96,
  U: 0.92,
};

const REQUIREMENT_WEIGHTS: Readonly<Record<string, number>> = {
  X: 1,
  H: 1.5,
  M: 1,
  L: 0.5,
};

function weight(
  table: Readonly<Record<string, number>>,
  code: string,
  metricValue: string,
): number {
  const result = table[metricValue];

  if (result === undefined) {
    throw new Cvss31VectorError(
      `Value "${metricValue}" has no weight for metric "${code}".`,
      code,
    );
  }

  return result;
}

/** Resolves a base metric, honouring its Modified environmental override. */
function modified(metrics: Cvss31Metrics, code: string): string {
  const override = metrics[`M${code}`];

  if (override !== undefined && override !== "X") {
    return override;
  }

  const base = metrics[code];

  if (base === undefined) {
    throw new Cvss31VectorError(`Missing metric "${code}".`, code);
  }

  return base;
}

interface ScoreInputs {
  attackVector: string;
  attackComplexity: string;
  privilegesRequired: string;
  userInteraction: string;
  scope: string;
  confidentiality: string;
  integrity: string;
  availability: string;
}

function exploitability(inputs: ScoreInputs): number {
  const privilegeWeights =
    inputs.scope === "C" ? PR_WEIGHTS_CHANGED : PR_WEIGHTS_UNCHANGED;

  return (
    8.22 *
    weight(AV_WEIGHTS, "AV", inputs.attackVector) *
    weight(AC_WEIGHTS, "AC", inputs.attackComplexity) *
    weight(privilegeWeights, "PR", inputs.privilegesRequired) *
    weight(UI_WEIGHTS, "UI", inputs.userInteraction)
  );
}

interface SecurityRequirements {
  confidentiality: number;
  integrity: number;
  availability: number;
}

/**
 * Impact sub-score.
 *
 * v3.1 deliberately uses a different scope-changed curve for the environmental
 * score than for the base score, so the caller states which one it wants rather
 * than the two sharing a formula that is only correct for one of them.
 */
function impactSubScore(
  inputs: ScoreInputs,
  requirements: SecurityRequirements,
  variant: "BASE" | "ENVIRONMENTAL",
): number {
  const confidentiality =
    weight(CIA_WEIGHTS, "C", inputs.confidentiality) *
    requirements.confidentiality;
  const integrity =
    weight(CIA_WEIGHTS, "I", inputs.integrity) * requirements.integrity;
  const availability =
    weight(CIA_WEIGHTS, "A", inputs.availability) * requirements.availability;

  // The weighted product is capped at 0.915; without a cap the security
  // requirement multipliers could push it above 1.
  const combined = Math.min(
    0.915,
    1 - (1 - confidentiality) * (1 - integrity) * (1 - availability),
  );

  if (inputs.scope === "U") {
    return 6.42 * combined;
  }

  if (variant === "BASE") {
    return 7.52 * (combined - 0.029) - 3.25 * Math.pow(combined - 0.02, 15);
  }

  return (
    7.52 * (combined - 0.029) -
    3.25 * Math.pow(combined * 0.9731 - 0.02, 13)
  );
}

function composeScore(
  impact: number,
  exploit: number,
  scope: string,
): number {
  if (impact <= 0) {
    return 0;
  }

  if (scope === "U") {
    return roundUp(Math.min(impact + exploit, 10));
  }

  return roundUp(Math.min(1.08 * (impact + exploit), 10));
}

export function calculateCvss31(vector: string): Cvss31ScoreResult {
  const metrics = parseCvss31Vector(vector);
  const canonicalVector = buildCvss31Vector(metrics);

  const baseInputs: ScoreInputs = {
    attackVector: metrics.AV ?? "N",
    attackComplexity: metrics.AC ?? "L",
    privilegesRequired: metrics.PR ?? "N",
    userInteraction: metrics.UI ?? "N",
    scope: metrics.S ?? "U",
    confidentiality: metrics.C ?? "N",
    integrity: metrics.I ?? "N",
    availability: metrics.A ?? "N",
  };

  const unweighted = { confidentiality: 1, integrity: 1, availability: 1 };
  const baseImpact = impactSubScore(baseInputs, unweighted, "BASE");
  const baseScore = composeScore(
    baseImpact,
    exploitability(baseInputs),
    baseInputs.scope,
  );

  const temporalMultiplier =
    weight(E_WEIGHTS, "E", metrics.E ?? "X") *
    weight(RL_WEIGHTS, "RL", metrics.RL ?? "X") *
    weight(RC_WEIGHTS, "RC", metrics.RC ?? "X");
  const temporalScore = roundUp(baseScore * temporalMultiplier);

  const environmentalInputs: ScoreInputs = {
    attackVector: modified(metrics, "AV"),
    attackComplexity: modified(metrics, "AC"),
    privilegesRequired: modified(metrics, "PR"),
    userInteraction: modified(metrics, "UI"),
    scope: modified(metrics, "S"),
    confidentiality: modified(metrics, "C"),
    integrity: modified(metrics, "I"),
    availability: modified(metrics, "A"),
  };
  const environmentalImpact = impactSubScore(
    environmentalInputs,
    {
      confidentiality: weight(REQUIREMENT_WEIGHTS, "CR", metrics.CR ?? "X"),
      integrity: weight(REQUIREMENT_WEIGHTS, "IR", metrics.IR ?? "X"),
      availability: weight(REQUIREMENT_WEIGHTS, "AR", metrics.AR ?? "X"),
    },
    "ENVIRONMENTAL",
  );
  const modifiedScore = composeScore(
    environmentalImpact,
    exploitability(environmentalInputs),
    environmentalInputs.scope,
  );
  const environmentalScore = roundUp(modifiedScore * temporalMultiplier);

  const hasEnvironmental = CVSS31_METRICS.filter(
    (metric) => metric.group === "Environmental",
  ).some((metric) => {
    const selected = metrics[metric.code];

    return selected !== undefined && selected !== "X";
  });
  const hasTemporal = ["E", "RL", "RC"].some((code) => {
    const selected = metrics[code];

    return selected !== undefined && selected !== "X";
  });

  const score = hasEnvironmental
    ? environmentalScore
    : hasTemporal
      ? temporalScore
      : baseScore;

  return {
    vector: canonicalVector,
    baseScore,
    temporalScore,
    environmentalScore,
    score,
    severity: severityFromScore(score),
    metrics,
  };
}

export function isValidCvss31Vector(vector: string): boolean {
  try {
    parseCvss31Vector(vector);

    return true;
  } catch {
    return false;
  }
}
