import { desc, eq, sql, type SQL } from "drizzle-orm";

import type { FindingDetail } from "@codevault/contracts";
import { notFound } from "@codevault/core";
import type { Database } from "@codevault/db";
import { schema } from "@codevault/db";

/**
 * Finding read queries.
 *
 * Kept apart from the route handlers because the detail projection is needed by
 * the reports, AI-context and prior-art modules too, and duplicating it would
 * be the fastest way to have two slightly different ideas of what a finding is.
 */

/**
 * Case IDs the user may read, as a subquery.
 *
 * Expressed in SQL rather than as a fetched array so a workspace with thousands
 * of cases does not ship its whole case list into the process on every query.
 */
export function readableCaseIdsSubquery(userId: string): SQL {
  return sql`(
    SELECT c.id FROM cases c
    WHERE c.restricted = false
       OR c.owner_id = ${userId}
       OR EXISTS (
         SELECT 1 FROM case_members m
         WHERE m.case_id = c.id AND m.user_id = ${userId}
       )
  )`;
}

export async function loadFindingDetail(
  db: Database,
  findingId: string,
): Promise<FindingDetail> {
  const rows = await db
    .select({
      finding: schema.findings,
      caseRef: schema.cases.ref,
      ownerId: schema.users.id,
      ownerName: schema.users.displayName,
      ownerEmail: schema.users.email,
    })
    .from(schema.findings)
    .innerJoin(schema.cases, eq(schema.cases.id, schema.findings.caseId))
    .innerJoin(schema.users, eq(schema.users.id, schema.findings.ownerId))
    .where(eq(schema.findings.id, findingId))
    .limit(1);

  const row = rows[0];

  if (row === undefined) {
    throw notFound("Finding");
  }

  const { finding } = row;

  const assets = await db
    .select({
      assetId: schema.assets.id,
      assetRef: schema.assets.ref,
      name: schema.assets.name,
      kind: schema.assets.kind,
      primary: schema.findingAssets.primary,
    })
    .from(schema.findingAssets)
    .innerJoin(
      schema.assets,
      eq(schema.assets.id, schema.findingAssets.assetId),
    )
    .where(eq(schema.findingAssets.findingId, findingId))
    .orderBy(desc(schema.findingAssets.primary));

  const affectedRanges = await db
    .select()
    .from(schema.affectedRanges)
    .where(eq(schema.affectedRanges.findingId, findingId))
    .orderBy(desc(schema.affectedRanges.createdAt));

  const identifiers = await db
    .select()
    .from(schema.findingIdentifiers)
    .where(eq(schema.findingIdentifiers.findingId, findingId));

  const scoreRows = await db
    .select({
      score: schema.findingScores,
      reviewerId: schema.users.id,
      reviewerName: schema.users.displayName,
      reviewerEmail: schema.users.email,
    })
    .from(schema.findingScores)
    .leftJoin(
      schema.users,
      eq(schema.users.id, schema.findingScores.reviewedBy),
    )
    .where(eq(schema.findingScores.findingId, findingId))
    .orderBy(desc(schema.findingScores.createdAt));

  const claimRows = await db
    .select({
      claim: schema.claims,
      reviewerId: schema.users.id,
      reviewerName: schema.users.displayName,
      reviewerEmail: schema.users.email,
    })
    .from(schema.claims)
    .leftJoin(schema.users, eq(schema.users.id, schema.claims.reviewedBy))
    .where(eq(schema.claims.findingId, findingId))
    .orderBy(desc(schema.claims.createdAt));

  const references = await db
    .select()
    .from(schema.externalReferences)
    .where(eq(schema.externalReferences.findingId, findingId))
    .orderBy(desc(schema.externalReferences.createdAt));

  const pendingProposals = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.aiProposals)
    .where(
      sql`${schema.aiProposals.targetId} = ${findingId} AND ${schema.aiProposals.status} = 'PENDING'`,
    );

  const primaryAsset = assets.find((asset) => asset.primary) ?? null;

  return {
    id: finding.id,
    ref: finding.ref,
    caseId: finding.caseId,
    caseRef: row.caseRef,
    title: finding.title,
    summaryMarkdown: finding.summaryMarkdown,
    technicalMarkdown: finding.technicalMarkdown,
    preconditionsMarkdown: finding.preconditionsMarkdown,
    attackPathMarkdown: finding.attackPathMarkdown,
    impactMarkdown: finding.impactMarkdown,
    reproductionMarkdown: finding.reproductionMarkdown,
    remediationMarkdown: finding.remediationMarkdown,
    researcherNotesMarkdown: finding.researcherNotesMarkdown,
    validationState: finding.validationState,
    remediationState: finding.remediationState,
    disclosureState: finding.disclosureState,
    externalIdState: finding.externalIdState,
    priorArtState: finding.priorArtState,
    visibility: finding.visibility,
    cweIds: finding.cweIds,
    severity: finding.severity,
    score: finding.score,
    owner: {
      id: row.ownerId,
      displayName: row.ownerName,
      email: row.ownerEmail,
    },
    primaryAsset,
    assets,
    affectedRanges: affectedRanges.map((range) => ({
      id: range.id,
      assetId: range.assetId,
      kind: range.kind,
      expression: range.expression,
      status: range.status,
      fixedIn: range.fixedIn,
      evidenceNote: range.evidenceNote,
      verifiedAt: range.verifiedAt,
      createdAt: range.createdAt,
    })),
    identifiers: identifiers.map((identifier) => ({
      id: identifier.id,
      scheme: identifier.scheme,
      value: identifier.value,
      url: identifier.url,
      createdAt: identifier.createdAt,
    })),
    scores: scoreRows.map(
      ({ score, reviewerId, reviewerName, reviewerEmail }) => ({
        id: score.id,
        scheme: score.scheme,
        vector: score.vector,
        score: score.score,
        severity: score.severity,
        metrics: score.metrics,
        source: score.source,
        reasoningMarkdown: score.reasoningMarkdown,
        reviewState: score.reviewState,
        reviewedBy:
          reviewerId === null || reviewerName === null || reviewerEmail === null
            ? null
            : {
                id: reviewerId,
                displayName: reviewerName,
                email: reviewerEmail,
              },
        reviewedAt: score.reviewedAt,
        sourceName: score.sourceName,
        retrievedAt: score.retrievedAt,
        createdAt: score.createdAt,
      }),
    ),
    claims: claimRows.map(
      ({ claim, reviewerId, reviewerName, reviewerEmail }) => ({
        id: claim.id,
        findingId: claim.findingId,
        key: claim.key,
        statementMarkdown: claim.statementMarkdown,
        value: claim.value,
        sourceType: claim.sourceType,
        sourceRef: claim.sourceRef,
        confidence: claim.confidence,
        visibility: claim.visibility,
        reviewedBy:
          reviewerId === null || reviewerName === null || reviewerEmail === null
            ? null
            : {
                id: reviewerId,
                displayName: reviewerName,
                email: reviewerEmail,
              },
        retrievedAt: claim.retrievedAt,
        expiresAt: claim.expiresAt,
        createdAt: claim.createdAt,
      }),
    ),
    references: references.map((reference) => ({
      id: reference.id,
      ref: reference.ref,
      title: reference.title,
      url: reference.url,
      publisher: reference.publisher,
      publishedAt: reference.publishedAt,
      retrievedAt: reference.retrievedAt,
      visibility: reference.visibility,
      note: reference.note,
      createdAt: reference.createdAt,
    })),
    pendingProposalCount: pendingProposals[0]?.count ?? 0,
    createdAt: finding.createdAt,
    updatedAt: finding.updatedAt,
    revision: finding.revision,
  };
}
