import { and, asc, eq, inArray } from "drizzle-orm";

import type { LintResult, ReportDetail } from "@codevault/contracts";
import { notFound, type ReportAudience } from "@codevault/core";
import type { Database } from "@codevault/db";
import { schema } from "@codevault/db";
import {
  buildReportHtml,
  buildReportMarkdown,
  lintReport,
  renderSection,
  renderSectionMarkdown,
  templateById,
  templateForAudience,
  type ReportTemplate,
} from "@codevault/reporting";

import {
  collectReferencedItems,
  createDirectiveResolver,
} from "./directive-resolver.js";

/**
 * Report services.
 *
 * Loading, linting and rendering live here so the routes stay thin and the
 * export path and the preview path cannot drift apart — a preview that differs
 * from what is exported would make the linter untrustworthy.
 */

export async function loadReportDetail(
  db: Database,
  reportId: string,
): Promise<ReportDetail> {
  const rows = await db
    .select()
    .from(schema.reports)
    .where(eq(schema.reports.id, reportId))
    .limit(1);

  const report = rows[0];

  if (report === undefined) {
    throw notFound("Report");
  }

  const sectionRows = await db
    .select({
      section: schema.reportSections,
      approverId: schema.users.id,
      approverName: schema.users.displayName,
      approverEmail: schema.users.email,
    })
    .from(schema.reportSections)
    .leftJoin(
      schema.users,
      eq(schema.users.id, schema.reportSections.approvedBy),
    )
    .where(eq(schema.reportSections.reportId, reportId))
    .orderBy(asc(schema.reportSections.position));

  const editorIds = sectionRows
    .map(({ section }) => section.lastEditedBy)
    .filter((id): id is string => id !== null);

  const editors =
    editorIds.length === 0
      ? []
      : await db
          .select({
            id: schema.users.id,
            displayName: schema.users.displayName,
            email: schema.users.email,
          })
          .from(schema.users)
          .where(inArray(schema.users.id, editorIds));

  const editorsById = new Map(editors.map((editor) => [editor.id, editor]));

  const approvalRows = await db
    .select({
      approval: schema.reportApprovals,
      userId: schema.users.id,
      userName: schema.users.displayName,
      userEmail: schema.users.email,
    })
    .from(schema.reportApprovals)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.reportApprovals.approvedBy),
    )
    .where(eq(schema.reportApprovals.reportId, reportId));

  const sections = sectionRows.map(
    ({ section, approverId, approverName, approverEmail }) => ({
      id: section.id,
      reportId: section.reportId,
      key: section.key,
      title: section.title,
      position: section.position,
      required: section.required,
      contentMarkdown: section.contentMarkdown,
      reviewState: section.reviewState,
      promptPurpose: section.promptPurpose,
      approvedBy:
        approverId === null || approverName === null || approverEmail === null
          ? null
          : { id: approverId, displayName: approverName, email: approverEmail },
      approvedAt: section.approvedAt,
      approvedRevision: section.approvedRevision,
      lastEditedBy:
        section.lastEditedBy === null
          ? null
          : (editorsById.get(section.lastEditedBy) ?? null),
      sourceRefs: section.sourceRefs,
      updatedAt: section.updatedAt,
      revision: section.revision,
    }),
  );

  return {
    id: report.id,
    ref: report.ref,
    caseId: report.caseId,
    audience: report.audience,
    templateId: report.templateId,
    title: report.title,
    tlp: report.tlp,
    visibilityCeiling: report.visibilityCeiling,
    status: report.status,
    sectionCount: sections.length,
    approvedSectionCount: sections.filter(
      (section) =>
        section.reviewState === "APPROVED" || section.reviewState === "LOCKED",
    ).length,
    sections,
    approvals: approvalRows.map(
      ({ approval, userId, userName, userEmail }) => ({
        id: approval.id,
        approvedBy: { id: userId, displayName: userName, email: userEmail },
        approvedAt: approval.createdAt,
        note: approval.note,
      }),
    ),
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    revision: report.revision,
  };
}

export function resolveTemplate(
  templateId: string | undefined,
  audience: ReportAudience,
): ReportTemplate {
  if (templateId === undefined) {
    return templateForAudience(audience);
  }

  const template = templateById(templateId);

  if (template === null || template.audience !== audience) {
    return templateForAudience(audience);
  }

  return template;
}

/**
 * Runs the linter against a report's current content.
 *
 * Called before approval and again before export. The second run is not
 * redundant: content can change between the two, and the export is the point of
 * no return.
 */
export async function lintReportById(
  db: Database,
  reportId: string,
): Promise<LintResult> {
  const report = await loadReportDetail(db, reportId);
  const template = resolveTemplate(report.templateId, report.audience);
  const referencedItems = await collectReferencedItems(
    db,
    report.caseId,
    report.audience,
  );

  const scores = await db
    .select({
      scheme: schema.findingScores.scheme,
      vector: schema.findingScores.vector,
      score: schema.findingScores.score,
    })
    .from(schema.findingScores)
    .innerJoin(
      schema.findings,
      eq(schema.findings.id, schema.findingScores.findingId),
    )
    .where(
      and(
        eq(schema.findings.caseId, report.caseId),
        eq(schema.findingScores.reviewState, "APPROVED"),
      ),
    );

  const identifiers = await db
    .select({ value: schema.findingIdentifiers.value })
    .from(schema.findingIdentifiers)
    .innerJoin(
      schema.findings,
      eq(schema.findings.id, schema.findingIdentifiers.findingId),
    )
    .where(
      and(
        eq(schema.findings.caseId, report.caseId),
        eq(schema.findingIdentifiers.scheme, "CVE"),
      ),
    );

  const affected = await db
    .select({ id: schema.affectedRanges.id })
    .from(schema.affectedRanges)
    .innerJoin(
      schema.findings,
      eq(schema.findings.id, schema.affectedRanges.findingId),
    )
    .where(eq(schema.findings.caseId, report.caseId))
    .limit(1);

  return lintReport({
    audience: report.audience,
    tlp: report.tlp,
    sections: report.sections.map((section) => ({
      id: section.id,
      key: section.key,
      title: section.title,
      required: section.required,
      contentMarkdown: section.contentMarkdown,
      reviewState: section.reviewState,
      sourceRefs: section.sourceRefs,
    })),
    requiredSectionTitles: template.sections
      .filter((section) => section.required)
      .map((section) => section.title),
    referencedItems,
    scores,
    findingCveIds: identifiers.map((row) => row.value),
    hasAffectedVersionConclusion: affected.length > 0,
  });
}

export interface RenderedReport {
  html: string;
  /** Directive failures encountered while rendering, merged into lint output. */
  directiveErrors: string[];
}

export interface RenderedMarkdownReport {
  markdown: string;
  directiveErrors: string[];
}

/**
 * Renders the report to a self-contained HTML document.
 *
 * Directive resolution happens per section against the report's audience, so a
 * public render cannot pull in an internal evidence block even if the Markdown
 * asks for one.
 */
export async function renderReportHtml(
  db: Database,
  reportId: string,
  options: {
    organisation?: string;
    authorName: string;
    notice?: string | null;
    contactName?: string | null;
    contactEmail?: string | null;
    reportFooter?: string | null;
  },
): Promise<RenderedReport> {
  const report = await loadReportDetail(db, reportId);
  const template = resolveTemplate(report.templateId, report.audience);
  const resolver = createDirectiveResolver({
    db,
    caseId: report.caseId,
    audience: report.audience,
  });

  const caseRows = await db
    .select({
      ref: schema.cases.ref,
      organizationName: schema.organizations.name,
      contactName: schema.organizations.contactName,
      contactEmail: schema.organizations.contactEmail,
      reportFooter: schema.organizations.reportFooter,
    })
    .from(schema.cases)
    .innerJoin(
      schema.organizations,
      eq(schema.organizations.id, schema.cases.organizationId),
    )
    .where(eq(schema.cases.id, report.caseId))
    .limit(1);

  const directiveErrors: string[] = [];
  const sections = [];

  for (const section of report.sections) {
    if (section.contentMarkdown.trim().length === 0) {
      continue;
    }

    const rendered = await renderSection(
      section.contentMarkdown,
      report.audience,
      resolver,
    );

    for (const error of rendered.directiveErrors) {
      directiveErrors.push(`${section.title}: ${error.message}`);
    }

    sections.push({ title: section.title, html: rendered.html });
  }

  const html = buildReportHtml({
    title: report.title,
    reference: report.ref,
    audience: report.audience,
    tlp: report.tlp,
    caseReference: caseRows[0]?.ref ?? report.caseId,
    generatedAt: new Date().toISOString().slice(0, 10),
    organisation:
      options.organisation ?? caseRows[0]?.organizationName ?? "CodeVault",
    contactName: options.contactName ?? caseRows[0]?.contactName ?? null,
    contactEmail: options.contactEmail ?? caseRows[0]?.contactEmail ?? null,
    reportFooter: options.reportFooter ?? caseRows[0]?.reportFooter ?? null,
    authorName: options.authorName,
    templateVersion: template.version,
    sections,
    notice: options.notice ?? null,
  });

  return { html, directiveErrors };
}

/** Renders the same audience-filtered report as a portable Markdown document. */
export async function renderReportMarkdown(
  db: Database,
  reportId: string,
  options: {
    organisation?: string;
    authorName: string;
    notice?: string | null;
  },
): Promise<RenderedMarkdownReport> {
  const report = await loadReportDetail(db, reportId);
  const template = resolveTemplate(report.templateId, report.audience);
  const resolver = createDirectiveResolver({
    db,
    caseId: report.caseId,
    audience: report.audience,
  });
  const caseRows = await db
    .select({
      ref: schema.cases.ref,
      organizationName: schema.organizations.name,
    })
    .from(schema.cases)
    .innerJoin(
      schema.organizations,
      eq(schema.organizations.id, schema.cases.organizationId),
    )
    .where(eq(schema.cases.id, report.caseId))
    .limit(1);
  const directiveErrors: string[] = [];
  const sections = [];

  for (const section of report.sections) {
    if (section.contentMarkdown.trim().length === 0) continue;

    const rendered = await renderSectionMarkdown(
      section.contentMarkdown,
      report.audience,
      resolver,
    );
    for (const error of rendered.directiveErrors) {
      directiveErrors.push(`${section.title}: ${error.message}`);
    }
    sections.push({ title: section.title, markdown: rendered.markdown });
  }

  return {
    markdown: buildReportMarkdown({
      title: report.title,
      reference: report.ref,
      audience: report.audience,
      tlp: report.tlp,
      caseReference: caseRows[0]?.ref ?? report.caseId,
      generatedAt: new Date().toISOString().slice(0, 10),
      organisation:
        options.organisation ?? caseRows[0]?.organizationName ?? "CodeVault",
      authorName: options.authorName,
      templateVersion: template.version,
      notice: options.notice ?? null,
      sections,
    }),
    directiveErrors,
  };
}
