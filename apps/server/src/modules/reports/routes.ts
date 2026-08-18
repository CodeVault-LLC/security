import type { AppInstance } from "../../http/app-instance.js";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import {
  ApproveReportRequest,
  CreateReportExportRequest,
  CreateReportRequest,
  ErrorResponse,
  IdParam,
  LintResult,
  ReportDetail,
  ReportExport,
  ReportPreview,
  ReportSummary,
  ReportTemplateSummary,
  UpdateReportRequest,
  UpdateReportSectionRequest,
} from "@codevault/contracts";
import {
  canTransitionReview,
  DomainError,
  exportBlocked,
  isSectionEditable,
  mergeRequirements,
  BUILT_IN_POLICY_PACKS,
  notFound,
  permissionDenied,
  satisfiesSeparationOfDuties,
  validationError,
} from "@codevault/core";
import { allocateReference, schema } from "@codevault/db";
import { BUILT_IN_TEMPLATES } from "@codevault/reporting";
import { isTlpAllowedForAudience } from "@codevault/standards";
import { Type } from "@sinclair/typebox";

import { assertRevision } from "../../http/concurrency.js";
import { actingUser, principalOf, requireAuthor } from "../../http/guards.js";
import { JOB_QUEUES } from "../../services/jobs.js";
import {
  requireCaseRead,
  requireCaseWrite,
} from "../../services/case-access.js";
import {
  lintReportById,
  loadReportDetail,
  renderReportHtml,
  resolveTemplate,
} from "./service.js";

/**
 * Report routes.
 *
 * Reports are projections of a case for one audience. Sections are edited and
 * approved individually; approval records who, when and against which revision;
 * and export is refused while the linter reports anything BLOCKING.
 */

const ReportListResponse = Type.Object({ items: Type.Array(ReportSummary) });
const TemplateListResponse = Type.Object({
  items: Type.Array(ReportTemplateSummary),
});
const ReportExportListResponse = Type.Object({
  items: Type.Array(ReportExport),
});

export async function registerReportRoutes(app: AppInstance): Promise<void> {
  app.get(
    "/v1/report-templates",
    { schema: { response: { 200: TemplateListResponse } } },
    async (request) => {
      actingUser(request);

      return {
        items: BUILT_IN_TEMPLATES.map((template) => ({
          id: template.id,
          name: template.name,
          audience: template.audience,
          defaultTlp: template.defaultTlp,
          visibilityCeiling: template.visibilityCeiling,
          sections: template.sections,
        })),
      };
    },
  );

  app.get(
    "/v1/reports",
    {
      schema: {
        querystring: Type.Object({ caseId: IdParam.properties.id }),
        response: { 200: ReportListResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);

      await requireCaseRead(app.db, user, request.query.caseId);

      const rows = await app.db
        .select({
          report: schema.reports,
          sectionCount: sql<number>`(
            SELECT count(*)::int FROM report_sections
            WHERE report_sections.report_id = ${schema.reports.id}
          )`,
          approvedSectionCount: sql<number>`(
            SELECT count(*)::int FROM report_sections
            WHERE report_sections.report_id = ${schema.reports.id}
              AND report_sections.review_state IN ('APPROVED', 'LOCKED')
          )`,
        })
        .from(schema.reports)
        .where(eq(schema.reports.caseId, request.query.caseId))
        .orderBy(asc(schema.reports.audience));

      return {
        items: rows.map(({ report, sectionCount, approvedSectionCount }) => ({
          id: report.id,
          ref: report.ref,
          caseId: report.caseId,
          audience: report.audience,
          templateId: report.templateId,
          title: report.title,
          tlp: report.tlp,
          visibilityCeiling: report.visibilityCeiling,
          status: report.status,
          sectionCount,
          approvedSectionCount,
          createdAt: report.createdAt,
          updatedAt: report.updatedAt,
          revision: report.revision,
        })),
      };
    },
  );

  app.post(
    "/v1/reports",
    {
      schema: {
        body: CreateReportRequest,
        response: { 200: ReportDetail, 400: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const body = request.body;
      const access = await requireCaseWrite(app.db, user, body.caseId);
      const template = resolveTemplate(body.templateId, body.audience);

      const existing = await app.db
        .select({ id: schema.reports.id })
        .from(schema.reports)
        .where(
          and(
            eq(schema.reports.caseId, body.caseId),
            eq(schema.reports.audience, body.audience),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        throw validationError(
          `This case already has a ${body.audience.toLowerCase()} report.`,
        );
      }

      const reportId = await app.db.transaction(async (tx) => {
        await tx
          .insert(schema.reportTemplates)
          .values({
            id: template.id,
            name: template.name,
            audience: template.audience,
            defaultTlp: template.defaultTlp,
            visibilityCeiling: template.visibilityCeiling,
            sections: template.sections,
            version: template.version,
          })
          .onConflictDoUpdate({
            target: schema.reportTemplates.id,
            set: {
              sections: template.sections,
              version: template.version,
              updatedAt: sql`now()`,
            },
          });

        const ref = await allocateReference(tx, user.organizationId, "report");
        const [report] = await tx
          .insert(schema.reports)
          .values({
            ref,
            caseId: body.caseId,
            audience: body.audience,
            templateId: template.id,
            title:
              body.title ??
              `${access.title} — ${titleCase(body.audience)} report`,
            tlp: template.defaultTlp,
            visibilityCeiling: template.visibilityCeiling,
            createdBy: user.id,
          })
          .returning({ id: schema.reports.id });

        if (report === undefined) {
          throw new DomainError("SERVER_ERROR", "Could not create the report.");
        }

        await tx.insert(schema.reportSections).values(
          template.sections.map((section, index) => ({
            reportId: report.id,
            key: section.key,
            title: section.title,
            position: index,
            required: section.required,
            promptPurpose: section.promptPurpose,
          })),
        );

        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "report.created",
            entityType: "report",
            entityId: report.id,
            caseId: body.caseId,
            after: { ref, audience: body.audience, templateId: template.id },
          },
        );

        return report.id;
      });

      return loadReportDetail(app.db, reportId);
    },
  );

  app.get(
    "/v1/reports/:id",
    {
      schema: {
        params: IdParam,
        response: { 200: ReportDetail, 404: ErrorResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      const report = await loadReportDetail(app.db, request.params.id);

      await requireCaseRead(app.db, user, report.caseId);

      return report;
    },
  );

  app.patch(
    "/v1/reports/:id",
    {
      schema: {
        params: IdParam,
        body: UpdateReportRequest,
        response: { 200: ReportDetail, 400: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const body = request.body;
      const report = await loadReportDetail(app.db, request.params.id);

      await requireCaseWrite(app.db, user, report.caseId);
      assertRevision(report, body.expectedRevision, "report");

      if (
        body.tlp !== undefined &&
        !isTlpAllowedForAudience(body.tlp, report.audience)
      ) {
        throw validationError(
          `${body.tlp} is not a valid marking for a ${report.audience} report.`,
        );
      }

      await app.db
        .update(schema.reports)
        .set({
          ...(body.title === undefined ? {} : { title: body.title }),
          ...(body.tlp === undefined ? {} : { tlp: body.tlp }),
          revision: report.revision + 1,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.reports.id, report.id));

      return loadReportDetail(app.db, report.id);
    },
  );

  app.patch(
    "/v1/reports/:id/sections/:sectionId",
    {
      schema: {
        params: Type.Object({
          id: IdParam.properties.id,
          sectionId: IdParam.properties.id,
        }),
        body: UpdateReportSectionRequest,
        response: { 200: ReportDetail, 409: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const body = request.body;
      const report = await loadReportDetail(app.db, request.params.id);

      await requireCaseWrite(app.db, user, report.caseId);

      const rows = await app.db
        .select()
        .from(schema.reportSections)
        .where(eq(schema.reportSections.id, request.params.sectionId))
        .limit(1);

      const section = rows[0];

      if (section === undefined || section.reportId !== report.id) {
        throw notFound("Report section");
      }

      assertRevision(section, body.expectedRevision, "section");

      if (
        body.contentMarkdown !== undefined &&
        !isSectionEditable(section.reviewState)
      ) {
        throw validationError(
          "This section is locked. Reopen it for review before editing.",
        );
      }

      if (
        body.reviewState !== undefined &&
        !canTransitionReview(section.reviewState, body.reviewState)
      ) {
        throw validationError(
          `A section cannot move from ${section.reviewState} to ${body.reviewState}.`,
        );
      }

      if (body.reviewState === "APPROVED") {
        const requirements = await effectiveRequirements(app, report.caseId);

        if (
          requirements.requireDistinctApprover &&
          !satisfiesSeparationOfDuties(user.id, section.lastEditedBy)
        ) {
          throw permissionDenied(
            "This case requires the approver to be someone other than the last editor.",
          );
        }
      }

      const nextRevision = section.revision + 1;
      const contentChanged =
        body.contentMarkdown !== undefined &&
        body.contentMarkdown !== section.contentMarkdown;

      await app.db.transaction(async (tx) => {
        const reviewState =
          body.reviewState ??
          // An edit to an approved section drops it back to needing review:
          // approval is of specific words, not of a section in the abstract.
          (contentChanged && section.reviewState === "APPROVED"
            ? "RESEARCHER_EDITED"
            : contentChanged && section.reviewState === "NOT_WRITTEN"
              ? "RESEARCHER_EDITED"
              : section.reviewState);

        await tx
          .update(schema.reportSections)
          .set({
            ...(body.title === undefined ? {} : { title: body.title }),
            ...(body.contentMarkdown === undefined
              ? {}
              : { contentMarkdown: body.contentMarkdown }),
            reviewState,
            ...(contentChanged ? { lastEditedBy: user.id } : {}),
            ...(reviewState === "APPROVED"
              ? {
                  approvedBy: user.id,
                  approvedAt: sql`now()`,
                  approvedRevision: nextRevision,
                }
              : {}),
            revision: nextRevision,
            updatedAt: sql`now()`,
          })
          .where(eq(schema.reportSections.id, section.id));

        if (contentChanged) {
          // Every save is an immutable revision, which is what makes an AI
          // polish reversible and an approval auditable.
          await tx.insert(schema.reportRevisions).values({
            sectionId: section.id,
            revision: nextRevision,
            contentMarkdown: body.contentMarkdown ?? section.contentMarkdown,
            reviewState,
            authoredBy: user.id,
          });
        }

        if (reviewState === "APPROVED") {
          await app.audit.write(
            tx,
            {
              actorId: user.id,
              sessionId: principal.session.id,
              requestId: request.requestId,
            },
            {
              action: "report.section_approved",
              entityType: "report_section",
              entityId: section.id,
              caseId: report.caseId,
              after: { title: section.title, revision: nextRevision },
            },
          );
        }
      });

      return loadReportDetail(app.db, report.id);
    },
  );

  app.get(
    "/v1/reports/:id/lint",
    { schema: { params: IdParam, response: { 200: LintResult } } },
    async (request) => {
      const user = actingUser(request);
      const report = await loadReportDetail(app.db, request.params.id);

      await requireCaseRead(app.db, user, report.caseId);

      return lintReportById(app.db, report.id);
    },
  );

  app.get(
    "/v1/reports/:id/preview",
    { schema: { params: IdParam, response: { 200: ReportPreview } } },
    async (request) => {
      const user = actingUser(request);
      const principal = principalOf(request);
      const report = await loadReportDetail(app.db, request.params.id);

      await requireCaseRead(app.db, user, report.caseId);

      const rendered = await renderReportHtml(app.db, report.id, {
        organisation: "CodeVault",
        authorName: principal.user.displayName,
      });
      const lint = await lintReportById(app.db, report.id);

      return { html: rendered.html, lint, tlp: report.tlp };
    },
  );

  app.post(
    "/v1/reports/:id/approve",
    {
      schema: {
        params: IdParam,
        body: ApproveReportRequest,
        response: { 200: ReportDetail, 403: ErrorResponse, 422: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const report = await loadReportDetail(app.db, request.params.id);

      await requireCaseWrite(app.db, user, report.caseId);
      assertRevision(report, request.body.expectedRevision, "report");

      const lint = await lintReportById(app.db, report.id);

      if (lint.blocking) {
        throw exportBlocked(
          "This report cannot be approved while blocking issues remain.",
          {
            findings: lint.findings.filter((it) => it.severity === "BLOCKING"),
          },
        );
      }

      const unapproved = report.sections.filter(
        (section) =>
          section.required &&
          section.reviewState !== "APPROVED" &&
          section.reviewState !== "LOCKED",
      );

      if (unapproved.length > 0) {
        throw exportBlocked(
          `These required sections are not approved: ${unapproved
            .map((section) => section.title)
            .join(", ")}.`,
        );
      }

      const requirements = await effectiveRequirements(app, report.caseId);
      const lastEditor =
        report.sections
          .map((section) => section.lastEditedBy?.id ?? null)
          .filter((id): id is string => id !== null)
          .at(-1) ?? null;

      if (
        requirements.requireDistinctApprover &&
        !satisfiesSeparationOfDuties(user.id, lastEditor)
      ) {
        throw permissionDenied(
          "This case requires a second person to approve the report.",
        );
      }

      await app.db.transaction(async (tx) => {
        await tx.insert(schema.reportApprovals).values({
          reportId: report.id,
          approvedBy: user.id,
          approvedRevision: report.revision,
          note: request.body.note ?? null,
        });

        await tx
          .update(schema.reports)
          .set({
            status: "APPROVED",
            revision: report.revision + 1,
            updatedAt: sql`now()`,
          })
          .where(eq(schema.reports.id, report.id));

        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "report.approved",
            entityType: "report",
            entityId: report.id,
            caseId: report.caseId,
            after: { revision: report.revision, tlp: report.tlp },
          },
        );
      });

      return loadReportDetail(app.db, report.id);
    },
  );

  app.get(
    "/v1/reports/:id/exports",
    {
      schema: {
        params: IdParam,
        response: { 200: ReportExportListResponse, 404: ErrorResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      const report = await loadReportDetail(app.db, request.params.id);

      await requireCaseRead(app.db, user, report.caseId);

      // An export runs in the background, so this is how a researcher learns it
      // finished and finds the artifact to download. Newest first: the one just
      // requested is the one being waited on.
      const rows = await app.db
        .select({
          export: schema.reportExports,
          requesterId: schema.users.id,
          requesterName: schema.users.displayName,
          requesterEmail: schema.users.email,
        })
        .from(schema.reportExports)
        .innerJoin(
          schema.users,
          eq(schema.users.id, schema.reportExports.requestedBy),
        )
        .where(eq(schema.reportExports.reportId, report.id))
        .orderBy(desc(schema.reportExports.createdAt));

      return {
        items: rows.map((row) => ({
          id: row.export.id,
          reportId: row.export.reportId,
          format: row.export.format,
          status: row.export.status,
          artifactId: row.export.artifactId,
          sha256: row.export.sha256,
          tlp: row.export.tlp,
          templateVersion: row.export.templateVersion,
          failureReason: row.export.failureReason,
          requestedBy: {
            id: row.requesterId,
            displayName: row.requesterName,
            email: row.requesterEmail,
          },
          createdAt: row.export.createdAt,
          completedAt: row.export.completedAt,
        })),
      };
    },
  );

  app.post(
    "/v1/reports/:id/exports",
    {
      schema: {
        params: IdParam,
        body: CreateReportExportRequest,
        response: { 200: ReportExport, 422: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const report = await loadReportDetail(app.db, request.params.id);

      await requireCaseWrite(app.db, user, report.caseId);

      // The linter runs again here, not only at approval: content can change
      // between the two, and this is the point of no return.
      const lint = await lintReportById(app.db, report.id);

      if (lint.blocking) {
        throw exportBlocked(
          "This report cannot be exported while blocking issues remain.",
          {
            findings: lint.findings.filter((it) => it.severity === "BLOCKING"),
          },
        );
      }

      const template = resolveTemplate(report.templateId, report.audience);

      const [created] = await app.db
        .insert(schema.reportExports)
        .values({
          reportId: report.id,
          format: request.body.format,
          status: "QUEUED",
          tlp: report.tlp,
          templateVersion: template.version,
          lintResult: { findings: lint.findings, blocking: lint.blocking },
          requestedBy: user.id,
        })
        .returning();

      if (created === undefined) {
        throw new DomainError("SERVER_ERROR", "Could not queue the export.");
      }

      await app.jobs.send(JOB_QUEUES.reportPdf, {
        exportId: created.id,
        reportId: report.id,
        caseId: report.caseId,
        requestedBy: user.id,
      });

      await app.audit.write(
        app.db,
        {
          actorId: user.id,
          sessionId: principal.session.id,
          requestId: request.requestId,
        },
        {
          action: "report.export_requested",
          entityType: "report_export",
          entityId: created.id,
          caseId: report.caseId,
          after: { format: request.body.format, tlp: report.tlp },
        },
      );

      return {
        id: created.id,
        reportId: created.reportId,
        format: created.format,
        status: created.status,
        artifactId: created.artifactId,
        sha256: created.sha256,
        tlp: created.tlp,
        templateVersion: created.templateVersion,
        failureReason: created.failureReason,
        requestedBy: {
          id: principal.user.id,
          displayName: principal.user.displayName,
          email: principal.user.email,
        },
        createdAt: created.createdAt,
        completedAt: created.completedAt,
      };
    },
  );
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

async function effectiveRequirements(
  app: AppInstance,
  caseId: string,
): Promise<ReturnType<typeof mergeRequirements>> {
  const rows = await app.db
    .select({ policyPackId: schema.casePolicyPacks.policyPackId })
    .from(schema.casePolicyPacks)
    .where(eq(schema.casePolicyPacks.caseId, caseId));

  const attached = new Set(rows.map((row) => row.policyPackId));

  return mergeRequirements(
    BUILT_IN_POLICY_PACKS.filter((pack) => attached.has(pack.id)),
  );
}
