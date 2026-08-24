/**
 * CWE catalogue.
 *
 * CodeVault ships a curated subset — the weaknesses that actually show up in
 * research output — rather than the full 900-entry MITRE list. A finding may
 * still record any well-formed `CWE-nnn`; the catalogue exists to power
 * autocomplete and to render a name next to an identifier, not to constrain
 * what a researcher may classify.
 */

export interface CweEntry {
  id: string;
  name: string;
  /** Short plain-language description used in the suggestion list. */
  summary: string;
  /** Broad grouping used to cluster suggestions in the UI. */
  category: CweCategory;
  /** Rank in MITRE's 2025 Top 25, when the weakness appears in that list. */
  top25Rank?: number;
}

/** MITRE CWE release used to verify identifiers and canonical names. */
export const CWE_CATALOG_VERSION = "4.20";
export const CWE_TOP_25_YEAR = 2025;

export const CWE_CATEGORIES = [
  "INJECTION",
  "MEMORY_SAFETY",
  "ACCESS_CONTROL",
  "AUTHENTICATION",
  "CRYPTOGRAPHY",
  "INFORMATION_DISCLOSURE",
  "INPUT_VALIDATION",
  "RESOURCE_MANAGEMENT",
  "CONFIGURATION",
  "SUPPLY_CHAIN",
  "OTHER",
] as const;

export type CweCategory = (typeof CWE_CATEGORIES)[number];

export const CWE_CATALOG: readonly CweEntry[] = [
  {
    id: "CWE-20",
    name: "Improper Input Validation",
    summary: "Input is not validated, or is validated incorrectly.",
    category: "INPUT_VALIDATION",
    top25Rank: 18,
  },
  {
    id: "CWE-22",
    name: "Path Traversal",
    summary:
      "A pathname is built from input without restricting it to a directory.",
    category: "INPUT_VALIDATION",
    top25Rank: 6,
  },
  {
    id: "CWE-59",
    name: "Improper Link Resolution Before File Access",
    summary: "A file operation follows a link to an unintended target.",
    category: "INPUT_VALIDATION",
  },
  {
    id: "CWE-77",
    name: "Command Injection",
    summary: "Input changes the structure of a command sent to an interpreter.",
    category: "INJECTION",
    top25Rank: 23,
  },
  {
    id: "CWE-78",
    name: "OS Command Injection",
    summary: "Input flows into an operating-system command.",
    category: "INJECTION",
    top25Rank: 9,
  },
  {
    id: "CWE-79",
    name: "Cross-site Scripting",
    summary: "Input is placed into a web page without neutralisation.",
    category: "INJECTION",
    top25Rank: 1,
  },
  {
    id: "CWE-88",
    name: "Argument Injection or Modification",
    summary: "Input adds or changes arguments passed to a command.",
    category: "INJECTION",
  },
  {
    id: "CWE-89",
    name: "SQL Injection",
    summary: "Input is used to construct an SQL statement.",
    category: "INJECTION",
    top25Rank: 2,
  },
  {
    id: "CWE-93",
    name: "CRLF Injection",
    summary:
      "Line-ending characters in input create unintended protocol fields.",
    category: "INJECTION",
  },
  {
    id: "CWE-94",
    name: "Code Injection",
    summary: "Input is interpreted as code by the target.",
    category: "INJECTION",
    top25Rank: 10,
  },
  {
    id: "CWE-119",
    name: "Improper Restriction of Operations within Memory Buffer Bounds",
    summary: "Reads or writes fall outside an intended buffer.",
    category: "MEMORY_SAFETY",
  },
  {
    id: "CWE-120",
    name: "Classic Buffer Overflow",
    summary: "A copy occurs without checking the destination size.",
    category: "MEMORY_SAFETY",
    top25Rank: 11,
  },
  {
    id: "CWE-121",
    name: "Stack-based Buffer Overflow",
    summary: "Data exceeds the bounds of a buffer allocated on the stack.",
    category: "MEMORY_SAFETY",
    top25Rank: 14,
  },
  {
    id: "CWE-122",
    name: "Heap-based Buffer Overflow",
    summary: "Data exceeds the bounds of a buffer allocated on the heap.",
    category: "MEMORY_SAFETY",
    top25Rank: 16,
  },
  {
    id: "CWE-125",
    name: "Out-of-bounds Read",
    summary: "A read occurs before or past the end of a buffer.",
    category: "MEMORY_SAFETY",
    top25Rank: 8,
  },
  {
    id: "CWE-134",
    name: "Uncontrolled Format String",
    summary: "Input is used as a format string.",
    category: "MEMORY_SAFETY",
  },
  {
    id: "CWE-190",
    name: "Integer Overflow or Wraparound",
    summary:
      "Arithmetic wraps, producing an unexpected small or negative value.",
    category: "MEMORY_SAFETY",
  },
  {
    id: "CWE-200",
    name: "Exposure of Sensitive Information to an Unauthorized Actor",
    summary: "Information reaches an actor that should not have it.",
    category: "INFORMATION_DISCLOSURE",
    top25Rank: 20,
  },
  {
    id: "CWE-209",
    name: "Generation of Error Message Containing Sensitive Information",
    summary: "Errors disclose internal detail to an attacker.",
    category: "INFORMATION_DISCLOSURE",
  },
  {
    id: "CWE-269",
    name: "Improper Privilege Management",
    summary: "Privileges are assigned or dropped incorrectly.",
    category: "ACCESS_CONTROL",
  },
  {
    id: "CWE-284",
    name: "Improper Access Control",
    summary: "Access to a resource is not restricted correctly.",
    category: "ACCESS_CONTROL",
    top25Rank: 19,
  },
  {
    id: "CWE-287",
    name: "Improper Authentication",
    summary: "An actor's identity is not correctly proven.",
    category: "AUTHENTICATION",
  },
  {
    id: "CWE-295",
    name: "Improper Certificate Validation",
    summary:
      "A certificate is accepted without verifying its trust or identity.",
    category: "CRYPTOGRAPHY",
  },
  {
    id: "CWE-306",
    name: "Missing Authentication for Critical Function",
    summary: "A sensitive function requires no authentication at all.",
    category: "AUTHENTICATION",
    top25Rank: 21,
  },
  {
    id: "CWE-312",
    name: "Cleartext Storage of Sensitive Information",
    summary: "Sensitive data is stored without encryption.",
    category: "CRYPTOGRAPHY",
  },
  {
    id: "CWE-319",
    name: "Cleartext Transmission of Sensitive Information",
    summary: "Sensitive data crosses a network without transport protection.",
    category: "CRYPTOGRAPHY",
  },
  {
    id: "CWE-327",
    name: "Use of a Broken or Risky Cryptographic Algorithm",
    summary: "A weak or deprecated algorithm protects sensitive data.",
    category: "CRYPTOGRAPHY",
  },
  {
    id: "CWE-330",
    name: "Use of Insufficiently Random Values",
    summary: "Predictable values are used where randomness is required.",
    category: "CRYPTOGRAPHY",
  },
  {
    id: "CWE-352",
    name: "Cross-Site Request Forgery",
    summary: "A request is accepted without proving user intent.",
    category: "ACCESS_CONTROL",
    top25Rank: 3,
  },
  {
    id: "CWE-362",
    name: "Race Condition",
    summary: "Concurrent execution uses a shared resource unsafely.",
    category: "RESOURCE_MANAGEMENT",
  },
  {
    id: "CWE-400",
    name: "Uncontrolled Resource Consumption",
    summary: "An attacker can exhaust memory, CPU, storage or handles.",
    category: "RESOURCE_MANAGEMENT",
  },
  {
    id: "CWE-416",
    name: "Use After Free",
    summary: "Memory is referenced after it has been released.",
    category: "MEMORY_SAFETY",
    top25Rank: 7,
  },
  {
    id: "CWE-434",
    name: "Unrestricted Upload of File with Dangerous Type",
    summary: "Uploaded files can be executed by the target.",
    category: "INPUT_VALIDATION",
    top25Rank: 12,
  },
  {
    id: "CWE-444",
    name: "Inconsistent Interpretation of HTTP Requests",
    summary: "HTTP participants disagree about request boundaries or meaning.",
    category: "INPUT_VALIDATION",
  },
  {
    id: "CWE-476",
    name: "NULL Pointer Dereference",
    summary: "Code dereferences a pointer that does not reference an object.",
    category: "MEMORY_SAFETY",
    top25Rank: 13,
  },
  {
    id: "CWE-502",
    name: "Deserialization of Untrusted Data",
    summary: "Untrusted serialized data is reconstructed into objects.",
    category: "INJECTION",
    top25Rank: 15,
  },
  {
    id: "CWE-532",
    name: "Insertion of Sensitive Information into Log File",
    summary:
      "Sensitive data is written to a log where more actors can read it.",
    category: "INFORMATION_DISCLOSURE",
  },
  {
    id: "CWE-521",
    name: "Weak Password Requirements",
    summary: "Credential policy permits easily guessed secrets.",
    category: "AUTHENTICATION",
  },
  {
    id: "CWE-601",
    name: "URL Redirection to Untrusted Site",
    summary: "Input selects an untrusted destination for a redirect.",
    category: "INPUT_VALIDATION",
  },
  {
    id: "CWE-522",
    name: "Insufficiently Protected Credentials",
    summary: "Credentials are transmitted or stored without protection.",
    category: "AUTHENTICATION",
  },
  {
    id: "CWE-539",
    name: "Use of Persistent Cookies Containing Sensitive Information",
    summary: "Sensitive values persist in client-side storage.",
    category: "INFORMATION_DISCLOSURE",
  },
  {
    id: "CWE-552",
    name: "Files or Directories Accessible to External Parties",
    summary: "Internal files are reachable from outside the trust boundary.",
    category: "ACCESS_CONTROL",
  },
  {
    id: "CWE-611",
    name: "XML External Entity Reference",
    summary: "An XML parser resolves attacker-controlled external entities.",
    category: "INJECTION",
  },
  {
    id: "CWE-639",
    name: "Authorization Bypass Through User-Controlled Key",
    summary: "An object reference is trusted without an ownership check.",
    category: "ACCESS_CONTROL",
    top25Rank: 24,
  },
  {
    id: "CWE-770",
    name: "Allocation of Resources Without Limits or Throttling",
    summary: "Resource allocation has no bound or rate limit.",
    category: "RESOURCE_MANAGEMENT",
    top25Rank: 25,
  },
  {
    id: "CWE-732",
    name: "Incorrect Permission Assignment for Critical Resource",
    summary: "A sensitive resource is created with permissive permissions.",
    category: "CONFIGURATION",
  },
  {
    id: "CWE-787",
    name: "Out-of-bounds Write",
    summary: "A write occurs before or past the end of a buffer.",
    category: "MEMORY_SAFETY",
    top25Rank: 5,
  },
  {
    id: "CWE-862",
    name: "Missing Authorization",
    summary: "A protected action runs without an authorization check.",
    category: "ACCESS_CONTROL",
    top25Rank: 4,
  },
  {
    id: "CWE-798",
    name: "Use of Hard-coded Credentials",
    summary: "Credentials are embedded in firmware, binaries or source.",
    category: "AUTHENTICATION",
  },
  {
    id: "CWE-863",
    name: "Incorrect Authorization",
    summary: "An authorization check exists but reaches the wrong conclusion.",
    category: "ACCESS_CONTROL",
    top25Rank: 17,
  },
  {
    id: "CWE-918",
    name: "Server-Side Request Forgery",
    summary: "The server issues a request to an attacker-chosen destination.",
    category: "INPUT_VALIDATION",
    top25Rank: 22,
  },
  {
    id: "CWE-942",
    name: "Permissive Cross-domain Policy with Untrusted Domains",
    summary: "A cross-domain policy grants access to untrusted origins.",
    category: "ACCESS_CONTROL",
  },
  {
    id: "CWE-1188",
    name: "Insecure Default Initialization of Resource",
    summary: "A shipped default leaves the resource unprotected.",
    category: "CONFIGURATION",
  },
  {
    id: "CWE-1104",
    name: "Use of Unmaintained Third Party Components",
    summary: "The target depends on components no longer receiving fixes.",
    category: "SUPPLY_CHAIN",
  },
  {
    id: "CWE-1395",
    name: "Dependency on Vulnerable Third-Party Component",
    summary: "A known-vulnerable dependency is bundled or required.",
    category: "SUPPLY_CHAIN",
  },
  {
    id: "CWE-1321",
    name: "Improperly Controlled Modification of Object Prototype Attributes",
    summary: "Input modifies an object's prototype and affects other objects.",
    category: "INJECTION",
  },
  {
    id: "CWE-1333",
    name: "Inefficient Regular Expression Complexity",
    summary:
      "A crafted string makes regular-expression matching consume excessive time.",
    category: "RESOURCE_MANAGEMENT",
  },
];

const CWE_BY_ID: ReadonlyMap<string, CweEntry> = new Map(
  CWE_CATALOG.map((entry) => [entry.id, entry]),
);

export function normalizeCweId(value: string): string | null {
  const match = /^(?:CWE-)?(\d{1,5})$/i.exec(value.trim());

  if (match === null) {
    return null;
  }

  const numeric = Number(match[1]);
  return numeric > 0 ? `CWE-${numeric}` : null;
}

export function findCwe(id: string): CweEntry | null {
  const normalized = normalizeCweId(id);
  return normalized === null ? null : (CWE_BY_ID.get(normalized) ?? null);
}

/**
 * Ranked catalogue search over identifier, name and summary.
 *
 * Identifier matches outrank name matches, which outrank summary matches, so
 * typing "89" surfaces CWE-89 rather than every entry that mentions it.
 */
export function searchCwe(query: string, limit = 10): CweEntry[] {
  const needle = query.trim().toLowerCase();
  const safeLimit = Number.isFinite(limit)
    ? Math.min(Math.max(Math.trunc(limit), 0), 50)
    : 0;

  if (needle.length === 0 || safeLimit === 0) {
    return [];
  }

  const scored: { entry: CweEntry; rank: number }[] = [];

  for (const entry of CWE_CATALOG) {
    const id = entry.id.toLowerCase();
    const digits = id.replace("cwe-", "");

    if (id === needle || digits === needle) {
      scored.push({ entry, rank: 0 });
      continue;
    }

    if (id.includes(needle) || digits.startsWith(needle)) {
      scored.push({ entry, rank: 1 });
      continue;
    }

    if (entry.name.toLowerCase().includes(needle)) {
      scored.push({ entry, rank: 2 });
      continue;
    }

    if (entry.summary.toLowerCase().includes(needle)) {
      scored.push({ entry, rank: 3 });
    }
  }

  return scored
    .sort((left, right) => left.rank - right.rank)
    .slice(0, safeLimit)
    .map((item) => item.entry);
}

/** MITRE's Top 25 entries in rank order, optionally narrowed by category. */
export function topCwes(category?: CweCategory): CweEntry[] {
  return CWE_CATALOG.filter(
    (entry) =>
      entry.top25Rank !== undefined &&
      (category === undefined || entry.category === category),
  ).sort((left, right) => (left.top25Rank ?? 0) - (right.top25Rank ?? 0));
}

/** MITRE's canonical page for a weakness, used by `ReferenceLink`. */
export function cweUrl(id: string): string | null {
  const normalized = normalizeCweId(id);

  if (normalized === null) {
    return null;
  }

  const numeric = normalized.replace("CWE-", "");

  return `https://cwe.mitre.org/data/definitions/${numeric}.html`;
}
