export const FINDING_EXCHANGE_FORMAT = "codevault.findings" as const;
const MIN_INTAKE_TITLE_LENGTH = 8;
const MAX_INTAKE_TITLE_LENGTH = 200;
const MAX_INTAKE_MARKDOWN_LENGTH = 200_000;
const MAX_INTAKE_CWES = 25;

export interface ExchangeFinding {
  title: string;
  summaryMarkdown?: string;
  technicalMarkdown?: string;
  impactMarkdown?: string;
  remediationMarkdown?: string;
  cweIds: string[];
  visibility: "INTERNAL" | "VENDOR" | "PUBLIC";
}

interface FindingExchangeDocument {
  format: typeof FINDING_EXCHANGE_FORMAT;
  version: 1;
  findings: ExchangeFinding[];
}

const CSV_COLUMNS = [
  "title",
  "summary",
  "technical",
  "impact",
  "remediation",
  "cwe_ids",
  "visibility",
] as const;

export function exportFindingsJson(
  findings: readonly ExchangeFinding[],
): string {
  return `${JSON.stringify(
    {
      format: FINDING_EXCHANGE_FORMAT,
      version: 1,
      findings: [...findings],
    } satisfies FindingExchangeDocument,
    null,
    2,
  )}\n`;
}

export function parseFindingsJson(input: string): ExchangeFinding[] {
  let value: unknown;
  try {
    value = JSON.parse(input) as unknown;
  } catch {
    throw new Error("The JSON finding exchange is not valid JSON.");
  }

  if (
    isRecord(value) &&
    ("format" in value || "version" in value) &&
    (value.format !== FINDING_EXCHANGE_FORMAT || value.version !== 1)
  ) {
    throw new Error("The JSON finding exchange version is not supported.");
  }

  const rows = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.findings)
      ? value.findings
      : isRecord(value) && typeof value.title === "string"
        ? [value]
        : null;

  if (rows === null) {
    throw new Error(
      "The JSON finding exchange must contain a finding or a findings array.",
    );
  }

  return rows.map((row, index) => normalizeFinding(row, index + 1));
}

export function exportFindingsCsv(
  findings: readonly ExchangeFinding[],
): string {
  const rows = findings.map((finding) =>
    [
      finding.title,
      finding.summaryMarkdown ?? "",
      finding.technicalMarkdown ?? "",
      finding.impactMarkdown ?? "",
      finding.remediationMarkdown ?? "",
      finding.cweIds.join(";"),
      finding.visibility,
    ].map(csvCell),
  );

  return [CSV_COLUMNS.join(","), ...rows.map((row) => row.join(","))].join(
    "\r\n",
  );
}

export function parseFindingsCsv(input: string): ExchangeFinding[] {
  const rows = parseCsv(input);
  const header = rows.shift();
  if (header === undefined) return [];

  const columns = header.map(normalizeColumn);
  const seenColumns = new Set<string>();
  for (const column of columns) {
    if (column !== "" && seenColumns.has(column)) {
      throw new Error(
        `The CSV finding exchange repeats the "${column}" column.`,
      );
    }
    seenColumns.add(column);
  }
  const titleIndex = columns.indexOf("title");
  if (titleIndex === -1) {
    throw new Error("The CSV finding exchange has no title column.");
  }

  return rows
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .map((row, index) => {
      const value = (names: readonly string[]): string | undefined => {
        for (const name of names) {
          const column = columns.indexOf(name);
          if (column !== -1) return row[column];
        }
        return undefined;
      };
      const title = row[titleIndex]?.trim() ?? "";
      if (title === "") throw new Error(`Row ${index + 2} has no title.`);

      return normalizeFinding(
        {
          title,
          summaryMarkdown: value(["summary", "summary_markdown"]),
          technicalMarkdown: value(["technical", "technical_markdown"]),
          impactMarkdown: value(["impact", "impact_markdown"]),
          remediationMarkdown: value(["remediation", "remediation_markdown"]),
          cweIds: value(["cwe", "cwe_ids"]),
          visibility: value(["visibility"]),
        },
        index + 2,
      );
    });
}

function normalizeFinding(value: unknown, row: number): ExchangeFinding {
  if (!isRecord(value)) throw new Error(`Row ${row} is not an object.`);
  const title = readString(value, ["title"])?.trim() ?? "";
  if (title === "") throw new Error(`Row ${row} has no title.`);
  if (title.length < MIN_INTAKE_TITLE_LENGTH) {
    throw new Error(
      `Row ${row} has a title under ${MIN_INTAKE_TITLE_LENGTH} characters.`,
    );
  }
  if (title.length > MAX_INTAKE_TITLE_LENGTH) {
    throw new Error(
      `Row ${row} has a title over ${MAX_INTAKE_TITLE_LENGTH} characters.`,
    );
  }

  const cweValue = value.cweIds ?? value.cwe ?? value.cwe_ids;
  const cweIds = normalizeCwes(cweValue, row);
  const visibility = normalizeVisibility(value.visibility, row);
  const result: ExchangeFinding = { title, cweIds, visibility };
  copyOptionalString(result, "summaryMarkdown", value, [
    "summaryMarkdown",
    "summary_markdown",
    "summary",
  ]);
  copyOptionalString(result, "technicalMarkdown", value, [
    "technicalMarkdown",
    "technical_markdown",
    "technical",
  ]);
  copyOptionalString(result, "impactMarkdown", value, [
    "impactMarkdown",
    "impact_markdown",
    "impact",
  ]);
  copyOptionalString(result, "remediationMarkdown", value, [
    "remediationMarkdown",
    "remediation_markdown",
    "remediation",
  ]);
  for (const field of [
    "summaryMarkdown",
    "technicalMarkdown",
    "impactMarkdown",
    "remediationMarkdown",
  ] as const) {
    if ((result[field]?.length ?? 0) > MAX_INTAKE_MARKDOWN_LENGTH) {
      throw new Error(`Row ${row} has ${field} over 200000 characters.`);
    }
  }
  return result;
}

function normalizeCwes(value: unknown, row: number): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[;,\s]+/u).filter(Boolean)
      : [];
  if (
    values.some(
      (item) => typeof item !== "string" || !/^CWE-[1-9][0-9]*$/u.test(item),
    )
  ) {
    throw new Error(`Row ${row} contains an invalid CWE identifier.`);
  }
  const unique = [...new Set(values as string[])];
  if (unique.length > MAX_INTAKE_CWES) {
    throw new Error(
      `Row ${row} contains more than ${MAX_INTAKE_CWES} CWE identifiers.`,
    );
  }
  return unique;
}

function normalizeVisibility(
  value: unknown,
  row: number,
): ExchangeFinding["visibility"] {
  if (value === undefined || value === null || value === "") return "INTERNAL";
  const normalized = String(value).trim().toUpperCase();
  if (
    normalized !== "INTERNAL" &&
    normalized !== "VENDOR" &&
    normalized !== "PUBLIC"
  ) {
    throw new Error(`Row ${row} contains an invalid visibility.`);
  }
  return normalized;
}

function copyOptionalString<K extends keyof ExchangeFinding>(
  target: ExchangeFinding,
  key: K,
  source: Record<string, unknown>,
  aliases: readonly string[],
): void {
  const value = readString(source, aliases)?.trim();
  if (value !== undefined && value !== "") {
    Object.assign(target, { [key]: value });
  }
}

function readString(
  source: Record<string, unknown>,
  aliases: readonly string[],
): string | undefined {
  for (const alias of aliases) {
    const value = source[alias];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  return /[",\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let quotedFieldClosed = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        quotedFieldClosed = true;
      } else {
        cell += character;
      }
      continue;
    }
    if (
      quotedFieldClosed &&
      character !== "," &&
      character !== "\r" &&
      character !== "\n"
    ) {
      throw new Error(
        "The CSV finding exchange has an unexpected character after a closing quote.",
      );
    }
    if (character === '"' && cell === "") {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
      quotedFieldClosed = false;
    } else if (character === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      quotedFieldClosed = false;
    } else if (character !== "\r") {
      cell += character;
    }
  }
  if (quoted)
    throw new Error("The CSV finding exchange has an unclosed quote.");
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function normalizeColumn(value: string): string {
  return value.trim().toLowerCase().replaceAll(" ", "_");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
