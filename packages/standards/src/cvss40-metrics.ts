/**
 * CVSS v4.0 metric definitions.
 *
 * The UI drives its metric-by-metric editor from this table, and the parser
 * validates against it, so an unknown metric or value can never reach scoring.
 */

export interface CvssMetricValue {
  code: string;
  label: string;
  description: string;
}

export interface CvssMetricDefinition {
  code: string;
  name: string;
  group: string;
  /** Optional metrics may be omitted from the vector string. */
  optional: boolean;
  values: readonly CvssMetricValue[];
}

const value = (
  code: string,
  label: string,
  description: string,
): CvssMetricValue => ({ code, label, description });

export const CVSS40_METRICS: readonly CvssMetricDefinition[] = [
  {
    code: "AV",
    name: "Attack Vector",
    group: "Base",
    optional: false,
    values: [
      value("N", "Network", "Remotely exploitable across a network."),
      value(
        "A",
        "Adjacent",
        "Limited to a shared logical or physical network.",
      ),
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
      value("L", "Low", "No evasion of security-hardening measures required."),
      value("H", "High", "The attacker must defeat a hardening mechanism."),
    ],
  },
  {
    code: "AT",
    name: "Attack Requirements",
    group: "Base",
    optional: false,
    values: [
      value("N", "None", "No deployment or execution conditions required."),
      value(
        "P",
        "Present",
        "A specific deployment or race condition is needed.",
      ),
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
      value("N", "None", "No human other than the attacker is involved."),
      value("P", "Passive", "Limited, unwitting user interaction is required."),
      value(
        "A",
        "Active",
        "The user must perform a specific, conscious action.",
      ),
    ],
  },
  {
    code: "VC",
    name: "Vulnerable System Confidentiality",
    group: "Base",
    optional: false,
    values: [
      value("H", "High", "Total loss of confidentiality on the target system."),
      value("L", "Low", "Limited information disclosure."),
      value("N", "None", "No loss of confidentiality."),
    ],
  },
  {
    code: "VI",
    name: "Vulnerable System Integrity",
    group: "Base",
    optional: false,
    values: [
      value("H", "High", "Total loss of integrity on the target system."),
      value("L", "Low", "Limited or constrained modification."),
      value("N", "None", "No loss of integrity."),
    ],
  },
  {
    code: "VA",
    name: "Vulnerable System Availability",
    group: "Base",
    optional: false,
    values: [
      value("H", "High", "Total loss of availability on the target system."),
      value("L", "Low", "Reduced performance or interruption."),
      value("N", "None", "No loss of availability."),
    ],
  },
  {
    code: "SC",
    name: "Subsequent System Confidentiality",
    group: "Base",
    optional: false,
    values: [
      value("H", "High", "Total loss of confidentiality beyond the target."),
      value("L", "Low", "Limited disclosure beyond the target system."),
      value("N", "None", "No subsequent confidentiality impact."),
    ],
  },
  {
    code: "SI",
    name: "Subsequent System Integrity",
    group: "Base",
    optional: false,
    values: [
      value("H", "High", "Total loss of integrity beyond the target."),
      value("L", "Low", "Limited modification beyond the target system."),
      value("N", "None", "No subsequent integrity impact."),
    ],
  },
  {
    code: "SA",
    name: "Subsequent System Availability",
    group: "Base",
    optional: false,
    values: [
      value("H", "High", "Total loss of availability beyond the target."),
      value("L", "Low", "Reduced availability beyond the target system."),
      value("N", "None", "No subsequent availability impact."),
    ],
  },
  {
    code: "E",
    name: "Exploit Maturity",
    group: "Threat",
    optional: true,
    values: [
      value("X", "Not Defined", "Treated as Attacked for scoring purposes."),
      value("A", "Attacked", "Exploitation is reported or automatable."),
      value("P", "Proof-of-Concept", "Public proof-of-concept code exists."),
      value("U", "Unreported", "No known public exploitation or PoC."),
    ],
  },
  {
    code: "CR",
    name: "Confidentiality Requirement",
    group: "Environmental",
    optional: true,
    values: [
      value("X", "Not Defined", "Treated as High for scoring purposes."),
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
      value("X", "Not Defined", "Treated as High for scoring purposes."),
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
      value("X", "Not Defined", "Treated as High for scoring purposes."),
      value("H", "High", "Availability loss is catastrophic here."),
      value("M", "Medium", "Availability loss is serious here."),
      value("L", "Low", "Availability loss has limited effect here."),
    ],
  },
  ...(
    [
      ["MAV", "Modified Attack Vector", ["N", "A", "L", "P"]],
      ["MAC", "Modified Attack Complexity", ["L", "H"]],
      ["MAT", "Modified Attack Requirements", ["N", "P"]],
      ["MPR", "Modified Privileges Required", ["N", "L", "H"]],
      ["MUI", "Modified User Interaction", ["N", "P", "A"]],
      ["MVC", "Modified Vulnerable System Confidentiality", ["H", "L", "N"]],
      ["MVI", "Modified Vulnerable System Integrity", ["H", "L", "N"]],
      ["MVA", "Modified Vulnerable System Availability", ["H", "L", "N"]],
      ["MSC", "Modified Subsequent System Confidentiality", ["H", "L", "N"]],
      ["MSI", "Modified Subsequent System Integrity", ["S", "H", "L", "N"]],
      ["MSA", "Modified Subsequent System Availability", ["S", "H", "L", "N"]],
    ] as const
  ).map(([code, name, codes]): CvssMetricDefinition => ({
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
  })),
  ...(
    [
      ["S", "Safety", ["X", "N", "P"]],
      ["AU", "Automatable", ["X", "N", "Y"]],
      ["R", "Recovery", ["X", "A", "U", "I"]],
      ["V", "Value Density", ["X", "D", "C"]],
      ["RE", "Vulnerability Response Effort", ["X", "L", "M", "H"]],
      ["U", "Provider Urgency", ["X", "Clear", "Green", "Amber", "Red"]],
    ] as const
  ).map(([code, name, codes]): CvssMetricDefinition => ({
    code,
    name,
    group: "Supplemental",
    optional: true,
    values: codes.map((it) =>
      value(it, it === "X" ? "Not Defined" : it, `${name}: ${it}.`),
    ),
  })),
];

export const CVSS40_METRICS_BY_CODE: ReadonlyMap<string, CvssMetricDefinition> =
  new Map(CVSS40_METRICS.map((metric) => [metric.code, metric]));

/** Metrics that must be present in every CVSS v4.0 vector string. */
export const CVSS40_MANDATORY_METRICS: readonly string[] =
  CVSS40_METRICS.filter((metric) => !metric.optional).map(
    (metric) => metric.code,
  );

/** Canonical vector ordering, as required by the specification. */
export const CVSS40_METRIC_ORDER: readonly string[] = CVSS40_METRICS.map(
  (metric) => metric.code,
);
