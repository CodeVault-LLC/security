import { createHash } from "node:crypto";

import { eq, sql } from "drizzle-orm";

import { generateObjectKey, uuidv7 } from "@codevault/core/crypto";
import { schema } from "@codevault/db";
import { renderPdf } from "@codevault/reporting/pdf";

import {
  lintReportById,
  renderReportHtml,
  renderReportMarkdown,
} from "@codevault/server/reports";
import type { WorkerContext } from "../context.js";

/**
 * The report export job.
 *
 * The linter runs one final time here, in the worker, immediately before
 * rendering. The API already refused a blocking export, but between that
 * request and this job the report may have changed, and the export is the
 * artifact that leaves the building.
 *
 * The finished document is stored as an ordinary artifact, hashed, keyed
 * opaquely, and immutable, so an exported advisory can be proved identical to
 * the one that was sent.
 */

export interface ReportPdfJobData {
  exportId: string;
  reportId: string;
  caseId: string;
  requestedBy: string;
}

export async function generateReportExport(
  context: WorkerContext,
  data: ReportPdfJobData,
): Promise<void> {
  const { db } = context;

  await db
    .update(schema.reportExports)
    .set({ status: "RUNNING" })
    .where(eq(schema.reportExports.id, data.exportId));

  try {
    const exportRows = await db
      .select({ format: schema.reportExports.format })
      .from(schema.reportExports)
      .where(eq(schema.reportExports.id, data.exportId))
      .limit(1);
    const exportFormat = exportRows[0]?.format;

    if (exportFormat === undefined) {
      throw new Error("The report export no longer exists.");
    }

    const lint = await lintReportById(db, data.reportId);

    if (lint.blocking) {
      throw new Error(
        `Export blocked by ${lint.findings.filter((it) => it.severity === "BLOCKING").length} blocking lint finding(s).`,
      );
    }

    const reports = await db
      .select()
      .from(schema.reports)
      .where(eq(schema.reports.id, data.reportId))
      .limit(1);

    const report = reports[0];

    if (report === undefined) {
      throw new Error("The report no longer exists.");
    }

    const requesters = await db
      .select({ displayName: schema.users.displayName })
      .from(schema.users)
      .where(eq(schema.users.id, data.requestedBy))
      .limit(1);

    const embargoes = await db
      .select({ endsAt: schema.embargoes.endsAt })
      .from(schema.embargoes)
      .where(eq(schema.embargoes.caseId, data.caseId))
      .limit(1);

    const embargoEnd = embargoes[0]?.endsAt ?? null;
    const notice =
      embargoEnd === null || report.audience === "PUBLIC"
        ? null
        : `Embargoed until ${embargoEnd.slice(0, 10)}. Do not distribute beyond the recipients named above.`;

    const authorName = requesters[0]?.displayName ?? "CodeVault";
    let output: ReportOutput;

    if (exportFormat === "MARKDOWN") {
      const rendered = await renderReportMarkdown(db, data.reportId, {
        authorName,
        notice,
      });
      assertNoDirectiveErrors(rendered.directiveErrors);
      output = markdownReportOutput(rendered.markdown);
    } else {
      const rendered = await renderReportHtml(db, data.reportId, {
        authorName,
        notice,
      });
      assertNoDirectiveErrors(rendered.directiveErrors);
      output = await pdfOutput(rendered.html, report.title);
    }

    const artifactId = uuidv7();
    const objectKey = generateObjectKey(data.caseId, artifactId);
    const [researchCase] = await db
      .select({ organizationId: schema.cases.organizationId })
      .from(schema.cases)
      .where(eq(schema.cases.id, data.caseId))
      .limit(1);

    if (researchCase === undefined) {
      throw new Error("The report case no longer exists.");
    }

    await context.storage.putObject(objectKey, output.bytes, output.mimeType);

    await db.transaction(async (tx) => {
      await tx.insert(schema.artifacts).values({
        id: artifactId,
        caseId: data.caseId,
        filename: `${report.ref}.${output.extension}`,
        objectKey,
        mimeType: output.mimeType,
        sizeBytes: output.bytes.byteLength,
        sha256: output.sha256,
        artifactKind: "DOCUMENT",
        // An export is only ever as shareable as the report it came from.
        visibility: report.visibilityCeiling,
        status: "STORED",
        uploadedBy: data.requestedBy,
        metadata: {
          reportId: report.id,
          exportId: data.exportId,
          tlp: report.tlp,
        },
      });

      await tx
        .update(schema.reportExports)
        .set({
          status: "COMPLETED",
          artifactId,
          sha256: output.sha256,
          lintResult: { findings: lint.findings, blocking: lint.blocking },
          completedAt: sql`now()`,
        })
        .where(eq(schema.reportExports.id, data.exportId));

      await tx.insert(schema.auditEvents).values({
        organizationId: researchCase.organizationId,
        action: "report.exported",
        entityType: "report_export",
        entityId: data.exportId,
        caseId: data.caseId,
        actorId: data.requestedBy,
        after: {
          reportId: report.id,
          sha256: output.sha256,
          tlp: report.tlp,
          format: exportFormat,
          sizeBytes: output.bytes.byteLength,
        },
      });
    });

    context.log(
      `exported ${exportFormat.toLowerCase()} report ${report.ref} (${output.sha256.slice(0, 12)}…)`,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    await db
      .update(schema.reportExports)
      .set({
        status: "FAILED",
        failureReason: message.slice(0, 500),
        completedAt: sql`now()`,
      })
      .where(eq(schema.reportExports.id, data.exportId));

    throw error;
  }
}

interface ReportOutput {
  bytes: Uint8Array;
  sha256: string;
  mimeType: "application/pdf" | "text/markdown; charset=utf-8";
  extension: "pdf" | "md";
}

function assertNoDirectiveErrors(errors: readonly string[]): void {
  if (errors.length > 0) {
    throw new Error(`Unresolved directives: ${errors.join("; ")}`);
  }
}

async function pdfOutput(html: string, title: string): Promise<ReportOutput> {
  const pdf = await renderPdf({ html, title, timeoutMs: 180_000 });

  return {
    bytes: pdf.bytes,
    sha256: pdf.sha256,
    mimeType: "application/pdf",
    extension: "pdf",
  };
}

export function markdownReportOutput(markdown: string): ReportOutput {
  const bytes = new TextEncoder().encode(markdown);

  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mimeType: "text/markdown; charset=utf-8",
    extension: "md",
  };
}
