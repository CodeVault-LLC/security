import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Type } from "@sinclair/typebox";

import {
  ApproveSubmissionRequest,
  CompleteSubmissionSealRequest,
  CreateSubmissionRequest,
  ErrorResponse,
  RecordManualDeliveryRequest,
  ReviewSubmissionRequest,
  SetSubmissionAttachmentsRequest,
  SubmissionDetail,
  SubmissionPackage,
  SubmissionSealIntent,
  SubmissionSummary,
  SubmissionValidationResult,
  UpdateSubmissionRequest,
  Uuid,
  type CreateVendorRouteRequest,
  type SubmissionPackageManifest,
  type SubmissionRouteSnapshot,
} from "@codevault/contracts";
import { conflict, DomainError, validationError } from "@codevault/core";
import { allocateReference, schema } from "@codevault/db";

import type { AppInstance } from "../../http/app-instance.js";
import { actingUser, principalOf, requireAuthor } from "../../http/guards.js";
import {
  requireCaseRead,
  requireCaseWrite,
} from "../../services/case-access.js";
import { requireVendor } from "../vendors/service.js";
import {
  assertExpectedRevision,
  assertMutableSubmissionStatus,
  buildManifest,
  canonicalJson,
  evaluateSubmission,
  loadSubmissionDetail,
  newPackageArtifact,
  requireSubmissionRead,
  requireSubmissionWrite,
  serverFailure,
  sha256Utf8,
  toSubmissionSummary,
  verifiedPackageBytes,
  writeSubmissionRevision,
} from "./service.js";

const CaseIdParam = Type.Object({ caseId: Uuid });
const SubmissionIdParam = Type.Object({ id: Uuid });

function assertRouteCrypto(
  route: CreateVendorRouteRequest,
  cryptoMode: "PLAIN" | "ENCRYPTED" | "SIGNED_AND_ENCRYPTED",
): void {
  if (route.type === "MANUAL" && cryptoMode !== "PLAIN") {
    throw validationError("Manual routes require a plain bundle.");
  }
  if (
    route.type === "EMAIL" &&
    route.encryptionPolicy === "REQUIRED" &&
    cryptoMode !== "ENCRYPTED"
  ) {
    throw validationError("This vendor route requires OpenPGP encryption.");
  }
  if (
    route.type === "EMAIL" &&
    route.encryptionPolicy === "FORBIDDEN" &&
    cryptoMode !== "PLAIN"
  ) {
    throw validationError("This vendor route does not accept encrypted email.");
  }
}

function initialManualFields(
  route: CreateVendorRouteRequest,
): Record<string, string> {
  return route.type === "MANUAL"
    ? Object.fromEntries(route.fieldMappings.map((field) => [field.key, ""]))
    : {};
}

function initialSubject(
  route: CreateVendorRouteRequest,
  caseRef: string,
): string {
  return route.type === "EMAIL"
    ? route.subjectTemplate.replaceAll("{caseRef}", caseRef)
    : "";
}

export async function registerSubmissionRoutes(
  app: AppInstance,
): Promise<void> {
  app.post(
    "/v1/cases/:caseId/submissions",
    {
      schema: {
        params: CaseIdParam,
        body: CreateSubmissionRequest,
        response: {
          200: SubmissionDetail,
          400: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const access = await requireCaseWrite(
        app.db,
        user,
        request.params.caseId,
      );
      const vendor = await requireVendor(app.db, request.body.vendorId);
      if (vendor.archivedAt !== null)
        throw validationError(
          "Archived vendors cannot receive new submissions.",
        );

      const [routeRow] = await app.db
        .select()
        .from(schema.vendorRoutes)
        .where(eq(schema.vendorRoutes.id, request.body.routeId))
        .limit(1);
      if (
        routeRow === undefined ||
        routeRow.vendorId !== vendor.id ||
        !routeRow.active
      ) {
        throw validationError(
          "Select an active route belonging to this vendor.",
        );
      }
      const route = routeRow.requirements as CreateVendorRouteRequest;
      assertRouteCrypto(route, request.body.cryptoMode);
      const now = new Date().toISOString();
      const routeSnapshot: SubmissionRouteSnapshot = {
        routeId: routeRow.id,
        routeRevision: routeRow.revision,
        vendorId: vendor.id,
        capturedAt: now,
        route,
      };

      const submissionId = await app.db.transaction(async (tx) => {
        const ref = await allocateReference(tx, "submission");
        const [created] = await tx
          .insert(schema.submissions)
          .values({
            ref,
            caseId: access.caseId,
            vendorId: vendor.id,
            routeId: routeRow.id,
            routeSnapshot,
            cryptoMode: request.body.cryptoMode,
            subject: initialSubject(route, access.ref),
            bodyMarkdown: "",
            manualFields: initialManualFields(route),
            createdBy: user.id,
            lastEditedBy: user.id,
          })
          .returning();
        if (created === undefined)
          serverFailure("Could not create the submission.");
        await writeSubmissionRevision(tx, created, user.id);
        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "submission.created",
            entityType: "submission",
            entityId: created.id,
            caseId: access.caseId,
            after: {
              ref,
              vendorId: vendor.id,
              routeId: routeRow.id,
              cryptoMode: request.body.cryptoMode,
            },
          },
        );
        return created.id;
      });
      return loadSubmissionDetail(app, submissionId);
    },
  );

  app.get(
    "/v1/cases/:caseId/submissions",
    {
      schema: {
        params: CaseIdParam,
        response: { 200: Type.Array(SubmissionSummary), 404: ErrorResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      await requireCaseRead(app.db, user, request.params.caseId);
      const rows = await app.db
        .select({ submission: schema.submissions, vendor: schema.vendors })
        .from(schema.submissions)
        .innerJoin(
          schema.vendors,
          eq(schema.vendors.id, schema.submissions.vendorId),
        )
        .where(eq(schema.submissions.caseId, request.params.caseId))
        .orderBy(
          desc(schema.submissions.updatedAt),
          desc(schema.submissions.id),
        );
      return rows.map(({ submission, vendor }) =>
        toSubmissionSummary(submission, vendor),
      );
    },
  );

  app.get(
    "/v1/submissions/:id",
    {
      schema: {
        params: SubmissionIdParam,
        response: { 200: SubmissionDetail, 404: ErrorResponse },
      },
    },
    async (request) => {
      await requireSubmissionRead(app, actingUser(request), request.params.id);
      return loadSubmissionDetail(app, request.params.id);
    },
  );

  app.patch(
    "/v1/submissions/:id",
    {
      schema: {
        params: SubmissionIdParam,
        body: UpdateSubmissionRequest,
        response: {
          200: SubmissionDetail,
          400: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const existing = await requireSubmissionWrite(
        app,
        user,
        request.params.id,
      );
      assertExpectedRevision(existing.revision, request.body.expectedRevision);
      assertMutableSubmissionStatus(existing.status);
      const snapshot = existing.routeSnapshot as SubmissionRouteSnapshot;
      const cryptoMode = request.body.cryptoMode ?? existing.cryptoMode;
      assertRouteCrypto(snapshot.route, cryptoMode);

      await app.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(schema.submissions)
          .set({
            ...(request.body.subject === undefined
              ? {}
              : { subject: request.body.subject }),
            ...(request.body.bodyMarkdown === undefined
              ? {}
              : { bodyMarkdown: request.body.bodyMarkdown }),
            ...(request.body.manualFields === undefined
              ? {}
              : { manualFields: request.body.manualFields }),
            cryptoMode,
            status:
              existing.status === "APPROVED" ? "IN_REVIEW" : existing.status,
            lastEditedBy: user.id,
            revision: existing.revision + 1,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(schema.submissions.id, existing.id),
              eq(schema.submissions.revision, existing.revision),
            ),
          )
          .returning();
        if (updated === undefined)
          throw conflict("The submission changed while it was being saved.");
        await writeSubmissionRevision(tx, updated, user.id);
        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "submission.updated",
            entityType: "submission",
            entityId: existing.id,
            caseId: existing.caseId,
            before: { revision: existing.revision, status: existing.status },
            after: { revision: updated.revision, status: updated.status },
          },
        );
      });
      return loadSubmissionDetail(app, existing.id);
    },
  );

  app.post(
    "/v1/submissions/:id/attachments",
    {
      schema: {
        params: SubmissionIdParam,
        body: SetSubmissionAttachmentsRequest,
        response: {
          200: SubmissionDetail,
          400: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const existing = await requireSubmissionWrite(
        app,
        user,
        request.params.id,
      );
      assertExpectedRevision(existing.revision, request.body.expectedRevision);
      assertMutableSubmissionStatus(existing.status);

      const artifacts =
        request.body.artifactIds.length === 0
          ? []
          : await app.db
              .select()
              .from(schema.artifacts)
              .where(inArray(schema.artifacts.id, request.body.artifactIds));
      if (
        artifacts.length !== request.body.artifactIds.length ||
        artifacts.some((item) => item.caseId !== existing.caseId)
      ) {
        throw validationError(
          "Every selected artifact must belong to this case.",
        );
      }
      if (request.body.reportExportId !== null) {
        const [selectedExport] = await app.db
          .select({ report: schema.reports })
          .from(schema.reportExports)
          .innerJoin(
            schema.reports,
            eq(schema.reports.id, schema.reportExports.reportId),
          )
          .where(eq(schema.reportExports.id, request.body.reportExportId))
          .limit(1);
        if (
          selectedExport === undefined ||
          selectedExport.report.caseId !== existing.caseId ||
          selectedExport.report.audience !== "VENDOR"
        ) {
          throw validationError(
            "Select a vendor report export from this case.",
          );
        }
      }

      await app.db.transaction(async (tx) => {
        await tx
          .delete(schema.submissionAttachments)
          .where(eq(schema.submissionAttachments.submissionId, existing.id));
        if (request.body.artifactIds.length > 0) {
          const pocRows = await tx
            .select({
              artifactId: schema.pocArtifacts.artifactId,
              revision: schema.pocs.revision,
            })
            .from(schema.pocArtifacts)
            .innerJoin(
              schema.pocs,
              eq(schema.pocs.id, schema.pocArtifacts.pocId),
            )
            .where(
              inArray(schema.pocArtifacts.artifactId, request.body.artifactIds),
            );
          await tx.insert(schema.submissionAttachments).values(
            request.body.artifactIds.map((artifactId, position) => ({
              submissionId: existing.id,
              artifactId,
              position,
              sourceRevision:
                pocRows.find((item) => item.artifactId === artifactId)
                  ?.revision ?? null,
              createdBy: user.id,
            })),
          );
        }
        const [updated] = await tx
          .update(schema.submissions)
          .set({
            reportExportId: request.body.reportExportId,
            status:
              existing.status === "APPROVED" ? "IN_REVIEW" : existing.status,
            lastEditedBy: user.id,
            revision: existing.revision + 1,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(schema.submissions.id, existing.id),
              eq(schema.submissions.revision, existing.revision),
            ),
          )
          .returning();
        if (updated === undefined)
          throw conflict(
            "The submission changed while attachments were being saved.",
          );
        await writeSubmissionRevision(tx, updated, user.id);
        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "submission.attachments_updated",
            entityType: "submission",
            entityId: existing.id,
            caseId: existing.caseId,
            after: {
              revision: updated.revision,
              artifactIds: request.body.artifactIds,
              reportExportId: request.body.reportExportId,
            },
          },
        );
      });
      return loadSubmissionDetail(app, existing.id);
    },
  );

  app.get(
    "/v1/submissions/:id/validation",
    {
      schema: {
        params: SubmissionIdParam,
        response: { 200: SubmissionValidationResult, 404: ErrorResponse },
      },
    },
    async (request) => {
      await requireSubmissionRead(app, actingUser(request), request.params.id);
      return evaluateSubmission(app, request.params.id);
    },
  );

  app.post(
    "/v1/submissions/:id/review",
    {
      schema: {
        params: SubmissionIdParam,
        body: ReviewSubmissionRequest,
        response: { 200: SubmissionDetail, 409: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const existing = await requireSubmissionWrite(
        app,
        user,
        request.params.id,
      );
      assertExpectedRevision(existing.revision, request.body.expectedRevision);
      if (!["DRAFT", "IN_REVIEW"].includes(existing.status))
        throw conflict("Only draft submissions can enter review.");
      await app.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(schema.submissions)
          .set({
            status: "IN_REVIEW",
            revision: existing.revision + 1,
            lastEditedBy: user.id,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(schema.submissions.id, existing.id),
              eq(schema.submissions.revision, existing.revision),
            ),
          )
          .returning();
        if (updated === undefined)
          throw conflict("The submission changed while review was starting.");
        await writeSubmissionRevision(tx, updated, user.id);
        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "submission.review_started",
            entityType: "submission",
            entityId: existing.id,
            caseId: existing.caseId,
            after: { revision: updated.revision },
          },
        );
      });
      return loadSubmissionDetail(app, existing.id);
    },
  );

  app.post(
    "/v1/submissions/:id/approve",
    {
      schema: {
        params: SubmissionIdParam,
        body: ApproveSubmissionRequest,
        response: {
          200: SubmissionDetail,
          400: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const existing = await requireSubmissionWrite(
        app,
        user,
        request.params.id,
      );
      assertExpectedRevision(existing.revision, request.body.expectedRevision);
      if (existing.status !== "IN_REVIEW")
        throw conflict("The submission must be in review before approval.");
      const validation = await evaluateSubmission(app, existing.id);
      if (validation.blocking)
        throw validationError(
          "Resolve every blocking validation finding before approval.",
          { findings: validation.findings },
        );
      await app.db.transaction(async (tx) => {
        const nextRevision = existing.revision + 1;
        const [updated] = await tx
          .update(schema.submissions)
          .set({
            status: "APPROVED",
            revision: nextRevision,
            lastEditedBy: user.id,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(schema.submissions.id, existing.id),
              eq(schema.submissions.revision, existing.revision),
            ),
          )
          .returning();
        if (updated === undefined)
          throw conflict("The submission changed while it was being approved.");
        await writeSubmissionRevision(tx, updated, user.id);
        await tx.insert(schema.submissionApprovals).values({
          submissionId: existing.id,
          submissionRevision: nextRevision,
          approvedBy: user.id,
          note: request.body.note ?? null,
        });
        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "submission.approved",
            entityType: "submission",
            entityId: existing.id,
            caseId: existing.caseId,
            after: { revision: nextRevision },
          },
        );
      });
      return loadSubmissionDetail(app, existing.id);
    },
  );

  app.post(
    "/v1/submissions/:id/seal-intent",
    {
      schema: {
        params: SubmissionIdParam,
        response: {
          200: SubmissionSealIntent,
          400: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const existing = await requireSubmissionWrite(
        app,
        user,
        request.params.id,
      );
      if (existing.status !== "APPROVED")
        throw conflict("Only an approved submission can be sealed.");
      const validation = await evaluateSubmission(app, existing.id);
      if (validation.blocking)
        throw validationError(
          "The approved submission no longer passes validation.",
          { findings: validation.findings },
        );
      const [approval] = await app.db
        .select({ id: schema.submissionApprovals.id })
        .from(schema.submissionApprovals)
        .where(
          and(
            eq(schema.submissionApprovals.submissionId, existing.id),
            eq(
              schema.submissionApprovals.submissionRevision,
              existing.revision,
            ),
          ),
        )
        .limit(1);
      if (approval === undefined)
        throw conflict(
          "The current submission revision has not been approved.",
        );

      const built = await buildManifest(app, existing);
      const manifestSha256 = sha256Utf8(canonicalJson(built.manifest));
      const artifact = newPackageArtifact(existing.caseId, existing.ref);
      const upload = await app.storage.createUpload(
        artifact.objectKey,
        "application/octet-stream",
        1,
      );
      if (upload.strategy !== "SINGLE" || upload.url === null)
        throw new DomainError(
          "SERVER_ERROR",
          "Could not create a package upload target.",
        );
      const expiresAt = new Date(
        Math.min(Date.now() + 15 * 60_000, Date.parse(upload.expiresAt)),
      ).toISOString();
      const intentId = await app.db.transaction(async (tx) => {
        const [storedArtifact] = await tx
          .insert(schema.artifacts)
          .values({
            id: artifact.artifactId,
            caseId: existing.caseId,
            filename: artifact.filename,
            objectKey: artifact.objectKey,
            mimeType: "application/octet-stream",
            sizeBytes: 0,
            sha256: "0".repeat(64),
            artifactKind: "DOCUMENT",
            visibility: "INTERNAL",
            status: "PENDING",
            uploadedBy: user.id,
          })
          .returning({ id: schema.artifacts.id });
        if (storedArtifact === undefined)
          serverFailure("Could not reserve package storage.");
        const [intent] = await tx
          .insert(schema.submissionSealIntents)
          .values({
            submissionId: existing.id,
            submissionRevision: existing.revision,
            artifactId: artifact.artifactId,
            manifest: built.manifest,
            manifestSha256,
            expiresAt,
            createdBy: user.id,
          })
          .returning({ id: schema.submissionSealIntents.id });
        if (intent === undefined)
          serverFailure("Could not create the seal intent.");
        return intent.id;
      });
      const attachmentRows = await app.db
        .select({ artifact: schema.artifacts })
        .from(schema.artifacts)
        .where(
          inArray(
            schema.artifacts.id,
            built.attachments.map((item) => item.artifactId),
          ),
        );
      const attachments = await Promise.all(
        built.attachments.map(async (item) => {
          const row = attachmentRows.find(
            ({ artifact: candidate }) => candidate.id === item.artifactId,
          )?.artifact;
          if (row === undefined)
            serverFailure("A selected attachment disappeared while sealing.");
          const download = await app.storage.createDownloadUrl(
            row.objectKey,
            row.filename,
          );
          return { ...item, downloadUrl: download.url };
        }),
      );
      return {
        id: intentId,
        submissionId: existing.id,
        expiresAt,
        subject: existing.subject,
        bodyText: existing.bodyMarkdown,
        manualFields: existing.manualFields as Record<string, string>,
        attachments,
        cryptoMode: existing.cryptoMode,
        publicKey: built.publicKey,
        manifest: built.manifest,
        manifestSha256,
        uploadUrl: upload.url,
      };
    },
  );

  app.post(
    "/v1/submissions/:id/seal",
    {
      schema: {
        params: SubmissionIdParam,
        body: CompleteSubmissionSealRequest,
        response: {
          200: SubmissionPackage,
          400: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const existing = await requireSubmissionWrite(
        app,
        user,
        request.params.id,
      );
      const [intent] = await app.db
        .select({
          intent: schema.submissionSealIntents,
          artifact: schema.artifacts,
        })
        .from(schema.submissionSealIntents)
        .innerJoin(
          schema.artifacts,
          eq(schema.artifacts.id, schema.submissionSealIntents.artifactId),
        )
        .where(
          and(
            eq(schema.submissionSealIntents.id, request.body.intentId),
            eq(schema.submissionSealIntents.submissionId, existing.id),
          ),
        )
        .limit(1);
      if (intent === undefined)
        throw conflict("The seal intent is not valid for this submission.");
      if (intent.intent.consumedAt !== null)
        throw conflict("This seal intent has already been used.");
      if (Date.parse(intent.intent.expiresAt) <= Date.now())
        throw conflict("This seal intent has expired.");
      if (
        existing.status !== "APPROVED" ||
        existing.revision !== intent.intent.submissionRevision
      )
        throw conflict(
          "The approved submission changed after the seal intent was created.",
        );
      await verifiedPackageBytes(
        app,
        intent.artifact.objectKey,
        request.body.sizeBytes,
        request.body.sha256,
      );

      const packageId = await app.db.transaction(async (tx) => {
        const [consumed] = await tx
          .update(schema.submissionSealIntents)
          .set({ consumedAt: sql`now()` })
          .where(
            and(
              eq(schema.submissionSealIntents.id, intent.intent.id),
              sql`${schema.submissionSealIntents.consumedAt} IS NULL`,
            ),
          )
          .returning({ id: schema.submissionSealIntents.id });
        if (consumed === undefined)
          throw conflict("This seal intent has already been used.");
        await tx
          .update(schema.artifacts)
          .set({
            status: "STORED",
            sizeBytes: request.body.sizeBytes,
            sha256: request.body.sha256,
            updatedAt: sql`now()`,
          })
          .where(eq(schema.artifacts.id, intent.artifact.id));
        const [pkg] = await tx
          .insert(schema.submissionPackages)
          .values({
            submissionId: existing.id,
            intentId: intent.intent.id,
            manifest: intent.intent.manifest,
            manifestSha256: intent.intent.manifestSha256,
            packageSha256: request.body.sha256,
            artifactId: intent.artifact.id,
            sizeBytes: request.body.sizeBytes,
            rfcMessageId: request.body.rfcMessageId,
            createdBy: user.id,
          })
          .returning({ id: schema.submissionPackages.id });
        if (pkg === undefined)
          serverFailure("Could not record the sealed package.");
        const [updated] = await tx
          .update(schema.submissions)
          .set({
            status: "SEALED",
            revision: existing.revision + 1,
            lastEditedBy: user.id,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(schema.submissions.id, existing.id),
              eq(schema.submissions.revision, existing.revision),
            ),
          )
          .returning();
        if (updated === undefined)
          throw conflict("The submission changed while it was being sealed.");
        await writeSubmissionRevision(tx, updated, user.id);
        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "submission.sealed",
            entityType: "submission",
            entityId: existing.id,
            caseId: existing.caseId,
            after: {
              revision: updated.revision,
              packageSha256: request.body.sha256,
              manifestSha256: intent.intent.manifestSha256,
            },
          },
        );
        return pkg.id;
      });
      const [pkg] = await app.db
        .select({ package: schema.submissionPackages, user: schema.users })
        .from(schema.submissionPackages)
        .innerJoin(
          schema.users,
          eq(schema.users.id, schema.submissionPackages.createdBy),
        )
        .where(eq(schema.submissionPackages.id, packageId))
        .limit(1);
      if (pkg === undefined)
        serverFailure("Could not load the sealed package.");
      return {
        id: pkg.package.id,
        submissionId: pkg.package.submissionId,
        manifest: pkg.package.manifest as SubmissionPackageManifest,
        manifestSha256: pkg.package.manifestSha256,
        packageSha256: pkg.package.packageSha256,
        sizeBytes: pkg.package.sizeBytes,
        rfcMessageId: pkg.package.rfcMessageId,
        createdBy: {
          id: pkg.user.id,
          displayName: pkg.user.displayName,
          email: pkg.user.email,
        },
        createdAt: pkg.package.createdAt,
      };
    },
  );

  app.post(
    "/v1/submissions/:id/manual-deliveries",
    {
      schema: {
        params: SubmissionIdParam,
        body: RecordManualDeliveryRequest,
        response: {
          200: SubmissionDetail,
          400: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const principal = principalOf(request);
      const existing = await requireSubmissionWrite(
        app,
        user,
        request.params.id,
      );
      const snapshot = existing.routeSnapshot as SubmissionRouteSnapshot;
      if (snapshot.route.type !== "MANUAL")
        throw validationError("Only manual routes can be recorded manually.");
      const manualRoute = snapshot.route;
      if (existing.status !== "SEALED")
        throw conflict("Seal the exact package before recording delivery.");
      if (request.body.destinationUrl !== manualRoute.destinationUrl)
        throw validationError(
          "The delivery destination must exactly match the approved route snapshot.",
        );
      const [pkg] = await app.db
        .select()
        .from(schema.submissionPackages)
        .where(
          and(
            eq(schema.submissionPackages.id, request.body.packageId),
            eq(schema.submissionPackages.submissionId, existing.id),
          ),
        )
        .limit(1);
      if (pkg === undefined)
        throw validationError(
          "The selected sealed package does not belong to this submission.",
        );
      await app.db.transaction(async (tx) => {
        const [delivery] = await tx
          .insert(schema.submissionDeliveries)
          .values({
            submissionId: existing.id,
            packageId: pkg.id,
            provider: null,
            status: "RECORDED_MANUALLY",
            recipients: { to: [manualRoute.destinationUrl], cc: [] },
            routeSnapshot: snapshot,
            sentAt: request.body.deliveredAt,
            responseSizeBytes: pkg.sizeBytes,
            createdBy: user.id,
          })
          .returning({ id: schema.submissionDeliveries.id });
        if (delivery === undefined)
          serverFailure("Could not record the manual delivery.");
        const [updated] = await tx
          .update(schema.submissions)
          .set({
            status: "RECORDED_MANUALLY",
            coordinationState: "AWAITING_ACKNOWLEDGEMENT",
            vendorReference: request.body.externalReference ?? null,
            revision: existing.revision + 1,
            lastEditedBy: user.id,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(schema.submissions.id, existing.id),
              eq(schema.submissions.revision, existing.revision),
            ),
          )
          .returning();
        if (updated === undefined)
          throw conflict(
            "The submission changed while delivery was being recorded.",
          );
        await writeSubmissionRevision(tx, updated, user.id);
        await tx.insert(schema.disclosureEvents).values({
          caseId: existing.caseId,
          type: "DETAILS_SENT",
          occurredAt: request.body.deliveredAt,
          detailMarkdown: `Manual delivery recorded. Package SHA-256: ${pkg.packageSha256}${request.body.externalReference === undefined ? "" : `. Reference: ${request.body.externalReference}`}`,
          artifactIds: [pkg.artifactId],
          visibility: "VENDOR",
          recordedBy: user.id,
        });
        await app.audit.write(
          tx,
          {
            actorId: user.id,
            sessionId: principal.session.id,
            requestId: request.requestId,
          },
          {
            action: "submission.manual_delivery_recorded",
            entityType: "submission_delivery",
            entityId: delivery.id,
            caseId: existing.caseId,
            after: {
              submissionId: existing.id,
              packageSha256: pkg.packageSha256,
              destinationUrl: request.body.destinationUrl,
            },
          },
        );
      });
      app.events.publish({
        type: "entity.changed",
        entityType: "submission",
        entityId: existing.id,
        caseId: existing.caseId,
      });
      return loadSubmissionDetail(app, existing.id);
    },
  );
}
