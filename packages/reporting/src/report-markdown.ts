import type { ReportAudience } from "@codevault/core";
import type { TlpLabel } from "@codevault/standards";

export interface ReportMarkdownInput {
  title: string;
  reference: string;
  audience: ReportAudience;
  tlp: TlpLabel;
  caseReference: string;
  generatedAt: string;
  organisation: string;
  authorName: string;
  templateVersion: string;
  notice?: string | null;
  sections: readonly { title: string; markdown: string }[];
}

/** Builds a portable, human-readable report while retaining export provenance. */
export function buildReportMarkdown(input: ReportMarkdownInput): string {
  const metadata = [
    ["Reference", input.reference],
    ["Case", input.caseReference],
    ["Audience", input.audience],
    ["TLP", input.tlp],
    ["Organisation", input.organisation],
    ["Author", input.authorName],
    ["Generated", input.generatedAt],
    ["Template", input.templateVersion],
  ] as const;

  const parts = [
    `# ${escapeInline(input.title)}`,
    [
      "| Field | Value |",
      "| --- | --- |",
      ...metadata.map(
        ([label, value]) => `| ${label} | ${escapeTableCell(value)} |`,
      ),
    ].join("\n"),
  ];

  if (input.notice?.trim()) {
    parts.push(
      input.notice
        .trim()
        .split(/\r?\n/u)
        .map((line) => `> ${line}`)
        .join("\n"),
    );
  }

  for (const section of input.sections) {
    parts.push(
      `## ${escapeInline(section.title)}\n\n${section.markdown.trim()}`,
    );
  }

  return `${parts.join("\n\n")}\n`;
}

function escapeInline(value: string): string {
  return value
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/([\\`*_[\]<>])/gu, "\\$1");
}

function escapeTableCell(value: string): string {
  return escapeInline(value).replaceAll("|", "\\|");
}
