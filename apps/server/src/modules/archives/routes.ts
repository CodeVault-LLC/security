import { createHash, randomUUID } from "node:crypto";

import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { Type } from "@sinclair/typebox";

import type { AppInstance } from "../../http/app-instance.js";
import {
  CaseArchiveSnapshot,
  CommitCaseArchiveImportRequest,
  ErrorResponse,
  IdParam,
  ImportCaseArchiveResult,
  PrepareCaseArchiveImportRequest,
  PrepareCaseArchiveImportResult,
} from "@codevault/contracts";
import {
  defaultPolicyPackForProfile,
  notFound,
  validationError,
  ARTIFACT_KINDS,
  CONTENT_VISIBILITIES,
  type ArtifactKind,
  type CaseProfile,
  type CaseStatus,
  type ContentVisibility,
} from "@codevault/core";
import { generateObjectKey } from "@codevault/core/crypto";
import { allocateReference, schema } from "@codevault/db";
import { CVCASE_FORMAT, type CvcaseManifest } from "@codevault/exchange";

import { actingUser, principalOf, requireAuthor } from "../../http/guards.js";
import { requireCaseRead } from "../../services/case-access.js";
import { SERVER_VERSION } from "../../version.js";

const ArchiveImportParam = Type.Object({ id: Type.String({ format: "uuid" }) });
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function registerArchiveRoutes(app: AppInstance): Promise<void> {
  app.get(
    "/v1/cases/:id/archive-snapshot",
    {
      schema: {
        params: IdParam,
        response: { 200: CaseArchiveSnapshot, 404: ErrorResponse },
      },
    },
    async (request) => {
      const user = actingUser(request);
      await requireCaseRead(app.db, user, request.params.id);
      const records = await exportRecords(app, request.params.id);
      const researchCase = record(records, "case");
      const artifacts = recordRows(records, "artifacts");
      const storedArtifactRows =
        artifacts.length === 0
          ? []
          : await app.db
              .select({
                id: schema.artifacts.id,
                objectKey: schema.artifacts.objectKey,
              })
              .from(schema.artifacts)
              .where(
                inArray(
                  schema.artifacts.id,
                  artifacts.map((artifact) => stringField(artifact, "id")),
                ),
              );
      const objectKeys = new Map(
        storedArtifactRows.map((artifact) => [artifact.id, artifact.objectKey]),
      );
      const manifestArtifacts = artifacts.map((artifact) => ({
        sourceId: stringField(artifact, "id"),
        archivePath: `artifacts/${stringField(artifact, "id")}/blob`,
        filename: stringField(artifact, "filename"),
        mimeType: stringField(artifact, "mimeType"),
        sizeBytes: numberField(artifact, "sizeBytes"),
        sha256: stringField(artifact, "sha256"),
        visibility: stringField(artifact, "visibility") as ContentVisibility,
        artifactKind: stringField(artifact, "artifactKind"),
        capturedAt: nullableStringField(artifact, "capturedAt"),
        metadata: recordField(artifact, "metadata"),
      }));
      const counts = Object.fromEntries(
        Object.entries(records)
          .filter(([, value]) => Array.isArray(value))
          .map(([key, value]) => [key, (value as unknown[]).length]),
      );
      const manifest: CvcaseManifest = {
        format: CVCASE_FORMAT,
        version: 2,
        exportedAt: new Date().toISOString(),
        sourceVersion: SERVER_VERSION,
        case: {
          sourceId: stringField(researchCase, "id"),
          ref: stringField(researchCase, "ref"),
          title: stringField(researchCase, "title"),
        },
        recordCounts: counts,
        artifacts: manifestArtifacts,
      };
      const transfers = await Promise.all(
        artifacts.map(async (artifact) => {
          const download = await app.storage.createDownloadUrl(
            objectKeys.get(stringField(artifact, "id")) ??
              (() => {
                throw notFound("Artifact");
              })(),
            stringField(artifact, "filename"),
          );
          return {
            sourceId: stringField(artifact, "id"),
            url: download.url,
            expiresAt: download.expiresAt,
            filename: stringField(artifact, "filename"),
            sizeBytes: numberField(artifact, "sizeBytes"),
            sha256: stringField(artifact, "sha256"),
          };
        }),
      );
      await app.audit.write(
        app.db,
        {
          actorId: user.id,
          sessionId: principalOf(request).session.id,
          requestId: request.requestId,
        },
        {
          action: "case.archive_exported",
          entityType: "case",
          entityId: request.params.id,
          caseId: request.params.id,
          after: { recordCounts: counts, artifactCount: transfers.length },
        },
      );
      return { manifest: { ...manifest }, records, artifacts: transfers };
    },
  );

  app.post(
    "/v1/case-archives/imports",
    {
      schema: {
        body: PrepareCaseArchiveImportRequest,
        response: { 200: PrepareCaseArchiveImportResult, 400: ErrorResponse },
      },
      config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    },
    async (request) => {
      const user = requireAuthor(request);
      const manifest = parseManifest(request.body.manifest);
      validateRecords(request.body.records, manifest.version);
      validateArchiveConsistency(manifest, request.body.records);
      const importId = randomUUID();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
      const prepared: Array<{
        manifest: CvcaseManifest["artifacts"][number];
        objectKey: string;
        instructions: Awaited<ReturnType<typeof app.storage.createUpload>>;
      }> = [];
      try {
        for (const artifact of manifest.artifacts) {
          if (artifact.sizeBytes > app.config.storage.maxUploadBytes) {
            throw validationError(
              `Archive artifact ${artifact.filename} exceeds the upload limit.`,
            );
          }
          const objectKey = generateObjectKey(importId, randomUUID());
          prepared.push({
            manifest: artifact,
            objectKey,
            instructions: await app.storage.createUpload(
              objectKey,
              artifact.mimeType,
              artifact.sizeBytes,
              artifact.sha256,
            ),
          });
        }
        await app.db.transaction(async (tx) => {
          await tx.insert(schema.caseArchiveImports).values({
            id: importId,
            organizationId: user.organizationId,
            manifest: request.body.manifest,
            records: request.body.records,
            createdBy: user.id,
            expiresAt,
          });
          if (prepared.length > 0) {
            await tx.insert(schema.caseArchiveImportArtifacts).values(
              prepared.map((item) => ({
                importId,
                sourceId: item.manifest.sourceId,
                objectKey: item.objectKey,
                filename: item.manifest.filename,
                mimeType: item.manifest.mimeType,
                sizeBytes: item.manifest.sizeBytes,
                sha256: item.manifest.sha256,
                artifactKind: item.manifest.artifactKind,
                visibility: item.manifest.visibility,
                capturedAt: item.manifest.capturedAt ?? null,
                metadata: item.manifest.metadata ?? {},
                multipartUploadId: item.instructions.multipartUploadId,
              })),
            );
          }
        });
      } catch (error: unknown) {
        await Promise.all(
          prepared.map((item) =>
            item.instructions.multipartUploadId === null
              ? app.storage.deleteObject(item.objectKey).catch(() => undefined)
              : app.storage
                  .abortMultipartUpload(
                    item.objectKey,
                    item.instructions.multipartUploadId,
                  )
                  .catch(() => undefined),
          ),
        );
        throw error;
      }
      return {
        importId,
        expiresAt,
        uploads: prepared.map((item) => ({
          sourceId: item.manifest.sourceId,
          strategy: item.instructions.strategy,
          url: item.instructions.url,
          multipartUploadId: item.instructions.multipartUploadId,
          partSizeBytes: item.instructions.partSizeBytes,
          partUrls: item.instructions.partUrls,
          requiredHeaders: item.instructions.requiredHeaders,
          expiresAt: item.instructions.expiresAt,
        })),
      };
    },
  );

  app.post(
    "/v1/case-archives/imports/:id/commit",
    {
      schema: {
        params: ArchiveImportParam,
        body: CommitCaseArchiveImportRequest,
        response: { 200: ImportCaseArchiveResult, 400: ErrorResponse },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const [session] = await app.db
        .select()
        .from(schema.caseArchiveImports)
        .where(
          and(
            eq(schema.caseArchiveImports.id, request.params.id),
            eq(schema.caseArchiveImports.organizationId, user.organizationId),
            eq(schema.caseArchiveImports.createdBy, user.id),
          ),
        )
        .limit(1);
      if (session === undefined) throw notFound("Case archive import");
      if (session.status !== "PREPARED") {
        throw validationError("That case archive import is no longer pending.");
      }
      if (new Date(session.expiresAt).getTime() <= Date.now()) {
        throw validationError("That case archive import has expired.");
      }
      const artifactRows = await app.db
        .select()
        .from(schema.caseArchiveImportArtifacts)
        .where(eq(schema.caseArchiveImportArtifacts.importId, session.id));
      const completions = new Map(
        request.body.uploads.map((item) => [item.sourceId, item.parts]),
      );
      if (completions.size !== artifactRows.length) {
        throw validationError(
          "Every archive artifact needs one upload result.",
        );
      }
      for (const artifact of artifactRows) {
        const parts = completions.get(artifact.sourceId);
        if (parts === undefined) {
          throw validationError(
            `Archive artifact ${artifact.filename} was not uploaded.`,
          );
        }
        let stored = await app.storage.head(artifact.objectKey);
        if (artifact.multipartUploadId !== null && stored === null) {
          if (parts.length === 0) {
            throw validationError(
              `Archive artifact ${artifact.filename} has no multipart results.`,
            );
          }
          await app.storage.completeMultipartUpload(
            artifact.objectKey,
            artifact.multipartUploadId,
            parts,
          );
        }
        stored = await app.storage.head(artifact.objectKey);
        if (stored === null || stored.sizeBytes !== artifact.sizeBytes) {
          throw validationError(
            `Archive artifact ${artifact.filename} has the wrong stored size.`,
          );
        }
        const hash = createHash("sha256");
        for await (const chunk of await app.storage.getObjectStream(
          artifact.objectKey,
        )) {
          hash.update(chunk);
        }
        if (hash.digest("hex") !== artifact.sha256) {
          throw validationError(
            `Archive artifact ${artifact.filename} failed digest verification.`,
          );
        }
      }

      const result = await importRecords(app, {
        records: session.records,
        artifacts: artifactRows,
        user,
        sessionId: principalOf(request).session.id,
        requestId: request.requestId,
        importId: session.id,
      });
      app.events.publish({
        type: "entity.changed",
        entityType: "case",
        entityId: result.caseId,
        caseId: result.caseId,
      });
      return result;
    },
  );

  app.delete(
    "/v1/case-archives/imports/:id",
    {
      schema: {
        params: ArchiveImportParam,
        response: { 200: Type.Object({ ok: Type.Literal(true) }) },
      },
    },
    async (request) => {
      const user = requireAuthor(request);
      const [session] = await app.db
        .select()
        .from(schema.caseArchiveImports)
        .where(
          and(
            eq(schema.caseArchiveImports.id, request.params.id),
            eq(schema.caseArchiveImports.organizationId, user.organizationId),
            eq(schema.caseArchiveImports.createdBy, user.id),
          ),
        )
        .limit(1);
      if (session === undefined) throw notFound("Case archive import");
      if (session.status === "COMMITTED") {
        throw validationError(
          "A committed case archive import cannot be cancelled.",
        );
      }
      const artifacts = await app.db
        .select()
        .from(schema.caseArchiveImportArtifacts)
        .where(eq(schema.caseArchiveImportArtifacts.importId, session.id));
      for (const artifact of artifacts) {
        if (artifact.multipartUploadId === null) {
          await app.storage
            .deleteObject(artifact.objectKey)
            .catch(() => undefined);
        } else {
          await app.storage
            .abortMultipartUpload(
              artifact.objectKey,
              artifact.multipartUploadId,
            )
            .catch(() => undefined);
        }
      }
      await app.db
        .update(schema.caseArchiveImports)
        .set({ status: "CANCELLED" })
        .where(eq(schema.caseArchiveImports.id, session.id));
      return { ok: true as const };
    },
  );
}

async function exportRecords(
  app: AppInstance,
  caseId: string,
): Promise<Record<string, unknown>> {
  const [researchCase] = await app.db
    .select()
    .from(schema.cases)
    .where(eq(schema.cases.id, caseId))
    .limit(1);
  if (researchCase === undefined) throw notFound("Case");
  const findings = await app.db
    .select()
    .from(schema.findings)
    .where(eq(schema.findings.caseId, caseId));
  const findingIds = findings.map((item) => item.id);
  const assets = await app.db
    .select({ asset: schema.assets })
    .from(schema.caseAssets)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.caseAssets.assetId))
    .where(eq(schema.caseAssets.caseId, caseId));
  const assetIds = assets.map((item) => item.asset.id);
  const submissions = await app.db
    .select()
    .from(schema.submissions)
    .where(eq(schema.submissions.caseId, caseId));
  const submissionIds = submissions.map((item) => item.id);
  const correspondenceMessages =
    submissionIds.length === 0
      ? []
      : await app.db
          .select()
          .from(schema.correspondenceMessages)
          .where(
            inArray(schema.correspondenceMessages.submissionId, submissionIds),
          );
  const correspondenceMessageIds = correspondenceMessages.map(
    (item) => item.id,
  );
  const rawMessageArtifactIds = correspondenceMessages.flatMap((item) =>
    item.rawArtifactId === null ? [] : [item.rawArtifactId],
  );
  const artifacts = await app.db
    .select()
    .from(schema.artifacts)
    .where(
      and(
        eq(schema.artifacts.caseId, caseId),
        sql`${schema.artifacts.status} = 'STORED'`,
        rawMessageArtifactIds.length === 0
          ? undefined
          : notInArray(schema.artifacts.id, rawMessageArtifactIds),
      ),
    );
  const artifactIds = artifacts.map((item) => item.id);
  const evidence = await app.db
    .select()
    .from(schema.evidence)
    .where(eq(schema.evidence.caseId, caseId));
  const evidenceIds = evidence.map((item) => item.id);
  const reports = await app.db
    .select()
    .from(schema.reports)
    .where(eq(schema.reports.caseId, caseId));
  const reportIds = reports.map((item) => item.id);
  const reportSections =
    reportIds.length === 0
      ? []
      : await app.db
          .select()
          .from(schema.reportSections)
          .where(inArray(schema.reportSections.reportId, reportIds));
  const sectionIds = reportSections.map((item) => item.id);
  const vendorIds = [...new Set(submissions.map((item) => item.vendorId))];
  const routeIds = [...new Set(submissions.map((item) => item.routeId))];
  return {
    case: researchCase,
    casePolicyPacks: await app.db
      .select()
      .from(schema.casePolicyPacks)
      .where(eq(schema.casePolicyPacks.caseId, caseId)),
    notes: await app.db
      .select()
      .from(schema.caseNotes)
      .where(eq(schema.caseNotes.caseId, caseId)),
    assets: assets.map((item) => item.asset),
    assetIdentifiers:
      assetIds.length === 0
        ? []
        : await app.db
            .select()
            .from(schema.assetIdentifiers)
            .where(inArray(schema.assetIdentifiers.assetId, assetIds)),
    assetVersions:
      assetIds.length === 0
        ? []
        : await app.db
            .select()
            .from(schema.assetVersions)
            .where(inArray(schema.assetVersions.assetId, assetIds)),
    findings,
    findingAssets:
      findingIds.length === 0
        ? []
        : await app.db
            .select()
            .from(schema.findingAssets)
            .where(inArray(schema.findingAssets.findingId, findingIds)),
    affectedRanges:
      findingIds.length === 0
        ? []
        : await app.db
            .select()
            .from(schema.affectedRanges)
            .where(inArray(schema.affectedRanges.findingId, findingIds)),
    findingIdentifiers:
      findingIds.length === 0
        ? []
        : await app.db
            .select()
            .from(schema.findingIdentifiers)
            .where(inArray(schema.findingIdentifiers.findingId, findingIds)),
    findingScores:
      findingIds.length === 0
        ? []
        : await app.db
            .select()
            .from(schema.findingScores)
            .where(inArray(schema.findingScores.findingId, findingIds)),
    claims:
      findingIds.length === 0
        ? []
        : await app.db
            .select()
            .from(schema.claims)
            .where(inArray(schema.claims.findingId, findingIds)),
    externalReferences:
      findingIds.length === 0
        ? []
        : await app.db
            .select()
            .from(schema.externalReferences)
            .where(inArray(schema.externalReferences.findingId, findingIds)),
    artifacts: artifacts.map(redactArtifactRecord),
    evidence,
    evidenceArtifacts:
      evidenceIds.length === 0 || artifactIds.length === 0
        ? []
        : await app.db
            .select()
            .from(schema.evidenceArtifacts)
            .where(inArray(schema.evidenceArtifacts.evidenceId, evidenceIds)),
    reports,
    reportSections,
    reportRevisions:
      sectionIds.length === 0
        ? []
        : await app.db
            .select()
            .from(schema.reportRevisions)
            .where(inArray(schema.reportRevisions.sectionId, sectionIds)),
    vendors:
      vendorIds.length === 0
        ? []
        : (
            await app.db
              .select()
              .from(schema.vendors)
              .where(inArray(schema.vendors.id, vendorIds))
          ).map(portableVendorRecord),
    vendorRoutes:
      routeIds.length === 0
        ? []
        : (
            await app.db
              .select()
              .from(schema.vendorRoutes)
              .where(inArray(schema.vendorRoutes.id, routeIds))
          ).map(portableVendorRouteRecord),
    submissions: submissions.map(portableSubmissionRecord),
    submissionRevisions:
      submissionIds.length === 0
        ? []
        : (
            await app.db
              .select()
              .from(schema.submissionRevisions)
              .where(
                inArray(schema.submissionRevisions.submissionId, submissionIds),
              )
          ).map(portableSubmissionRevisionRecord),
    submissionAttachments:
      submissionIds.length === 0
        ? []
        : await app.db
            .select()
            .from(schema.submissionAttachments)
            .where(
              inArray(schema.submissionAttachments.submissionId, submissionIds),
            ),
    correspondenceMessages: correspondenceMessages.map(
      portableCorrespondenceRecord,
    ),
    correspondenceMessageAttachments:
      correspondenceMessageIds.length === 0
        ? []
        : await app.db
            .select()
            .from(schema.correspondenceMessageAttachments)
            .where(
              inArray(
                schema.correspondenceMessageAttachments.messageId,
                correspondenceMessageIds,
              ),
            ),
  };
}

interface ImportOptions {
  records: Record<string, unknown>;
  artifacts: Array<typeof schema.caseArchiveImportArtifacts.$inferSelect>;
  user: ReturnType<typeof actingUser>;
  sessionId: string;
  requestId: string;
  importId: string;
}

async function importRecords(
  app: AppInstance,
  options: ImportOptions,
): Promise<{
  caseId: string;
  caseRef: string;
  recordCounts: Record<string, number>;
}> {
  const sourceCase = record(options.records, "case");
  const sourceAssets = recordRows(options.records, "assets");
  const sourceFindings = recordRows(options.records, "findings");
  const sourceEvidence = recordRows(options.records, "evidence");
  const sourceReports = recordRows(options.records, "reports");
  const sourceVendors = optionalRecordRows(options.records, "vendors");
  const sourceVendorRoutes = optionalRecordRows(
    options.records,
    "vendorRoutes",
  );
  const sourceSubmissions = optionalRecordRows(options.records, "submissions");
  const sourceMessages = optionalRecordRows(
    options.records,
    "correspondenceMessages",
  );
  const templateIds = [
    ...new Set(sourceReports.map((item) => stringField(item, "templateId"))),
  ];
  if (templateIds.length > 0) {
    const templates = await app.db
      .select({ id: schema.reportTemplates.id })
      .from(schema.reportTemplates)
      .where(inArray(schema.reportTemplates.id, templateIds));
    if (templates.length !== templateIds.length) {
      throw validationError(
        "The archive uses a report template this deployment does not have.",
      );
    }
  }

  return app.db.transaction(async (tx) => {
    const caseId = randomUUID();
    const caseRef = await allocateReference(
      tx,
      options.user.organizationId,
      "case",
    );
    const profile = stringField(sourceCase, "profile") as CaseProfile;
    await tx.insert(schema.cases).values({
      id: caseId,
      organizationId: options.user.organizationId,
      ref: caseRef,
      title: stringField(sourceCase, "title"),
      summary: nullableStringField(sourceCase, "summary"),
      profile,
      status: stringField(sourceCase, "status") as CaseStatus,
      ownerId: options.user.id,
      restricted: booleanField(sourceCase, "restricted"),
      disclosureEnabled: booleanField(sourceCase, "disclosureEnabled"),
      metadata: recordField(sourceCase, "metadata"),
    });
    await tx.insert(schema.casePolicyPacks).values({
      caseId,
      policyPackId: defaultPolicyPackForProfile(profile).id,
    });

    const vendorMap = new Map<string, string>();
    for (const source of sourceVendors) {
      const normalizedName = stringField(source, "normalizedName");
      const [existing] = await tx
        .select({ id: schema.vendors.id })
        .from(schema.vendors)
        .where(eq(schema.vendors.normalizedName, normalizedName))
        .limit(1);
      if (existing !== undefined) {
        vendorMap.set(stringField(source, "id"), existing.id);
        continue;
      }
      const id = randomUUID();
      vendorMap.set(stringField(source, "id"), id);
      await tx.insert(schema.vendors).values({
        id,
        ref: await allocateReference(tx, options.user.organizationId, "vendor"),
        slug: stringField(source, "slug"),
        name: stringField(source, "name"),
        normalizedName,
        websiteUrl: nullableStringField(source, "websiteUrl"),
        sourceUrl: nullableStringField(source, "sourceUrl"),
        sourceReviewedAt: nullableStringField(source, "sourceReviewedAt"),
        createdBy: options.user.id,
      });
    }

    const routeMap = new Map<
      string,
      { id: string; vendorId: string; revision: number }
    >();
    for (const source of sourceVendorRoutes) {
      const vendorId = vendorMap.get(stringField(source, "vendorId"));
      if (vendorId === undefined) continue;
      const name = stringField(source, "name");
      const [existing] = await tx
        .select({
          id: schema.vendorRoutes.id,
          revision: schema.vendorRoutes.revision,
        })
        .from(schema.vendorRoutes)
        .where(
          and(
            eq(schema.vendorRoutes.vendorId, vendorId),
            eq(schema.vendorRoutes.name, name),
          ),
        )
        .limit(1);
      if (existing !== undefined) {
        routeMap.set(stringField(source, "id"), { ...existing, vendorId });
        continue;
      }
      const id = randomUUID();
      await tx.insert(schema.vendorRoutes).values({
        id,
        vendorId,
        name,
        type: stringField(
          source,
          "type",
        ) as typeof schema.vendorRoutes.$inferInsert.type,
        requirements: recordField(source, "requirements"),
        active: booleanField(source, "active"),
        sourceUrl: nullableStringField(source, "sourceUrl"),
        sourceReviewedAt: nullableStringField(source, "sourceReviewedAt"),
        createdBy: options.user.id,
      });
      routeMap.set(stringField(source, "id"), { id, vendorId, revision: 1 });
    }

    const assetMap = new Map<string, string>();
    for (const source of sourceAssets) {
      const id = randomUUID();
      assetMap.set(stringField(source, "id"), id);
      await tx.insert(schema.assets).values({
        id,
        organizationId: options.user.organizationId,
        ref: await allocateReference(tx, options.user.organizationId, "asset"),
        name: stringField(source, "name"),
        kind: stringField(
          source,
          "kind",
        ) as typeof schema.assets.$inferInsert.kind,
        version: nullableStringField(source, "version"),
        notes: nullableStringField(source, "notes"),
        normalizedVendor: nullableStringField(source, "normalizedVendor"),
        normalizedProduct: nullableStringField(source, "normalizedProduct"),
        metadata: recordField(source, "metadata"),
        createdBy: options.user.id,
      });
      await tx.insert(schema.caseAssets).values({ caseId, assetId: id });
    }

    for (const source of recordRows(options.records, "assetIdentifiers")) {
      const assetId = assetMap.get(stringField(source, "assetId"));
      if (assetId === undefined) continue;
      await tx.insert(schema.assetIdentifiers).values({
        assetId,
        scheme: stringField(
          source,
          "scheme",
        ) as typeof schema.assetIdentifiers.$inferInsert.scheme,
        value: stringField(source, "value"),
        primary: booleanField(source, "primary"),
      });
    }
    for (const source of recordRows(options.records, "assetVersions")) {
      const assetId = assetMap.get(stringField(source, "assetId"));
      if (assetId === undefined) continue;
      await tx.insert(schema.assetVersions).values({
        assetId,
        version: stringField(source, "version"),
        releasedAt: nullableStringField(source, "releasedAt"),
        metadata: recordField(source, "metadata"),
      });
    }

    const findingMap = new Map<string, string>();
    for (const source of sourceFindings) {
      const id = randomUUID();
      findingMap.set(stringField(source, "id"), id);
      await tx.insert(schema.findings).values({
        id,
        ref: await allocateReference(
          tx,
          options.user.organizationId,
          "finding",
        ),
        caseId,
        title: stringField(source, "title"),
        summaryMarkdown: nullableStringField(source, "summaryMarkdown"),
        technicalMarkdown: nullableStringField(source, "technicalMarkdown"),
        preconditionsMarkdown: nullableStringField(
          source,
          "preconditionsMarkdown",
        ),
        attackPathMarkdown: nullableStringField(source, "attackPathMarkdown"),
        impactMarkdown: nullableStringField(source, "impactMarkdown"),
        reproductionMarkdown: nullableStringField(
          source,
          "reproductionMarkdown",
        ),
        remediationMarkdown: nullableStringField(source, "remediationMarkdown"),
        researcherNotesMarkdown: nullableStringField(
          source,
          "researcherNotesMarkdown",
        ),
        validationState: stringField(
          source,
          "validationState",
        ) as typeof schema.findings.$inferInsert.validationState,
        remediationState: stringField(
          source,
          "remediationState",
        ) as typeof schema.findings.$inferInsert.remediationState,
        disclosureState: stringField(
          source,
          "disclosureState",
        ) as typeof schema.findings.$inferInsert.disclosureState,
        externalIdState: stringField(
          source,
          "externalIdState",
        ) as typeof schema.findings.$inferInsert.externalIdState,
        priorArtState: stringField(
          source,
          "priorArtState",
        ) as typeof schema.findings.$inferInsert.priorArtState,
        visibility: stringField(source, "visibility") as ContentVisibility,
        cweIds: stringArrayField(source, "cweIds"),
        ownerId: options.user.id,
      });
    }
    for (const source of recordRows(options.records, "findingAssets")) {
      const findingId = findingMap.get(stringField(source, "findingId"));
      const assetId = assetMap.get(stringField(source, "assetId"));
      if (findingId !== undefined && assetId !== undefined) {
        await tx.insert(schema.findingAssets).values({
          findingId,
          assetId,
          primary: booleanField(source, "primary"),
        });
      }
    }

    const artifactMap = new Map<string, string>();
    const archivedArtifacts = new Map(
      recordRows(options.records, "artifacts").map((artifact) => [
        stringField(artifact, "id"),
        artifact,
      ]),
    );
    for (const source of options.artifacts) {
      const id = randomUUID();
      artifactMap.set(source.sourceId, id);
      await tx.insert(schema.artifacts).values({
        id,
        caseId,
        findingId: mapNullableId(
          archivedArtifacts.get(source.sourceId) ?? {},
          "findingId",
          findingMap,
        ),
        filename: source.filename,
        objectKey: source.objectKey,
        mimeType: source.mimeType,
        sizeBytes: source.sizeBytes,
        sha256: source.sha256,
        artifactKind: source.artifactKind as ArtifactKind,
        visibility: source.visibility as ContentVisibility,
        status: "STORED",
        capturedAt: source.capturedAt,
        metadata: source.metadata,
        uploadedBy: options.user.id,
      });
    }

    for (const source of recordRows(options.records, "affectedRanges")) {
      const findingId = findingMap.get(stringField(source, "findingId"));
      const assetId = assetMap.get(stringField(source, "assetId"));
      if (findingId === undefined || assetId === undefined) continue;
      await tx.insert(schema.affectedRanges).values({
        findingId,
        assetId,
        kind: stringField(
          source,
          "kind",
        ) as typeof schema.affectedRanges.$inferInsert.kind,
        expression: stringField(source, "expression"),
        status: stringField(
          source,
          "status",
        ) as typeof schema.affectedRanges.$inferInsert.status,
        fixedIn: nullableStringField(source, "fixedIn"),
        evidenceNote: nullableStringField(source, "evidenceNote"),
        verifiedAt: nullableStringField(source, "verifiedAt"),
        createdBy: options.user.id,
      });
    }
    for (const source of recordRows(options.records, "findingIdentifiers")) {
      const findingId = findingMap.get(stringField(source, "findingId"));
      if (findingId === undefined) continue;
      await tx.insert(schema.findingIdentifiers).values({
        findingId,
        scheme: stringField(source, "scheme"),
        value: stringField(source, "value"),
        url: nullableStringField(source, "url"),
        createdBy: options.user.id,
      });
    }
    for (const source of recordRows(options.records, "findingScores")) {
      const findingId = findingMap.get(stringField(source, "findingId"));
      if (findingId === undefined) continue;
      await tx.insert(schema.findingScores).values({
        findingId,
        scheme: stringField(source, "scheme"),
        vector: nullableStringField(source, "vector"),
        score: nullableNumberField(source, "score"),
        severity: nullableStringField(
          source,
          "severity",
        ) as typeof schema.findingScores.$inferInsert.severity,
        metrics: recordField(source, "metrics"),
        source: stringField(
          source,
          "source",
        ) as typeof schema.findingScores.$inferInsert.source,
        reasoningMarkdown: nullableStringField(source, "reasoningMarkdown"),
        reviewState: stringField(
          source,
          "reviewState",
        ) as typeof schema.findingScores.$inferInsert.reviewState,
        reviewedBy: source["reviewedBy"] === null ? null : options.user.id,
        reviewedAt: nullableStringField(source, "reviewedAt"),
        sourceName: nullableStringField(source, "sourceName"),
        retrievedAt: nullableStringField(source, "retrievedAt"),
        createdBy: options.user.id,
      });
    }
    for (const source of recordRows(options.records, "claims")) {
      const findingId = findingMap.get(stringField(source, "findingId"));
      if (findingId === undefined) continue;
      await tx.insert(schema.claims).values({
        findingId,
        key: stringField(source, "key"),
        statementMarkdown: stringField(source, "statementMarkdown"),
        value: source["value"],
        sourceType: stringField(
          source,
          "sourceType",
        ) as typeof schema.claims.$inferInsert.sourceType,
        sourceRef: nullableStringField(source, "sourceRef"),
        confidence: stringField(
          source,
          "confidence",
        ) as typeof schema.claims.$inferInsert.confidence,
        visibility: stringField(source, "visibility") as ContentVisibility,
        reviewedBy: source["reviewedBy"] === null ? null : options.user.id,
        retrievedAt: nullableStringField(source, "retrievedAt"),
        expiresAt: nullableStringField(source, "expiresAt"),
        createdBy: options.user.id,
      });
    }
    for (const source of recordRows(options.records, "externalReferences")) {
      const findingId = findingMap.get(stringField(source, "findingId"));
      if (findingId === undefined) continue;
      await tx.insert(schema.externalReferences).values({
        ref: await allocateReference(
          tx,
          options.user.organizationId,
          "reference",
        ),
        findingId,
        caseId,
        title: stringField(source, "title"),
        url: stringField(source, "url"),
        publisher: nullableStringField(source, "publisher"),
        publishedAt: nullableStringField(source, "publishedAt"),
        retrievedAt: nullableStringField(source, "retrievedAt"),
        visibility: stringField(source, "visibility") as ContentVisibility,
        note: nullableStringField(source, "note"),
        createdBy: options.user.id,
      });
    }

    for (const source of sourceEvidence) {
      const id = randomUUID();
      const sourceId = stringField(source, "id");
      await tx.insert(schema.evidence).values({
        id,
        ref: await allocateReference(
          tx,
          options.user.organizationId,
          "evidence",
        ),
        caseId,
        findingId: mapNullableId(source, "findingId", findingMap),
        title: stringField(source, "title"),
        descriptionMarkdown: nullableStringField(source, "descriptionMarkdown"),
        visibility: stringField(source, "visibility") as ContentVisibility,
        capturedAt: nullableStringField(source, "capturedAt"),
        createdBy: options.user.id,
      });
      for (const link of recordRows(
        options.records,
        "evidenceArtifacts",
      ).filter((item) => stringField(item, "evidenceId") === sourceId)) {
        const artifactId = artifactMap.get(stringField(link, "artifactId"));
        if (artifactId !== undefined)
          await tx
            .insert(schema.evidenceArtifacts)
            .values({ evidenceId: id, artifactId });
      }
    }

    for (const source of recordRows(options.records, "notes")) {
      await tx.insert(schema.caseNotes).values({
        caseId,
        title: nullableStringField(source, "title"),
        bodyMarkdown: stringField(source, "bodyMarkdown"),
        authorId: options.user.id,
      });
    }

    const reportMap = new Map<string, string>();
    const sectionMap = new Map<string, string>();
    for (const source of sourceReports) {
      const id = randomUUID();
      reportMap.set(stringField(source, "id"), id);
      await tx.insert(schema.reports).values({
        id,
        ref: await allocateReference(tx, options.user.organizationId, "report"),
        caseId,
        audience: stringField(
          source,
          "audience",
        ) as typeof schema.reports.$inferInsert.audience,
        templateId: stringField(source, "templateId"),
        title: stringField(source, "title"),
        tlp: stringField(
          source,
          "tlp",
        ) as typeof schema.reports.$inferInsert.tlp,
        visibilityCeiling: stringField(
          source,
          "visibilityCeiling",
        ) as ContentVisibility,
        // Approval is an attestation by a person in the source deployment. The
        // content travels, but the attestation must be made again locally.
        status: "DRAFT",
        createdBy: options.user.id,
      });
    }
    for (const source of recordRows(options.records, "reportSections")) {
      const reportId = reportMap.get(stringField(source, "reportId"));
      if (reportId === undefined) continue;
      const id = randomUUID();
      sectionMap.set(stringField(source, "id"), id);
      await tx.insert(schema.reportSections).values({
        id,
        reportId,
        key: stringField(source, "key"),
        title: stringField(source, "title"),
        position: numberField(source, "position"),
        required: booleanField(source, "required"),
        contentMarkdown: stringField(source, "contentMarkdown"),
        reviewState: "NEEDS_REVIEW",
        promptPurpose: nullableStringField(source, "promptPurpose"),
        sourceRefs: stringArrayField(source, "sourceRefs"),
        lastEditedBy: options.user.id,
      });
    }
    for (const source of recordRows(options.records, "reportRevisions")) {
      const sectionId = sectionMap.get(stringField(source, "sectionId"));
      if (sectionId === undefined) continue;
      await tx.insert(schema.reportRevisions).values({
        sectionId,
        revision: numberField(source, "revision"),
        contentMarkdown: stringField(source, "contentMarkdown"),
        reviewState: stringField(
          source,
          "reviewState",
        ) as typeof schema.reportRevisions.$inferInsert.reviewState,
        authoredBy: options.user.id,
      });
    }

    const submissionMap = new Map<string, string>();
    for (const source of sourceSubmissions) {
      const vendorId = vendorMap.get(stringField(source, "vendorId"));
      const route = routeMap.get(stringField(source, "routeId"));
      if (vendorId === undefined || route === undefined) continue;
      const id = randomUUID();
      submissionMap.set(stringField(source, "id"), id);
      const sourceSnapshot = recordField(source, "routeSnapshot");
      await tx.insert(schema.submissions).values({
        id,
        ref: await allocateReference(
          tx,
          options.user.organizationId,
          "submission",
        ),
        caseId,
        vendorId,
        routeId: route.id,
        routeSnapshot: {
          ...sourceSnapshot,
          vendorId,
          routeId: route.id,
          routeRevision: route.revision,
          capturedAt: new Date().toISOString(),
        } as typeof schema.submissions.$inferInsert.routeSnapshot,
        status: "DRAFT",
        coordinationState: "PREPARING",
        cryptoMode: stringField(
          source,
          "cryptoMode",
        ) as typeof schema.submissions.$inferInsert.cryptoMode,
        subject: stringField(source, "subject"),
        bodyMarkdown: stringField(source, "bodyMarkdown"),
        manualFields: recordField(source, "manualFields"),
        plannedNextContactAt: nullableStringField(
          source,
          "plannedNextContactAt",
        ),
        agreedDisclosureAt: nullableStringField(source, "agreedDisclosureAt"),
        vendorReference: nullableStringField(source, "vendorReference"),
        coordinationNotes: nullableStringField(source, "coordinationNotes"),
        snoozedUntil: nullableStringField(source, "snoozedUntil"),
        snoozeReason: nullableStringField(source, "snoozeReason"),
        createdBy: options.user.id,
        lastEditedBy: options.user.id,
      });
    }
    for (const source of optionalRecordRows(
      options.records,
      "submissionRevisions",
    )) {
      const submissionId = submissionMap.get(
        stringField(source, "submissionId"),
      );
      if (submissionId === undefined) continue;
      await tx.insert(schema.submissionRevisions).values({
        submissionId,
        revision: numberField(source, "revision"),
        subject: stringField(source, "subject"),
        bodyMarkdown: stringField(source, "bodyMarkdown"),
        manualFields: recordField(source, "manualFields"),
        cryptoMode: stringField(
          source,
          "cryptoMode",
        ) as typeof schema.submissionRevisions.$inferInsert.cryptoMode,
        authoredBy: options.user.id,
      });
    }
    for (const source of optionalRecordRows(
      options.records,
      "submissionAttachments",
    )) {
      const submissionId = submissionMap.get(
        stringField(source, "submissionId"),
      );
      const artifactId = artifactMap.get(stringField(source, "artifactId"));
      if (submissionId === undefined || artifactId === undefined) continue;
      await tx.insert(schema.submissionAttachments).values({
        submissionId,
        artifactId,
        position: numberField(source, "position"),
        sourceRevision: nullableNumberField(source, "sourceRevision"),
        createdBy: options.user.id,
      });
    }

    const messageMap = new Map<string, string>();
    for (const source of sourceMessages) {
      const submissionId = submissionMap.get(
        stringField(source, "submissionId"),
      );
      if (submissionId === undefined) continue;
      const id = randomUUID();
      messageMap.set(stringField(source, "id"), id);
      await tx.insert(schema.correspondenceMessages).values({
        id,
        submissionId,
        direction: stringField(
          source,
          "direction",
        ) as typeof schema.correspondenceMessages.$inferInsert.direction,
        rfcMessageId: stringField(source, "rfcMessageId"),
        inReplyTo: nullableStringField(source, "inReplyTo"),
        references: stringArrayField(source, "references"),
        fromAddress: stringField(source, "fromAddress"),
        toAddresses: stringArrayField(source, "toAddresses"),
        ccAddresses: stringArrayField(source, "ccAddresses"),
        subject: stringField(source, "subject"),
        bodyText: null,
        bodyEncrypted: stringField(
          source,
          "bodyEncrypted",
        ) as typeof schema.correspondenceMessages.$inferInsert.bodyEncrypted,
        rawArtifactId: null,
        classification: stringField(
          source,
          "classification",
        ) as typeof schema.correspondenceMessages.$inferInsert.classification,
        visibility: stringField(source, "visibility") as ContentVisibility,
        receivedAt: nullableStringField(source, "receivedAt"),
        sentAt: nullableStringField(source, "sentAt"),
      });
    }
    for (const source of optionalRecordRows(
      options.records,
      "correspondenceMessageAttachments",
    )) {
      const messageId = messageMap.get(stringField(source, "messageId"));
      const artifactId = artifactMap.get(stringField(source, "artifactId"));
      if (messageId === undefined || artifactId === undefined) continue;
      await tx.insert(schema.correspondenceMessageAttachments).values({
        messageId,
        artifactId,
        position: numberField(source, "position"),
      });
    }

    await tx
      .update(schema.caseArchiveImports)
      .set({ status: "COMMITTED" })
      .where(eq(schema.caseArchiveImports.id, options.importId));
    const recordCounts = {
      assets: sourceAssets.length,
      findings: sourceFindings.length,
      artifacts: options.artifacts.length,
      evidence: sourceEvidence.length,
      reports: sourceReports.length,
      submissions: sourceSubmissions.length,
      correspondenceMessages: sourceMessages.length,
    };
    await app.audit.write(
      tx,
      {
        actorId: options.user.id,
        sessionId: options.sessionId,
        requestId: options.requestId,
      },
      {
        action: "case.archive_imported",
        entityType: "case",
        entityId: caseId,
        caseId,
        after: { importId: options.importId, recordCounts },
      },
    );
    return { caseId, caseRef, recordCounts };
  });
}

function parseManifest(value: Record<string, unknown>): CvcaseManifest {
  if (
    value["format"] !== CVCASE_FORMAT ||
    (value["version"] !== 1 && value["version"] !== 2) ||
    typeof value["sourceVersion"] !== "string" ||
    !isRecord(value["recordCounts"]) ||
    !Array.isArray(value["artifacts"]) ||
    value["artifacts"].length > 10_000
  ) {
    throw validationError("The .cvcase format or version is not supported.");
  }
  const sourceIds = new Set<string>();
  const archivePaths = new Set<string>();
  for (const artifact of value["artifacts"]) {
    if (!isRecord(artifact))
      throw validationError("The .cvcase artifact manifest is invalid.");
    const sourceId = stringField(artifact, "sourceId");
    if (!UUID.test(sourceId) || sourceIds.has(sourceId)) {
      throw validationError("The .cvcase artifact IDs must be unique UUIDs.");
    }
    sourceIds.add(sourceId);
    const archivePath = stringField(artifact, "archivePath");
    if (!isSafeArchivePath(archivePath) || archivePaths.has(archivePath)) {
      throw validationError(
        "The .cvcase artifact paths must be unique and safe.",
      );
    }
    archivePaths.add(archivePath);
    const filename = stringField(artifact, "filename");
    if (
      filename.length === 0 ||
      filename.length > 300 ||
      /[\r\n\0]/u.test(filename)
    ) {
      throw validationError("The .cvcase artifact filename is invalid.");
    }
    if (stringField(artifact, "mimeType").length === 0) {
      throw validationError("The .cvcase artifact media type is invalid.");
    }
    const sizeBytes = numberField(artifact, "sizeBytes");
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
      throw validationError("The .cvcase artifact size is invalid.");
    }
    const digest = stringField(artifact, "sha256");
    if (!/^[0-9a-f]{64}$/u.test(digest))
      throw validationError("The .cvcase artifact digest is invalid.");
    if (
      !ARTIFACT_KINDS.includes(
        stringField(artifact, "artifactKind") as ArtifactKind,
      )
    ) {
      throw validationError("The .cvcase artifact kind is invalid.");
    }
    if (
      !CONTENT_VISIBILITIES.includes(
        stringField(artifact, "visibility") as ContentVisibility,
      )
    ) {
      throw validationError("The .cvcase artifact visibility is invalid.");
    }
    nullableStringField(artifact, "capturedAt");
    recordField(artifact, "metadata");
  }
  return value as unknown as CvcaseManifest;
}

function validateRecords(
  value: Record<string, unknown>,
  version: CvcaseManifest["version"],
): void {
  const researchCase = record(value, "case");
  for (const field of ["id", "title", "profile", "status"] as const)
    stringField(researchCase, field);
  for (const key of [
    "notes",
    "assets",
    "findings",
    "artifacts",
    "evidence",
    "reports",
  ] as const)
    recordRows(value, key);
  if (version === 2) validatePortableCorrespondenceRecords(value);
}

function validatePortableCorrespondenceRecords(
  records: Record<string, unknown>,
): void {
  const vendors = optionalRecordRows(records, "vendors");
  const routes = optionalRecordRows(records, "vendorRoutes");
  const submissions = optionalRecordRows(records, "submissions");
  const messages = optionalRecordRows(records, "correspondenceMessages");
  const vendorIds = new Set(vendors.map((item) => stringField(item, "id")));
  const routeIds = new Set(routes.map((item) => stringField(item, "id")));
  const submissionIds = new Set(
    submissions.map((item) => stringField(item, "id")),
  );
  if (
    routes.some((item) => !vendorIds.has(stringField(item, "vendorId"))) ||
    submissions.some(
      (item) =>
        !vendorIds.has(stringField(item, "vendorId")) ||
        !routeIds.has(stringField(item, "routeId")),
    ) ||
    messages.some(
      (item) => !submissionIds.has(stringField(item, "submissionId")),
    )
  ) {
    throw validationError(
      "The .cvcase correspondence records contain broken relationships.",
    );
  }
  const forbiddenMessageFields = [
    "bodyText",
    "rawArtifactId",
    "providerMessageId",
    "providerThreadId",
    "mailboxConnectionId",
    "reviewedPlaintextSavedAt",
  ];
  if (
    messages.some((message) =>
      forbiddenMessageFields.some((field) => field in message),
    )
  ) {
    throw validationError(
      "Version 2 correspondence records must contain metadata only.",
    );
  }
}

function validateArchiveConsistency(
  manifest: CvcaseManifest,
  records: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(records)) {
    if (!Array.isArray(value)) continue;
    if (manifest.recordCounts[key] !== value.length) {
      throw validationError(
        `Archive record count ${key} does not match its manifest.`,
      );
    }
  }
  for (const [key, count] of Object.entries(manifest.recordCounts)) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw validationError(`Archive record count ${key} is invalid.`);
    }
  }

  const recordArtifacts = new Map(
    recordRows(records, "artifacts").map((artifact) => [
      stringField(artifact, "id"),
      artifact,
    ]),
  );
  if (
    recordArtifacts.size !== manifest.artifacts.length ||
    recordArtifacts.size !== recordRows(records, "artifacts").length
  ) {
    throw validationError(
      "Archive artifact records do not match the manifest.",
    );
  }
  for (const artifact of manifest.artifacts) {
    const recordArtifact = recordArtifacts.get(artifact.sourceId);
    if (
      recordArtifact === undefined ||
      stringField(recordArtifact, "filename") !== artifact.filename ||
      stringField(recordArtifact, "mimeType") !== artifact.mimeType ||
      numberField(recordArtifact, "sizeBytes") !== artifact.sizeBytes ||
      stringField(recordArtifact, "sha256") !== artifact.sha256 ||
      stringField(recordArtifact, "artifactKind") !== artifact.artifactKind ||
      stringField(recordArtifact, "visibility") !== artifact.visibility
    ) {
      throw validationError(
        "An archive artifact record does not match its manifest.",
      );
    }
  }
}

function isSafeArchivePath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 1_024 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function record(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = source[key];
  if (!isRecord(value))
    throw validationError(`Archive field ${key} must be an object.`);
  return value;
}

function recordRows(
  source: Record<string, unknown>,
  key: string,
): Array<Record<string, unknown>> {
  const value = source[key];
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) {
    throw validationError(`Archive field ${key} must be an array of objects.`);
  }
  return value as Array<Record<string, unknown>>;
}

function optionalRecordRows(
  source: Record<string, unknown>,
  key: string,
): Array<Record<string, unknown>> {
  return source[key] === undefined ? [] : recordRows(source, key);
}

function stringField(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string")
    throw validationError(`Archive field ${key} must be text.`);
  return value;
}

function nullableStringField(
  source: Record<string, unknown>,
  key: string,
): string | null {
  const value = source[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string")
    throw validationError(`Archive field ${key} must be text or null.`);
  return value;
}

function numberField(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value))
    throw validationError(`Archive field ${key} must be a number.`);
  return value;
}

function nullableNumberField(
  source: Record<string, unknown>,
  key: string,
): number | null {
  const value = source[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw validationError(`Archive field ${key} must be a number or null.`);
  }
  return value;
}

function booleanField(source: Record<string, unknown>, key: string): boolean {
  const value = source[key];
  if (typeof value !== "boolean")
    throw validationError(`Archive field ${key} must be true or false.`);
  return value;
}

function recordField(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = source[key];
  return isRecord(value) ? value : {};
}

function stringArrayField(
  source: Record<string, unknown>,
  key: string,
): string[] {
  const value = source[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    return [];
  return value;
}

function mapNullableId(
  source: Record<string, unknown>,
  key: string,
  mapping: Map<string, string>,
): string | null {
  const value = source[key];
  return typeof value === "string" ? (mapping.get(value) ?? null) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactArtifactRecord(
  artifact: typeof schema.artifacts.$inferSelect,
): Record<string, unknown> {
  const {
    objectKey: _objectKey,
    uploadId: _uploadId,
    previewObjectKey: _previewObjectKey,
    ...record
  } = artifact;
  return record;
}

function portableVendorRecord(
  vendor: typeof schema.vendors.$inferSelect,
): Record<string, unknown> {
  return {
    id: vendor.id,
    slug: vendor.slug,
    name: vendor.name,
    normalizedName: vendor.normalizedName,
    websiteUrl: vendor.websiteUrl,
    sourceUrl: vendor.sourceUrl,
    sourceReviewedAt: vendor.sourceReviewedAt,
  };
}

function portableVendorRouteRecord(
  route: typeof schema.vendorRoutes.$inferSelect,
): Record<string, unknown> {
  return {
    id: route.id,
    vendorId: route.vendorId,
    name: route.name,
    type: route.type,
    requirements: route.requirements,
    active: route.active,
    sourceUrl: route.sourceUrl,
    sourceReviewedAt: route.sourceReviewedAt,
  };
}

function portableSubmissionRecord(
  submission: typeof schema.submissions.$inferSelect,
): Record<string, unknown> {
  return {
    id: submission.id,
    vendorId: submission.vendorId,
    routeId: submission.routeId,
    routeSnapshot: submission.routeSnapshot,
    cryptoMode: submission.cryptoMode,
    subject: submission.subject,
    bodyMarkdown: submission.bodyMarkdown,
    manualFields: submission.manualFields,
    plannedNextContactAt: submission.plannedNextContactAt,
    agreedDisclosureAt: submission.agreedDisclosureAt,
    vendorReference: submission.vendorReference,
    coordinationNotes: submission.coordinationNotes,
    snoozedUntil: submission.snoozedUntil,
    snoozeReason: submission.snoozeReason,
  };
}

function portableSubmissionRevisionRecord(
  revision: typeof schema.submissionRevisions.$inferSelect,
): Record<string, unknown> {
  return {
    id: revision.id,
    submissionId: revision.submissionId,
    revision: revision.revision,
    subject: revision.subject,
    bodyMarkdown: revision.bodyMarkdown,
    manualFields: revision.manualFields,
    cryptoMode: revision.cryptoMode,
    createdAt: revision.createdAt,
  };
}

function portableCorrespondenceRecord(
  message: typeof schema.correspondenceMessages.$inferSelect,
): Record<string, unknown> {
  return {
    id: message.id,
    submissionId: message.submissionId,
    direction: message.direction,
    rfcMessageId: message.rfcMessageId,
    inReplyTo: message.inReplyTo,
    references: message.references,
    fromAddress: message.fromAddress,
    toAddresses: message.toAddresses,
    ccAddresses: message.ccAddresses,
    subject: message.subject,
    bodyEncrypted: message.bodyEncrypted,
    classification: message.classification,
    visibility: message.visibility,
    receivedAt: message.receivedAt,
    sentAt: message.sentAt,
    createdAt: message.createdAt,
  };
}
