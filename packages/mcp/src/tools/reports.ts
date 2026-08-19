import type { McpServer } from "@modelcontextprotocol/server";
import { REPORT_AUDIENCES, REVIEW_STATES } from "@codevault/core";
import { TLP_LABELS } from "@codevault/standards";
import type {
  ApproveReportRequest,
  CreateReportExportRequest,
  CreateReportRequest,
  UpdateReportRequest,
  UpdateReportSectionRequest,
} from "@codevault/contracts";
import * as z from "zod/v4";

import type { CodeVaultClient } from "../client.js";
import { compact, id, markdown, result } from "./shared.js";

export function registerReportTools(
  server: McpServer,
  client: CodeVaultClient,
): void {
  server.registerTool(
    "codevault_list_report_templates",
    {
      title: "List report templates",
      description:
        "List the report templates, audiences, visibility ceilings, and section outlines available for report creation.",
      annotations: { readOnlyHint: true },
    },
    () => result(() => client.listReportTemplates()),
  );

  server.registerTool(
    "codevault_list_reports",
    {
      title: "List case reports",
      description: "List every report created for a case.",
      inputSchema: z.object({ caseId: id }),
      annotations: { readOnlyHint: true },
    },
    ({ caseId }) => result(() => client.listReports(caseId)),
  );

  server.registerTool(
    "codevault_create_report",
    {
      title: "Create a report",
      description:
        "Create a case report for an internal, vendor, or public audience from a selected or default template.",
      inputSchema: z.object({
        caseId: id,
        audience: z.enum(REPORT_AUDIENCES),
        templateId: z.string().max(80).optional(),
        title: z.string().min(1).max(200).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    (input) =>
      result(() => client.createReport(compact(input) as CreateReportRequest)),
  );

  server.registerTool(
    "codevault_get_report",
    {
      title: "Get a report",
      description:
        "Read a report with its Markdown sections, review state, source references, and approvals.",
      inputSchema: z.object({ reportId: id }),
      annotations: { readOnlyHint: true },
    },
    ({ reportId }) => result(() => client.getReport(reportId)),
  );

  server.registerTool(
    "codevault_update_report",
    {
      title: "Update a report",
      description: "Update a report title or TLP label immediately.",
      inputSchema: z.object({
        reportId: id,
        expectedRevision: z.number().int().min(1),
        title: z.string().min(1).max(200).optional(),
        tlp: z.enum(TLP_LABELS).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    ({ reportId, ...input }) =>
      result(() =>
        client.updateReport(reportId, compact(input) as UpdateReportRequest),
      ),
  );

  server.registerTool(
    "codevault_update_report_section",
    {
      title: "Update a report section",
      description:
        "Write section Markdown, rename the section, or change its review state immediately.",
      inputSchema: z.object({
        reportId: id,
        sectionId: id,
        expectedRevision: z.number().int().min(1),
        contentMarkdown: markdown.optional(),
        title: z.string().min(1).max(200).optional(),
        reviewState: z.enum(REVIEW_STATES).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    ({ reportId, sectionId, ...input }) =>
      result(() =>
        client.updateReportSection(
          reportId,
          sectionId,
          compact(input) as UpdateReportSectionRequest,
        ),
      ),
  );

  server.registerTool(
    "codevault_lint_report",
    {
      title: "Lint a report",
      description:
        "Check a report for missing, inconsistent, unsafe, or publication-blocking content.",
      inputSchema: z.object({ reportId: id }),
      annotations: { readOnlyHint: true },
    },
    ({ reportId }) => result(() => client.lintReport(reportId)),
  );

  server.registerTool(
    "codevault_preview_report",
    {
      title: "Preview a report",
      description:
        "Render the current report as HTML and return the render plus lint results without exporting it.",
      inputSchema: z.object({ reportId: id }),
      annotations: { readOnlyHint: true },
    },
    ({ reportId }) => result(() => client.previewReport(reportId)),
  );

  server.registerTool(
    "codevault_approve_report",
    {
      title: "Approve a report",
      description:
        "Approve the report immediately as the authenticated CodeVault user if server-side lint and policy requirements pass.",
      inputSchema: z.object({
        reportId: id,
        expectedRevision: z.number().int().min(1),
        note: z.string().max(1_000).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    ({ reportId, ...input }) =>
      result(() =>
        client.approveReport(reportId, compact(input) as ApproveReportRequest),
      ),
  );

  server.registerTool(
    "codevault_list_report_exports",
    {
      title: "List report exports",
      description:
        "List queued, running, completed, or failed PDF and Markdown exports for a report.",
      inputSchema: z.object({ reportId: id }),
      annotations: { readOnlyHint: true },
    },
    ({ reportId }) => result(() => client.listReportExports(reportId)),
  );

  server.registerTool(
    "codevault_export_report",
    {
      title: "Export a report",
      description:
        "Queue a PDF or Markdown export immediately. CodeVault enforces approval, lint, and publication rules.",
      inputSchema: z.object({
        reportId: id,
        format: z.enum(["PDF", "MARKDOWN"]),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    ({ reportId, ...input }) =>
      result(() =>
        client.exportReport(reportId, input as CreateReportExportRequest),
      ),
  );
}
