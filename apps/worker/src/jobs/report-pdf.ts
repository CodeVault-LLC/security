import { eq, sql } from "drizzle-orm";

import { generateObjectKey, uuidv7 } from "@codevault/core/crypto";
import { schema } from "@codevault/db";
import { renderPdf } from "@codevault/reporting/pdf";

import { lintReportById, renderReportHtml } from "@codevault/server/reports";
import type { WorkerContext } from "../context.js";

/**
 * The report export job.
 *
 * The linter runs one final time here, in the worker, immediately before
 * rendering. The API already refused a blocking export, but between that
 * request and this job the report may have changed, and the export is the
 * artifact that leaves the building.
 *
 * The finished PDF is stored as an ordinary artifact — hashed, keyed opaquely,
 * and immutable — so an exported advisory can be proved identical to the one
 * that was sent.
 */

export interface ReportPdfJobData {
  exportId: string;
  reportId: string;
  caseId: string;
  requestedBy: string;
}

export async function generateReportPdf(
  context: WorkerContext,
  data: ReportPdfJobData,
): Promise<void> {
  const { db } = context;

  await db
    .update(schema.reportExports)
    .set({ status: "RUNNING" })
    .where(eq(schema.reportExports.id, data.exportId));

  try {
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

    const rendered = await renderReportHtml(db, data.reportId, {
      organisation: "CodeVault",
      authorName: requesters[0]?.displayName ?? "CodeVault",
      notice,
    });

    if (rendered.directiveErrors.length > 0) {
      throw new Error(
        `Unresolved directives: ${rendered.directiveErrors.join("; ")}`,
      );
    }

    const pdf = await renderPdf({
      html: rendered.html,
      title: report.title,
      timeoutMs: 180_000,
    });

    const artifactId = uuidv7();
    const objectKey = generateObjectKey(data.caseId, artifactId);

    await context.storage.putObject(objectKey, pdf.bytes, "application/pdf");

    await db.transaction(async (tx) => {
      await tx.insert(schema.artifacts).values({
        id: artifactId,
        caseId: data.caseId,
        filename: `${report.ref}.pdf`,
        objectKey,
        mimeType: "application/pdf",
        sizeBytes: pdf.byteLength,
        sha256: pdf.sha256,
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
          sha256: pdf.sha256,
          lintResult: { findings: lint.findings, blocking: lint.blocking },
          completedAt: sql`now()`,
        })
        .where(eq(schema.reportExports.id, data.exportId));

      await tx.insert(schema.auditEvents).values({
        action: "report.exported",
        entityType: "report_export",
        entityId: data.exportId,
        caseId: data.caseId,
        actorId: data.requestedBy,
        after: {
          reportId: report.id,
          sha256: pdf.sha256,
          tlp: report.tlp,
          sizeBytes: pdf.byteLength,
        },
      });
    });

    context.log(`exported report ${report.ref} (${pdf.sha256.slice(0, 12)}…)`);
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
