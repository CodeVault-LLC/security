/**
 * MITRE Common Weakness Scoring System (CWSS) 1.0.
 *
 * CWSS measures software weaknesses on a 0-100 scale. It is intentionally kept
 * separate from CVSS: the two systems describe different things and their
 * qualitative bands are not interchangeable.
 */

export interface AlternativeMetricValue {
  code: string;
  label: string;
  weight: number;
  description?: string;
}

export interface AlternativeMetricDefinition {
  code: string;
  name: string;
  group: string;
  optional?: boolean;
  values: readonly AlternativeMetricValue[];
}

const common = {
  unknown: { code: "UK", label: "Unknown", weight: 0.5 },
  notApplicable: { code: "NA", label: "Not applicable", weight: 1 },
} as const;

export const CWSS10_METRICS: readonly AlternativeMetricDefinition[] = [
  {
    code: "TI",
    name: "Technical Impact",
    group: "Base Finding",
    values: [
      { code: "C", label: "Critical", weight: 1 },
      { code: "H", label: "High", weight: 0.9 },
      { code: "M", label: "Medium", weight: 0.6 },
      { code: "L", label: "Low", weight: 0.3 },
      { code: "N", label: "None", weight: 0 },
      { code: "D", label: "Default", weight: 0.6 },
      common.unknown,
      common.notApplicable,
    ],
  },
  {
    code: "AP",
    name: "Acquired Privilege",
    group: "Base Finding",
    values: [
      { code: "A", label: "Administrator", weight: 1 },
      { code: "P", label: "Partially privileged user", weight: 0.9 },
      { code: "RU", label: "Regular user", weight: 0.7 },
      { code: "L", label: "Limited / guest", weight: 0.6 },
      { code: "N", label: "None", weight: 0.1 },
      { code: "D", label: "Default", weight: 0.7 },
      common.unknown,
      common.notApplicable,
    ],
  },
  {
    code: "AL",
    name: "Acquired Privilege Layer",
    group: "Base Finding",
    values: [
      { code: "A", label: "Application", weight: 1 },
      { code: "S", label: "System", weight: 0.9 },
      { code: "N", label: "Network", weight: 0.7 },
      { code: "E", label: "Enterprise infrastructure", weight: 1 },
      { code: "D", label: "Default", weight: 0.9 },
      common.unknown,
      common.notApplicable,
    ],
  },
  {
    code: "IC",
    name: "Internal Control Effectiveness",
    group: "Base Finding",
    values: [
      { code: "N", label: "None", weight: 1 },
      { code: "L", label: "Limited", weight: 0.9 },
      { code: "M", label: "Moderate", weight: 0.7 },
      { code: "I", label: "Indirect / defense in depth", weight: 0.5 },
      { code: "B", label: "Best available", weight: 0.3 },
      { code: "C", label: "Complete", weight: 0 },
      { code: "D", label: "Default", weight: 0.6 },
      common.unknown,
      common.notApplicable,
    ],
  },
  {
    code: "FC",
    name: "Finding Confidence",
    group: "Base Finding",
    values: [
      { code: "T", label: "Proven true", weight: 1 },
      { code: "LT", label: "Proven locally true", weight: 0.8 },
      { code: "F", label: "Proven false", weight: 0 },
      { code: "D", label: "Default", weight: 0.8 },
      common.unknown,
      common.notApplicable,
    ],
  },
  {
    code: "RP",
    name: "Required Privilege",
    group: "Attack Surface",
    values: [
      { code: "N", label: "None", weight: 1 },
      { code: "L", label: "Limited / guest", weight: 0.9 },
      { code: "RU", label: "Regular user", weight: 0.7 },
      { code: "P", label: "Partially privileged user", weight: 0.6 },
      { code: "A", label: "Administrator", weight: 0.1 },
      { code: "D", label: "Default", weight: 0.7 },
      common.unknown,
      common.notApplicable,
    ],
  },
  {
    code: "RL",
    name: "Required Privilege Layer",
    group: "Attack Surface",
    values: [
      { code: "A", label: "Application", weight: 1 },
      { code: "S", label: "System", weight: 0.9 },
      { code: "N", label: "Network", weight: 0.7 },
      { code: "E", label: "Enterprise infrastructure", weight: 1 },
      { code: "D", label: "Default", weight: 0.9 },
      common.unknown,
      common.notApplicable,
    ],
  },
  {
    code: "AV",
    name: "Access Vector",
    group: "Attack Surface",
    values: [
      { code: "I", label: "Internet", weight: 1 },
      { code: "R", label: "Intranet", weight: 0.8 },
      { code: "V", label: "Private network", weight: 0.8 },
      { code: "A", label: "Adjacent network", weight: 0.7 },
      { code: "L", label: "Local", weight: 0.5 },
      { code: "P", label: "Physical", weight: 0.2 },
      { code: "D", label: "Default", weight: 0.75 },
      { code: "U", label: "Unknown", weight: 0.5 },
      common.notApplicable,
    ],
  },
  {
    code: "AS",
    name: "Authentication Strength",
    group: "Attack Surface",
    values: [
      { code: "S", label: "Strong", weight: 0.7 },
      { code: "M", label: "Moderate", weight: 0.8 },
      { code: "W", label: "Weak", weight: 0.9 },
      { code: "N", label: "None", weight: 1 },
      { code: "D", label: "Default", weight: 0.85 },
      common.unknown,
      common.notApplicable,
    ],
  },
  {
    code: "IN",
    name: "Level of Interaction",
    group: "Attack Surface",
    values: [
      { code: "A", label: "Automated", weight: 1 },
      { code: "T", label: "Typical / limited", weight: 0.9 },
      { code: "M", label: "Moderate", weight: 0.8 },
      { code: "O", label: "Opportunistic", weight: 0.3 },
      { code: "H", label: "High", weight: 0.1 },
      { code: "NI", label: "No interaction", weight: 0 },
      { code: "D", label: "Default", weight: 0.55 },
      common.unknown,
      common.notApplicable,
    ],
  },
  {
    code: "SC",
    name: "Deployment Scope",
    group: "Attack Surface",
    values: [
      { code: "A", label: "All", weight: 1 },
      { code: "M", label: "Moderate", weight: 0.9 },
      { code: "R", label: "Rare", weight: 0.5 },
      { code: "P", label: "Potentially reachable", weight: 0.1 },
      { code: "D", label: "Default", weight: 0.7 },
      common.unknown,
      common.notApplicable,
    ],
  },
  {
    code: "BI",
    name: "Business Impact",
    group: "Environmental",
    values: [
      { code: "C", label: "Critical", weight: 1 },
      { code: "H", label: "High", weight: 0.9 },
      { code: "M", label: "Medium", weight: 0.6 },
      { code: "L", label: "Low", weight: 0.3 },
      { code: "N", label: "None", weight: 0 },
      { code: "D", label: "Default", weight: 0.6 },
      common.unknown,
      common.notApplicable,
    ],
  },
  {
    code: "DI",
    name: "Likelihood of Discovery",
    group: "Environmental",
    values: [
      { code: "H", label: "High", weight: 1 },
      { code: "M", label: "Medium", weight: 0.6 },
      { code: "L", label: "Low", weight: 0.2 },
      { code: "D", label: "Default", weight: 0.6 },
      common.unknown,
      common.notApplicable,
    ],
  },
  {
    code: "EX",
    name: "Likelihood of Exploit",
    group: "Environmental",
    values: [
      { code: "H", label: "High", weight: 1 },
      { code: "M", label: "Medium", weight: 0.6 },
      { code: "L", label: "Low", weight: 0.2 },
      { code: "N", label: "None", weight: 0 },
      { code: "D", label: "Default", weight: 0.6 },
      common.unknown,
      common.notApplicable,
    ],
  },
  {
    code: "EC",
    name: "External Control Effectiveness",
    group: "Environmental",
    values: [
      { code: "N", label: "None", weight: 1 },
      { code: "L", label: "Limited", weight: 0.9 },
      { code: "M", label: "Moderate", weight: 0.7 },
      { code: "I", label: "Indirect / defense in depth", weight: 0.5 },
      { code: "B", label: "Best available", weight: 0.3 },
      { code: "C", label: "Complete", weight: 0.1 },
      { code: "D", label: "Default", weight: 0.6 },
      common.unknown,
      common.notApplicable,
    ],
  },
  {
    code: "P",
    name: "Prevalence",
    group: "Environmental",
    values: [
      { code: "W", label: "Widespread", weight: 1 },
      { code: "H", label: "High", weight: 0.9 },
      { code: "C", label: "Common", weight: 0.8 },
      { code: "L", label: "Limited", weight: 0.7 },
      { code: "D", label: "Default", weight: 0.85 },
      common.unknown,
      common.notApplicable,
    ],
  },
] as const;

const METRICS_BY_CODE = new Map(
  CWSS10_METRICS.map((metric) => [metric.code, metric]),
);

export class Cwss10VectorError extends Error {
  constructor(
    message: string,
    readonly metric?: string,
  ) {
    super(message);
    this.name = "Cwss10VectorError";
  }
}

export interface Cwss10Result {
  vector: string;
  score: number;
  baseFindingScore: number;
  attackSurfaceScore: number;
  environmentalScore: number;
  metrics: Record<string, string>;
  weights: Record<string, number>;
}

function canonicalWeight(weight: number): string {
  const compact = String(weight);
  return compact.includes(".") ? compact : `${compact}.0`;
}

export function buildCwss10Vector(metrics: Record<string, string>): string {
  const parts = CWSS10_METRICS.map((definition) => {
    const code = metrics[definition.code];
    const value = definition.values.find(
      (candidate) => candidate.code === code,
    );

    if (value === undefined) {
      throw new Cwss10VectorError(
        `CWSS metric ${definition.code} has an invalid value.`,
        definition.code,
      );
    }

    return `${definition.code}:${value.code},${canonicalWeight(value.weight)}`;
  });

  return `(${parts.join("/")})`;
}

export function parseCwss10Vector(vector: string): {
  vector: string;
  metrics: Record<string, string>;
  weights: Record<string, number>;
} {
  const trimmed = vector.trim();
  const body =
    trimmed.startsWith("(") && trimmed.endsWith(")")
      ? trimmed.slice(1, -1)
      : trimmed;
  const metrics: Record<string, string> = {};
  const weights: Record<string, number> = {};

  for (const part of body.split("/")) {
    const match =
      /^([A-Z]{1,2}):([A-Z]{1,2}),((?:0(?:\.\d+)?)|(?:1(?:\.0+)?))$/u.exec(
        part,
      );

    if (match === null) {
      throw new Cwss10VectorError(
        `Invalid CWSS factor "${part}"; expected CODE:VALUE,WEIGHT.`,
      );
    }

    const [, code, valueCode, weightText] = match;
    const definition =
      code === undefined ? undefined : METRICS_BY_CODE.get(code);

    if (
      code === undefined ||
      definition === undefined ||
      valueCode === undefined ||
      weightText === undefined
    ) {
      throw new Cwss10VectorError(`Unknown CWSS metric "${code ?? ""}".`, code);
    }

    if (metrics[code] !== undefined) {
      throw new Cwss10VectorError(
        `CWSS metric ${code} appears more than once.`,
        code,
      );
    }

    if (!definition.values.some((value) => value.code === valueCode)) {
      throw new Cwss10VectorError(
        `CWSS metric ${code} does not accept value "${valueCode}".`,
        code,
      );
    }

    metrics[code] = valueCode;
    weights[code] = Number(weightText);
  }

  for (const definition of CWSS10_METRICS) {
    if (metrics[definition.code] === undefined) {
      throw new Cwss10VectorError(
        `CWSS metric ${definition.code} is mandatory.`,
        definition.code,
      );
    }
  }

  const canonical = `(${CWSS10_METRICS.map(
    (definition) =>
      `${definition.code}:${metrics[definition.code]},${canonicalWeight(weights[definition.code] ?? 0)}`,
  ).join("/")})`;

  return { vector: canonical, metrics, weights };
}

function roundOne(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

export function calculateCwss10(vector: string): Cwss10Result {
  const parsed = parseCwss10Vector(vector);
  const weight = (code: string): number => parsed.weights[code] ?? 0;
  const nonZero = (code: string): number => (weight(code) === 0 ? 0 : 1);

  const baseFindingScore =
    (10 * weight("TI") + 5 * (weight("AP") + weight("AL")) + 5 * weight("FC")) *
    nonZero("TI") *
    weight("IC") *
    4;
  const attackSurfaceScore =
    (20 * (weight("RP") + weight("RL") + weight("AV")) +
      20 * weight("SC") +
      15 * weight("IN") +
      5 * weight("AS")) /
    100;
  const environmentalScore =
    ((10 * weight("BI") +
      3 * weight("DI") +
      4 * weight("EX") +
      3 * weight("P")) *
      nonZero("BI") *
      weight("EC")) /
    20;

  return {
    ...parsed,
    score: roundOne(baseFindingScore * attackSurfaceScore * environmentalScore),
    baseFindingScore: roundOne(baseFindingScore),
    attackSurfaceScore: roundOne(attackSurfaceScore * 100) / 100,
    environmentalScore: roundOne(environmentalScore * 100) / 100,
  };
}
