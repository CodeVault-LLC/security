import { createHash } from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";

import type {
  SubmissionAttachment,
  SubmissionDetail,
  SubmissionPackageManifest,
  SubmissionRouteSnapshot,
  SubmissionSummary,
  SubmissionValidationResult,
} from "@codevault/contracts";
import {
  conflict,
  DomainError,
  notFound,
  validationError,
  type ActingUser,
} from "@codevault/core";
import { generateObjectKey, uuidv7 } from "@codevault/core/crypto";
import type { Database } from "@codevault/db";
import { schema } from "@codevault/db";

import type { AppInstance } from "../../http/app-instance.js";
import {
  requireCaseRead,
  requireCaseWrite,
} from "../../services/case-access.js";
import { toVendorSummary } from "../vendors/service.js";
import {
  validateSubmission,
  type SubmissionValidationInput,
  type ValidationAttachment,
} from "./validation.js";

export async function requireSubmission(
  db: Database,
  submissionId: string,
): Promise<typeof schema.submissions.$inferSelect> {
  const [submission] = await db
    .select()
    .from(schema.submissions)
    .where(eq(schema.submissions.id, submissionId))
    .limit(1);

  if (submission === undefined) throw notFound("Submission");
  return submission;
}

export async function requireSubmissionRead(
  app: AppInstance,
  user: ActingUser,
  submissionId: string,
) {
  const submission = await requireSubmission(app.db, submissionId);
  await requireCaseRead(app.db, user, submission.caseId);
  return submission;
}

export async function requireSubmissionWrite(
  app: AppInstance,
  user: ActingUser,
  submissionId: string,
) {
  const submission = await requireSubmission(app.db, submissionId);
  await requireCaseWrite(app.db, user, submission.caseId);
  return submission;
}

export async function loadSubmissionAttachments(
  db: Database,
  submission: typeof schema.submissions.$inferSelect,
): Promise<SubmissionAttachment[]> {
  const selected = await db
    .select({ link: schema.submissionAttachments, artifact: schema.artifacts })
    .from(schema.submissionAttachments)
    .innerJoin(
      schema.artifacts,
      eq(schema.artifacts.id, schema.submissionAttachments.artifactId),
    )
    .where(eq(schema.submissionAttachments.submissionId, submission.id))
    .orderBy(schema.submissionAttachments.position);
  const attachments = selected.map(({ link, artifact }) =>
    toAttachment(artifact, link.sourceRevision),
  );

  if (
    submission.reportExportId !== null &&
    submission.replyToMessageId === null
  ) {
    const [reportArtifact] = await db
      .select({ artifact: schema.artifacts, report: schema.reports })
      .from(schema.reportExports)
      .innerJoin(
        schema.reports,
        eq(schema.reports.id, schema.reportExports.reportId),
      )
      .innerJoin(
        schema.artifacts,
        eq(schema.artifacts.id, schema.reportExports.artifactId),
      )
      .where(eq(schema.reportExports.id, submission.reportExportId))
      .limit(1);

    if (
      reportArtifact !== undefined &&
      !attachments.some(
        (item) => item.artifactId === reportArtifact.artifact.id,
      )
    ) {
      attachments.unshift(
        toAttachment(reportArtifact.artifact, reportArtifact.report.revision),
      );
    }
  }

  return attachments;
}

function toAttachment(
  artifact: typeof schema.artifacts.$inferSelect,
  sourceRevision: number | null,
): SubmissionAttachment {
  return {
    artifactId: artifact.id,
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    visibility: artifact.visibility,
    status:
      artifact.status === "STORED" ||
      artifact.status === "QUARANTINED" ||
      artifact.status === "DELETED"
        ? artifact.status
        : "QUARANTINED",
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
    sourceRevision,
  };
}

export async function loadSubmissionDetail(
  app: Pick<AppInstance, "db">,
  submissionId: string,
): Promise<SubmissionDetail> {
  const submission = await requireSubmission(app.db, submissionId);
  const vendorRows = await app.db
    .select()
    .from(schema.vendors)
    .where(eq(schema.vendors.id, submission.vendorId))
    .limit(1);
  const vendor = vendorRows[0];
  if (vendor === undefined) throw notFound("Vendor");

  const [approval] = await app.db
    .select({ approval: schema.submissionApprovals, user: schema.users })
    .from(schema.submissionApprovals)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.submissionApprovals.approvedBy),
    )
    .where(
      and(
        eq(schema.submissionApprovals.submissionId, submission.id),
        eq(schema.submissionApprovals.submissionRevision, submission.revision),
      ),
    )
    .limit(1);
  const [latestPackage] = await app.db
    .select()
    .from(schema.submissionPackages)
    .where(eq(schema.submissionPackages.submissionId, submission.id))
    .orderBy(desc(schema.submissionPackages.createdAt))
    .limit(1);

  return {
    ...toSubmissionSummary(submission, vendor),
    routeSnapshot: submission.routeSnapshot as SubmissionRouteSnapshot,
    bodyMarkdown: submission.bodyMarkdown,
    reportExportId: submission.reportExportId,
    mailboxConnectionId: submission.mailboxConnectionId,
    replyToMessageId: submission.replyToMessageId,
    manualFields: submission.manualFields as Record<string, string>,
    attachments: await loadSubmissionAttachments(app.db, submission),
    currentApproval:
      approval === undefined
        ? null
        : {
            id: approval.approval.id,
            submissionRevision: approval.approval.submissionRevision,
            approvedBy: {
              id: approval.user.id,
              displayName: approval.user.displayName,
              email: approval.user.email,
            },
            approvedAt: approval.approval.createdAt,
            note: approval.approval.note,
          },
    plannedNextContactAt: submission.plannedNextContactAt,
    agreedDisclosureAt: submission.agreedDisclosureAt,
    vendorReference: submission.vendorReference,
    coordinationNotes: submission.coordinationNotes,
    snoozedUntil: submission.snoozedUntil,
    snoozeReason: submission.snoozeReason,
    latestPackage:
      latestPackage === undefined
        ? null
        : {
            id: latestPackage.id,
            manifestSha256: latestPackage.manifestSha256,
            packageSha256: latestPackage.packageSha256,
            sizeBytes: latestPackage.sizeBytes,
            createdAt: latestPackage.createdAt,
          },
  };
}

export function toSubmissionSummary(
  submission: typeof schema.submissions.$inferSelect,
  vendor: typeof schema.vendors.$inferSelect,
): SubmissionSummary {
  return {
    id: submission.id,
    ref: submission.ref,
    caseId: submission.caseId,
    vendor: toVendorSummary(vendor),
    routeId: submission.routeId,
    status: submission.status,
    coordinationState: submission.coordinationState,
    cryptoMode: submission.cryptoMode,
    subject: submission.subject,
    createdAt: submission.createdAt,
    updatedAt: submission.updatedAt,
    revision: submission.revision,
  };
}

export async function writeSubmissionRevision(
  db: Database,
  submission: typeof schema.submissions.$inferSelect,
  authoredBy: string,
): Promise<void> {
  await db.insert(schema.submissionRevisions).values({
    submissionId: submission.id,
    revision: submission.revision,
    subject: submission.subject,
    bodyMarkdown: submission.bodyMarkdown,
    manualFields: submission.manualFields,
    cryptoMode: submission.cryptoMode,
    authoredBy,
  });
}

export async function evaluateSubmission(
  app: AppInstance,
  submissionId: string,
): Promise<SubmissionValidationResult> {
  const submission = await requireSubmission(app.db, submissionId);
  const routeSnapshot = submission.routeSnapshot as SubmissionRouteSnapshot;
  const attachments = await validationAttachments(app.db, submission);
  const [reportExport] =
    submission.reportExportId === null
      ? []
      : await app.db
          .select({ export: schema.reportExports, report: schema.reports })
          .from(schema.reportExports)
          .innerJoin(
            schema.reports,
            eq(schema.reports.id, schema.reportExports.reportId),
          )
          .where(eq(schema.reportExports.id, submission.reportExportId))
          .limit(1);
  const [key] =
    routeSnapshot.route.type !== "EMAIL" ||
    routeSnapshot.route.publicKeyId === null
      ? []
      : await app.db
          .select()
          .from(schema.vendorPublicKeys)
          .where(
            eq(schema.vendorPublicKeys.id, routeSnapshot.route.publicKeyId),
          )
          .limit(1);
  const gmailConnections =
    routeSnapshot.route.type === "EMAIL" &&
    submission.mailboxConnectionId !== null
      ? await app.db
          .select({ id: schema.mailboxConnections.id })
          .from(schema.mailboxConnections)
          .where(
            and(
              eq(schema.mailboxConnections.id, submission.mailboxConnectionId),
              eq(schema.mailboxConnections.provider, "gmail"),
              eq(schema.mailboxConnections.status, "ACTIVE"),
            ),
          )
          .limit(1)
      : [];
  const [researchCase] = await app.db
    .select({ disclosureEnabled: schema.cases.disclosureEnabled })
    .from(schema.cases)
    .where(eq(schema.cases.id, submission.caseId))
    .limit(1);
  const [latestRevision] = await app.db
    .select({ aiRunId: schema.submissionRevisions.aiRunId })
    .from(schema.submissionRevisions)
    .where(eq(schema.submissionRevisions.submissionId, submission.id))
    .orderBy(desc(schema.submissionRevisions.revision))
    .limit(1);
  const requiredFieldContent: Record<string, boolean> = {};
  if (routeSnapshot.route.type === "EMAIL") {
    for (const field of routeSnapshot.route.requiredFields) {
      requiredFieldContent[field] = submission.bodyMarkdown.trim().length > 0;
    }
  }
  const checkedAt = new Date().toISOString();
  const input: SubmissionValidationInput = {
    submissionId: submission.id,
    revision: submission.revision,
    routeSnapshot,
    subject: submission.subject,
    bodyMarkdown: submission.bodyMarkdown,
    manualFields: submission.manualFields as Record<string, string>,
    cryptoMode: submission.cryptoMode,
    attachments,
    requiredFieldContent,
    approvedVendorReport:
      reportExport?.report.audience === "VENDOR" &&
      ["APPROVED", "PUBLISHED"].includes(reportExport.report.status),
    completedReportExport:
      reportExport?.export.status === "COMPLETED" &&
      reportExport.export.format === "PDF" &&
      reportExport.export.artifactId !== null,
    aiDraftReviewed: latestRevision?.aiRunId == null,
    publicKey:
      key === undefined
        ? null
        : {
            id: key.id,
            verified: key.verifiedAt !== null && key.verifiedBy !== null,
            expired:
              key.expiresAt !== null &&
              Date.parse(key.expiresAt) <= Date.parse(checkedAt),
            revoked: key.revokedAt !== null,
            superseded: key.supersededById !== null,
            fingerprint: key.fingerprint,
          },
    gmailConnectionAvailable:
      routeSnapshot.route.type !== "EMAIL" || gmailConnections.length > 0,
    estimatedFinalMimeBytes:
      new TextEncoder().encode(submission.bodyMarkdown).byteLength +
      Math.ceil(
        attachments.reduce((total, item) => total + item.sizeBytes, 0) *
          (4 / 3),
      ) +
      8_192,
    disclosureAllowed: researchCase?.disclosureEnabled === true,
    tlpAllowsVendor: reportExport?.report.audience === "VENDOR",
    checkedAt,
    isReply: submission.replyToMessageId !== null,
  };
  const result = validateSubmission(input);

  return {
    submissionId: submission.id,
    revision: submission.revision,
    findings: result.findings,
    blocking: result.blocking,
    checkedAt,
  };
}

async function validationAttachments(
  db: Database,
  submission: typeof schema.submissions.$inferSelect,
): Promise<ValidationAttachment[]> {
  const attachments = await loadSubmissionAttachments(db, submission);
  const ids = attachments.map((item) => item.artifactId);
  const pocRows =
    ids.length === 0
      ? []
      : await db
          .select({
            artifactId: schema.pocArtifacts.artifactId,
            poc: schema.pocs,
          })
          .from(schema.pocArtifacts)
          .innerJoin(schema.pocs, eq(schema.pocs.id, schema.pocArtifacts.pocId))
          .where(inArray(schema.pocArtifacts.artifactId, ids));

  return attachments.map((attachment) => {
    const poc = pocRows.find(
      (row) => row.artifactId === attachment.artifactId,
    )?.poc;
    return {
      ...attachment,
      currentSourceRevision: poc?.revision ?? attachment.sourceRevision,
      pocApprovedForVendor:
        poc === undefined
          ? null
          : poc.status === "VERIFIED" && poc.visibility !== "INTERNAL",
    };
  });
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw validationError(
      "The package manifest contains an unsupported value.",
    );
  }
  return encoded;
}

export function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function buildManifest(
  app: AppInstance,
  submission: typeof schema.submissions.$inferSelect,
): Promise<{
  manifest: SubmissionPackageManifest;
  attachments: SubmissionAttachment[];
  publicKey: { armoredKey: string; fingerprint: string } | null;
}> {
  const attachments = await loadSubmissionAttachments(app.db, submission);
  const snapshot = submission.routeSnapshot as SubmissionRouteSnapshot;
  const keyId =
    snapshot.route.type === "EMAIL" ? snapshot.route.publicKeyId : null;
  const [key] =
    keyId === null
      ? []
      : await app.db
          .select()
          .from(schema.vendorPublicKeys)
          .where(eq(schema.vendorPublicKeys.id, keyId))
          .limit(1);
  const sources: SubmissionPackageManifest["sources"] = [
    {
      kind: "SUBMISSION",
      id: submission.id,
      revision: submission.revision,
      sha256: null,
    },
    {
      kind: "VENDOR_ROUTE",
      id: snapshot.routeId,
      revision: snapshot.routeRevision,
      sha256: sha256Utf8(canonicalJson(snapshot.route)),
    },
    ...attachments.map((item) => ({
      kind: "ARTIFACT" as const,
      id: item.artifactId,
      revision: item.sourceRevision,
      sha256: item.sha256,
    })),
  ];
  const replyTo =
    submission.replyToMessageId === null
      ? undefined
      : await app.db.query.correspondenceMessages.findFirst({
          where: (messages, { and, eq }) =>
            and(
              eq(messages.id, submission.replyToMessageId!),
              eq(messages.submissionId, submission.id),
            ),
        });
  if (
    submission.replyToMessageId !== null &&
    (replyTo === undefined || replyTo.providerThreadId === null)
  ) {
    throw conflict(
      "The selected reply message no longer has Gmail threading metadata.",
    );
  }
  if (key !== undefined) {
    sources.push({
      kind: "VENDOR_KEY",
      id: key.id,
      revision: key.revision,
      sha256: sha256Utf8(key.armoredKey),
    });
  }
  if (submission.reportExportId !== null) {
    const [reportExport] = await app.db
      .select()
      .from(schema.reportExports)
      .where(eq(schema.reportExports.id, submission.reportExportId))
      .limit(1);
    if (reportExport !== undefined) {
      sources.push({
        kind: "REPORT_EXPORT",
        id: reportExport.id,
        revision: null,
        sha256: reportExport.sha256,
      });
    }
  }

  return {
    manifest: {
      version: 1,
      submissionId: submission.id,
      submissionRevision: submission.revision,
      routeSnapshot: snapshot,
      subject: submission.subject,
      bodyUtf8Sha256: sha256Utf8(submission.bodyMarkdown),
      attachments,
      cryptoMode: submission.cryptoMode,
      publicKeyFingerprint: key?.fingerprint ?? null,
      threading:
        replyTo === undefined || replyTo.providerThreadId === null
          ? null
          : {
              providerThreadId: replyTo.providerThreadId,
              inReplyTo: replyTo.rfcMessageId,
              references: [
                ...new Set([...replyTo.references, replyTo.rfcMessageId]),
              ].slice(-100),
            },
      sources,
      createdAt: new Date().toISOString(),
    },
    attachments,
    publicKey:
      key === undefined
        ? null
        : { armoredKey: key.armoredKey, fingerprint: key.fingerprint },
  };
}

export function assertMutableSubmissionStatus(status: string): void {
  if (!["DRAFT", "IN_REVIEW", "APPROVED"].includes(status)) {
    throw conflict("A sealed or delivered submission cannot be edited.");
  }
}

export function assertExpectedRevision(actual: number, expected: number): void {
  if (actual !== expected) {
    throw conflict(
      "This submission changed since you loaded it. Review the latest version.",
      { expectedRevision: expected, currentRevision: actual },
    );
  }
}

export async function verifiedPackageBytes(
  app: AppInstance,
  objectKey: string,
  expectedSize: number,
  expectedSha256: string,
): Promise<void> {
  const stored = await app.storage.head(objectKey);
  if (stored === null || stored.sizeBytes !== expectedSize) {
    throw validationError(
      "The uploaded package size does not match the seal request.",
    );
  }
  const bytes = await app.storage.getObject(objectKey);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expectedSha256) {
    throw validationError(
      "The uploaded package digest does not match the seal request.",
    );
  }
}

export function newPackageArtifact(caseId: string, ref: string, email = false) {
  const artifactId = uuidv7();
  return {
    artifactId,
    objectKey: generateObjectKey(caseId, artifactId),
    filename: `${ref.toLowerCase()}-sealed-package.${email ? "eml" : "zip"}`,
  };
}

export function serverFailure(message: string): never {
  throw new DomainError("SERVER_ERROR", message);
}
