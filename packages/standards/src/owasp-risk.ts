import type { AlternativeMetricDefinition } from "./cwss10.js";

/** OWASP Risk Rating Methodology, serialized as a CodeVault vector. */
export const OWASP_RISK_PREFIX = "OWASP-RR:1.0";

const metric = (
  code: string,
  name: string,
  group: string,
  values: readonly [string, string, number][],
  optional = false,
): AlternativeMetricDefinition => ({
  code,
  name,
  group,
  optional,
  values: values.map(([valueCode, label, weight]) => ({
    code: valueCode,
    label,
    weight,
  })),
});

export const OWASP_RISK_METRICS: readonly AlternativeMetricDefinition[] = [
  metric("SL", "Skill Level", "Threat Agent", [
    ["NT", "No technical skills", 1],
    ["ST", "Some technical skills", 3],
    ["AU", "Advanced computer user", 5],
    ["NP", "Network and programming skills", 6],
    ["SP", "Security penetration skills", 9],
  ]),
  metric("M", "Motive", "Threat Agent", [
    ["L", "Low or no reward", 1],
    ["P", "Possible reward", 4],
    ["H", "High reward", 9],
  ]),
  metric("O", "Opportunity", "Threat Agent", [
    ["F", "Full access or expensive resources required", 0],
    ["S", "Special access or resources required", 4],
    ["A", "Some access or resources required", 7],
    ["N", "No access or resources required", 9],
  ]),
  metric("SZ", "Threat Agent Size", "Threat Agent", [
    ["D", "Developers", 2],
    ["SA", "System administrators", 2],
    ["I", "Intranet users", 4],
    ["P", "Partners", 5],
    ["AU", "Authenticated users", 6],
    ["AN", "Anonymous Internet users", 9],
  ]),
  metric("ED", "Ease of Discovery", "Vulnerability", [
    ["I", "Practically impossible", 1],
    ["D", "Difficult", 3],
    ["E", "Easy", 7],
    ["A", "Automated tools available", 9],
  ]),
  metric("EE", "Ease of Exploit", "Vulnerability", [
    ["T", "Theoretical", 1],
    ["D", "Difficult", 3],
    ["E", "Easy", 5],
    ["A", "Automated tools available", 9],
  ]),
  metric("AW", "Awareness", "Vulnerability", [
    ["U", "Unknown", 1],
    ["H", "Hidden", 4],
    ["O", "Obvious", 6],
    ["P", "Public knowledge", 9],
  ]),
  metric("ID", "Intrusion Detection", "Vulnerability", [
    ["A", "Active detection in application", 1],
    ["R", "Logged and reviewed", 3],
    ["L", "Logged without review", 8],
    ["N", "Not logged", 9],
  ]),
  metric("LC", "Loss of Confidentiality", "Technical Impact", [
    ["MN", "Minimal non-sensitive data disclosed", 2],
    ["MC", "Minimal critical data disclosed", 6],
    ["EN", "Extensive non-sensitive data disclosed", 6],
    ["EC", "Extensive critical data disclosed", 7],
    ["A", "All data disclosed", 9],
  ]),
  metric("LI", "Loss of Integrity", "Technical Impact", [
    ["MS", "Minimal slightly corrupt data", 1],
    ["MC", "Minimal seriously corrupt data", 3],
    ["ES", "Extensive slightly corrupt data", 5],
    ["EC", "Extensive seriously corrupt data", 7],
    ["A", "All data totally corrupt", 9],
  ]),
  metric("LA", "Loss of Availability", "Technical Impact", [
    ["MS", "Minimal secondary services interrupted", 1],
    ["MP", "Minimal primary services interrupted", 5],
    ["ES", "Extensive secondary services interrupted", 5],
    ["EP", "Extensive primary services interrupted", 7],
    ["A", "All services completely lost", 9],
  ]),
  metric("LAC", "Loss of Accountability", "Technical Impact", [
    ["F", "Fully traceable", 1],
    ["P", "Possibly traceable", 7],
    ["A", "Completely anonymous", 9],
  ]),
  metric(
    "FD",
    "Financial Damage",
    "Business Impact",
    [
      ["X", "Not assessed", 0],
      ["L", "Less than the cost to fix", 1],
      ["M", "Minor effect on annual profit", 3],
      ["S", "Significant effect on annual profit", 7],
      ["B", "Bankruptcy", 9],
    ],
    true,
  ),
  metric(
    "RD",
    "Reputation Damage",
    "Business Impact",
    [
      ["X", "Not assessed", 0],
      ["M", "Minimal damage", 1],
      ["A", "Loss of major accounts", 4],
      ["G", "Loss of goodwill", 5],
      ["B", "Brand damage", 9],
    ],
    true,
  ),
  metric(
    "NC",
    "Non-compliance",
    "Business Impact",
    [
      ["X", "Not assessed", 0],
      ["M", "Minor violation", 2],
      ["C", "Clear violation", 5],
      ["H", "High-profile violation", 7],
    ],
    true,
  ),
  metric(
    "PV",
    "Privacy Violation",
    "Business Impact",
    [
      ["X", "Not assessed", 0],
      ["O", "One individual", 3],
      ["H", "Hundreds of people", 5],
      ["T", "Thousands of people", 7],
      ["M", "Millions of people", 9],
    ],
    true,
  ),
] as const;

const METRICS_BY_CODE = new Map(
  OWASP_RISK_METRICS.map((definition) => [definition.code, definition]),
);

export type OwaspRiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type OwaspRiskRating = "NOTE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export class OwaspRiskVectorError extends Error {
  constructor(
    message: string,
    readonly metric?: string,
  ) {
    super(message);
    this.name = "OwaspRiskVectorError";
  }
}

export interface OwaspRiskResult {
  vector: string;
  score: null;
  rating: OwaspRiskRating;
  likelihood: number;
  technicalImpact: number;
  businessImpact: number | null;
  selectedImpact: number;
  impactBasis: "TECHNICAL" | "BUSINESS";
  metrics: Record<string, string>;
}

export function buildOwaspRiskVector(metrics: Record<string, string>): string {
  const parts: string[] = [];

  for (const definition of OWASP_RISK_METRICS) {
    const value = metrics[definition.code];

    if (definition.optional === true && value === "X") {
      continue;
    }

    if (!definition.values.some((candidate) => candidate.code === value)) {
      throw new OwaspRiskVectorError(
        `OWASP metric ${definition.code} has an invalid value.`,
        definition.code,
      );
    }

    parts.push(`${definition.code}:${value}`);
  }

  return `${OWASP_RISK_PREFIX}/${parts.join("/")}`;
}

function parseVector(vector: string): Record<string, string> {
  const parts = vector.trim().split("/");

  if (parts.shift() !== OWASP_RISK_PREFIX) {
    throw new OwaspRiskVectorError(
      `An OWASP Risk Rating vector must start with "${OWASP_RISK_PREFIX}".`,
    );
  }

  const metrics: Record<string, string> = {};

  for (const part of parts) {
    const [code, value, extra] = part.split(":");
    const definition =
      code === undefined ? undefined : METRICS_BY_CODE.get(code);

    if (
      code === undefined ||
      definition === undefined ||
      value === undefined ||
      extra !== undefined
    ) {
      throw new OwaspRiskVectorError(`Invalid OWASP metric "${part}".`, code);
    }

    if (metrics[code] !== undefined) {
      throw new OwaspRiskVectorError(
        `OWASP metric ${code} appears more than once.`,
        code,
      );
    }

    if (!definition.values.some((candidate) => candidate.code === value)) {
      throw new OwaspRiskVectorError(
        `OWASP metric ${code} does not accept value "${value}".`,
        code,
      );
    }

    metrics[code] = value;
  }

  for (const definition of OWASP_RISK_METRICS) {
    if (
      definition.optional !== true &&
      metrics[definition.code] === undefined
    ) {
      throw new OwaspRiskVectorError(
        `OWASP metric ${definition.code} is mandatory.`,
        definition.code,
      );
    }
  }

  const suppliedBusinessMetrics = OWASP_RISK_METRICS.filter(
    (definition) => definition.optional === true,
  ).filter((definition) => metrics[definition.code] !== undefined);

  if (
    suppliedBusinessMetrics.length !== 0 &&
    suppliedBusinessMetrics.length !== 4
  ) {
    throw new OwaspRiskVectorError(
      "OWASP business-impact metrics must be supplied together or omitted together.",
    );
  }

  return metrics;
}

function average(
  metrics: Record<string, string>,
  codes: readonly string[],
): number {
  const sum = codes.reduce((total, code) => {
    const definition = METRICS_BY_CODE.get(code);
    const selected = definition?.values.find(
      (value) => value.code === metrics[code],
    );

    if (selected === undefined) {
      throw new OwaspRiskVectorError(`OWASP metric ${code} is missing.`, code);
    }

    return total + selected.weight;
  }, 0);

  return Math.round((sum / codes.length + Number.EPSILON) * 1000) / 1000;
}

function level(value: number): OwaspRiskLevel {
  return value < 3 ? "LOW" : value < 6 ? "MEDIUM" : "HIGH";
}

const RATING_MATRIX: Record<
  OwaspRiskLevel,
  Record<OwaspRiskLevel, OwaspRiskRating>
> = {
  LOW: { LOW: "NOTE", MEDIUM: "LOW", HIGH: "MEDIUM" },
  MEDIUM: { LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" },
  HIGH: { LOW: "MEDIUM", MEDIUM: "HIGH", HIGH: "CRITICAL" },
};

export function calculateOwaspRisk(vector: string): OwaspRiskResult {
  const metrics = parseVector(vector);
  const likelihood = average(metrics, [
    "SL",
    "M",
    "O",
    "SZ",
    "ED",
    "EE",
    "AW",
    "ID",
  ]);
  const technicalImpact = average(metrics, ["LC", "LI", "LA", "LAC"]);
  const hasBusinessImpact = metrics.FD !== undefined;
  const businessImpact = hasBusinessImpact
    ? average(metrics, ["FD", "RD", "NC", "PV"])
    : null;
  const selectedImpact = businessImpact ?? technicalImpact;
  const likelihoodLevel = level(likelihood);
  const impactLevel = level(selectedImpact);

  return {
    vector: buildOwaspRiskVector(
      Object.fromEntries(
        OWASP_RISK_METRICS.map((definition) => [
          definition.code,
          metrics[definition.code] ?? "X",
        ]),
      ),
    ),
    score: null,
    rating: RATING_MATRIX[impactLevel][likelihoodLevel],
    likelihood,
    technicalImpact,
    businessImpact,
    selectedImpact,
    impactBasis: businessImpact === null ? "TECHNICAL" : "BUSINESS",
    metrics,
  };
}
