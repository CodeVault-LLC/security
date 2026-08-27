export const FINDING_DOCUMENT_SECTIONS = [
  { key: "summaryMarkdown", label: "Executive summary" },
  { key: "technicalMarkdown", label: "Technical description" },
  { key: "preconditionsMarkdown", label: "Attack preconditions" },
  { key: "attackPathMarkdown", label: "Attack path" },
  { key: "impactMarkdown", label: "Security impact" },
  { key: "reproductionMarkdown", label: "Reproduction steps" },
  { key: "remediationMarkdown", label: "Remediation recommendation" },
  { key: "researcherNotesMarkdown", label: "Researcher notes (internal)" },
] as const;

type FindingDocumentKey = (typeof FINDING_DOCUMENT_SECTIONS)[number]["key"];
type FindingDocumentContent = Record<FindingDocumentKey, string>;

export function buildFindingDocument(
  content: Partial<Record<FindingDocumentKey, unknown>>,
): string {
  return `${FINDING_DOCUMENT_SECTIONS.map((section) => {
    const stored = content[section.key];
    const value = typeof stored === "string" ? stored : "";
    return `## ${section.label}\n\n${value.trim()}`;
  }).join("\n\n")}\n`;
}

export function parseFindingDocument(document: string): FindingDocumentContent {
  const sections = Object.fromEntries(
    FINDING_DOCUMENT_SECTIONS.map((section) => [section.key, [] as string[]]),
  ) as Record<FindingDocumentKey, string[]>;
  const headings = new Map(
    FINDING_DOCUMENT_SECTIONS.map((section) => [
      `## ${section.label}`,
      section.key,
    ]),
  );
  let activeKey: FindingDocumentKey = FINDING_DOCUMENT_SECTIONS[0].key;

  for (const line of document.split("\n")) {
    const headingKey = headings.get(line.trim());

    if (headingKey !== undefined) {
      activeKey = headingKey;
      continue;
    }

    sections[activeKey].push(line);
  }

  return Object.fromEntries(
    FINDING_DOCUMENT_SECTIONS.map((section) => [
      section.key,
      sections[section.key].join("\n").trim(),
    ]),
  ) as FindingDocumentContent;
}
