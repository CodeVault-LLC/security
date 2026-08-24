import type { AlternativeMetricDefinition } from "./cwss10.js";

/** CERT/CC SSVC Coordinator Publish decision tree v2.0.0. */
export const SSVC_COORDINATOR_PUBLISH_PREFIX = "SSVCv2/COORDINATOR-PUBLISH";

export const SSVC_COORDINATOR_PUBLISH_METRICS: readonly AlternativeMetricDefinition[] =
  [
    {
      code: "SI",
      name: "Supplier Involvement",
      group: "Coordinator Publish",
      values: [
        { code: "F", label: "Fix ready", weight: 0 },
        { code: "C", label: "Cooperative", weight: 0 },
        { code: "U", label: "Uncooperative / unresponsive", weight: 0 },
      ],
    },
    {
      code: "E",
      name: "Exploitation",
      group: "Coordinator Publish",
      values: [
        { code: "N", label: "None", weight: 0 },
        { code: "P", label: "Proof of concept", weight: 0 },
        { code: "A", label: "Active", weight: 0 },
      ],
    },
    {
      code: "VA",
      name: "Value Added",
      group: "Coordinator Publish",
      values: [
        { code: "P", label: "Precedence", weight: 0 },
        { code: "A", label: "Ampliative", weight: 0 },
        { code: "L", label: "Limited", weight: 0 },
      ],
    },
  ] as const;

const METRICS_BY_CODE = new Map(
  SSVC_COORDINATOR_PUBLISH_METRICS.map((definition) => [
    definition.code,
    definition,
  ]),
);

export type SsvcPublishDecision = "PUBLISH" | "DO_NOT_PUBLISH";

export class SsvcVectorError extends Error {
  constructor(
    message: string,
    readonly metric?: string,
  ) {
    super(message);
    this.name = "SsvcVectorError";
  }
}

export interface SsvcCoordinatorPublishResult {
  vector: string;
  score: null;
  decision: SsvcPublishDecision;
  metrics: Record<string, string>;
}

export function buildSsvcCoordinatorPublishVector(
  metrics: Record<string, string>,
): string {
  const parts = SSVC_COORDINATOR_PUBLISH_METRICS.map((definition) => {
    const value = metrics[definition.code];

    if (!definition.values.some((candidate) => candidate.code === value)) {
      throw new SsvcVectorError(
        `SSVC decision point ${definition.code} has an invalid value.`,
        definition.code,
      );
    }

    return `${definition.code}:${value}`;
  });

  return `${SSVC_COORDINATOR_PUBLISH_PREFIX}/${parts.join("/")}`;
}

function parseVector(vector: string): Record<string, string> {
  const parts = vector.trim().split("/");
  const prefix = `${parts.shift() ?? ""}/${parts.shift() ?? ""}`;

  if (prefix !== SSVC_COORDINATOR_PUBLISH_PREFIX) {
    throw new SsvcVectorError(
      `An SSVC Coordinator Publish vector must start with "${SSVC_COORDINATOR_PUBLISH_PREFIX}".`,
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
      throw new SsvcVectorError(`Invalid SSVC decision point "${part}".`, code);
    }

    if (metrics[code] !== undefined) {
      throw new SsvcVectorError(
        `SSVC decision point ${code} appears more than once.`,
        code,
      );
    }

    if (!definition.values.some((candidate) => candidate.code === value)) {
      throw new SsvcVectorError(
        `SSVC decision point ${code} does not accept value "${value}".`,
        code,
      );
    }

    metrics[code] = value;
  }

  for (const definition of SSVC_COORDINATOR_PUBLISH_METRICS) {
    if (metrics[definition.code] === undefined) {
      throw new SsvcVectorError(
        `SSVC decision point ${definition.code} is mandatory.`,
        definition.code,
      );
    }
  }

  return metrics;
}

export function calculateSsvcCoordinatorPublish(
  vector: string,
): SsvcCoordinatorPublishResult {
  const metrics = parseVector(vector);
  const supplier = metrics.SI;
  const exploitation = metrics.E;
  const valueAdded = metrics.VA;
  const publish =
    valueAdded === "P" ||
    (valueAdded === "A" &&
      (exploitation === "A" || (supplier === "U" && exploitation === "P"))) ||
    (valueAdded === "L" && supplier === "U" && exploitation === "A");

  return {
    vector: buildSsvcCoordinatorPublishVector(metrics),
    score: null,
    decision: publish ? "PUBLISH" : "DO_NOT_PUBLISH",
    metrics,
  };
}
