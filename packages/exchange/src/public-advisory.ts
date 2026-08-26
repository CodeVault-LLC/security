import type { FindingDetail } from "@codevault/contracts";

export interface PublicAdvisoryInput {
  finding: FindingDetail;
  generatedAt: string;
}

/** Builds a narrow public projection and excludes private research material. */
export function buildPublicAdvisory(input: PublicAdvisoryInput): string {
  const { finding } = input;
  const advisoryId =
    finding.identifiers.find((identifier) => identifier.scheme === "CVE")
      ?.value ?? finding.ref;
  const sections: string[] = [
    `# ${cleanInline(finding.title)}`,
    `- Advisory: ${cleanInline(advisoryId)}`,
    `- Published: ${input.generatedAt}`,
    `- Severity: ${finding.severity ?? "Not rated"}${finding.score === null ? "" : ` (${finding.score.toFixed(1)})`}`,
  ];
  appendSection(sections, "Summary", finding.summaryMarkdown);

  if (finding.assets.length > 0) {
    sections.push("## Affected products");
    sections.push("| Product | Affected versions | Status | Fixed in |");
    sections.push("| --- | --- | --- | --- |");
    for (const asset of finding.assets) {
      const ranges = finding.affectedRanges.filter(
        (range) => range.assetId === asset.assetId,
      );
      if (ranges.length === 0) {
        sections.push(`| ${cell(asset.name)} | Not specified | Unknown | — |`);
        continue;
      }
      for (const range of ranges) {
        sections.push(
          `| ${cell(asset.name)} | ${cell(range.expression)} | ${cell(range.status.replaceAll("_", " ").toLowerCase())} | ${cell(range.fixedIn ?? "—")} |`,
        );
      }
    }
  }

  appendSection(sections, "Impact", finding.impactMarkdown);
  appendSection(sections, "Remediation", finding.remediationMarkdown);

  const links: string[] = [];
  for (const identifier of finding.identifiers) {
    const url = publicHttpUrl(identifier.url);
    if (url !== null) {
      links.push(`- [${linkLabel(identifier.value)}](<${url}>)`);
    }
  }
  const references = finding.references.filter(
    (reference) => reference.visibility === "PUBLIC",
  );
  for (const reference of references) {
    const url = publicHttpUrl(reference.url);
    if (url !== null) {
      links.push(`- [${linkLabel(reference.title)}](<${url}>)`);
    }
  }
  if (links.length > 0) {
    sections.push("## References");
    sections.push(...links);
  }

  sections.push(
    "## Credit",
    "This advisory was prepared through CodeVault's coordinated disclosure workflow.",
  );
  return `${sections.join("\n\n")}\n`;
}

function appendSection(
  sections: string[],
  title: string,
  content: string | null,
): void {
  if (content?.trim()) sections.push(`## ${title}`, content.trim());
}

function cleanInline(value: string): string {
  return value
    .replace(/[\r\n\0]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function cell(value: string): string {
  return cleanInline(value).replaceAll("|", "\\|");
}

function linkLabel(value: string): string {
  return cleanInline(value).replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function publicHttpUrl(value: string | null): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
