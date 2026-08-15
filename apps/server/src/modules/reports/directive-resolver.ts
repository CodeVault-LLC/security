import { and, eq, sql } from "drizzle-orm";

import type { ContentVisibility, ReportAudience } from "@codevault/core";
import type { Database } from "@codevault/db";
import { schema } from "@codevault/db";
import {
  escapeHtml,
  type DirectiveKind,
  type DirectiveResolver,
  type ResolvedDirective,
} from "@codevault/reporting";

/**
 * Database-backed directive resolver.
 *
 * Turns `[evidence:EVID-000123]` into a rendered block using the real record,
 * carrying that record's actual visibility back so the caller can enforce the
 * audience rule on it. Resolution is scoped to one case: a directive cannot
 * reach an artifact belonging to a different piece of research.
 */

export interface ResolverOptions {
  db: Database;
  caseId: string;
  audience: ReportAudience;
}

function evidenceHtml(
  reference: string,
  title: string,
  description: string | null,
  artifacts: readonly {
    filename: string;
    sha256: string;
    sizeBytes: number;
    artifactKind: string;
  }[],
): string {
  const files = artifacts
    .map(
      (artifact) =>
        `<div class="cv-evidence-meta">${escapeHtml(artifact.filename)} · ` +
        `${escapeHtml(artifact.artifactKind)} · ${artifact.sizeBytes} bytes · ` +
        `sha256 ${escapeHtml(artifact.sha256)}</div>`,
    )
    .join("");

  const caption =
    description === null
      ? ""
      : `<div class="cv-caption">${escapeHtml(description)}</div>`;

  return (
    `<div class="cv-evidence">` +
    `<div class="cv-evidence-title">${escapeHtml(reference)} — ${escapeHtml(title)}</div>` +
    `${files}${caption}</div>`
  );
}

export function createDirectiveResolver(
  options: ResolverOptions,
): DirectiveResolver {
  const { db, caseId } = options;

  return {
    async resolve(
      kind: DirectiveKind,
      argument: string,
    ): Promise<ResolvedDirective | null> {
      if (kind === "evidence") {
        const rows = await db
          .select()
          .from(schema.evidence)
          .where(
            and(
              eq(schema.evidence.ref, argument),
              eq(schema.evidence.caseId, caseId),
            ),
          )
          .limit(1);

        const evidence = rows[0];

        if (evidence === undefined) {
          return null;
        }

        const artifacts = await db
          .select({
            filename: schema.artifacts.filename,
            sha256: schema.artifacts.sha256,
            sizeBytes: schema.artifacts.sizeBytes,
            artifactKind: schema.artifacts.artifactKind,
            visibility: schema.artifacts.visibility,
          })
          .from(schema.evidenceArtifacts)
          .innerJoin(
            schema.artifacts,
            eq(schema.artifacts.id, schema.evidenceArtifacts.artifactId),
          )
          .where(eq(schema.evidenceArtifacts.evidenceId, evidence.id));

        // The effective visibility is the most restrictive of the evidence
        // record and everything attached to it: quoting an internal capture
        // inside a vendor-visible evidence record must not launder it.
        const visibility = mostRestrictive([
          evidence.visibility,
          ...artifacts.map((artifact) => artifact.visibility),
        ]);

        return {
          kind,
          argument,
          visibility,
          html: evidenceHtml(
            evidence.ref,
            evidence.title,
            evidence.descriptionMarkdown,
            artifacts,
          ),
          text: `${evidence.ref} — ${evidence.title}`,
        };
      }

      if (kind === "asset") {
        const rows = await db
          .select()
          .from(schema.assets)
          .where(eq(schema.assets.ref, argument))
          .limit(1);

        const asset = rows[0];

        if (asset === undefined) {
          return null;
        }

        const label = [asset.vendor, asset.name, asset.version]
          .filter((part): part is string => part !== null && part.length > 0)
          .join(" ");

        return {
          kind,
          argument,
          // Assets carry no visibility of their own; they describe the target,
          // which every audience of a report about it necessarily knows.
          visibility: "PUBLIC",
          html: `<span class="cv-inline-ref">${escapeHtml(label)}</span>`,
          text: label,
        };
      }

      if (kind === "finding") {
        const rows = await db
          .select()
          .from(schema.findings)
          .where(
            and(
              eq(schema.findings.ref, argument),
              eq(schema.findings.caseId, caseId),
            ),
          )
          .limit(1);

        const finding = rows[0];

        if (finding === undefined) {
          return null;
        }

        return {
          kind,
          argument,
          visibility: finding.visibility,
          html:
            `<span class="cv-inline-ref">${escapeHtml(finding.ref)}</span> ` +
            escapeHtml(finding.title),
          text: `${finding.ref} — ${finding.title}`,
        };
      }

      if (kind === "reference") {
        const rows = await db
          .select()
          .from(schema.externalReferences)
          .where(eq(schema.externalReferences.ref, argument))
          .limit(1);

        const reference = rows[0];

        if (reference === undefined) {
          return null;
        }

        return {
          kind,
          argument,
          visibility: reference.visibility,
          html:
            `<a href="${escapeHtml(reference.url)}">${escapeHtml(reference.title)}</a>` +
            (reference.publisher === null
              ? ""
              : ` <span class="cv-caption">(${escapeHtml(reference.publisher)})</span>`),
          text: `${reference.title} — ${reference.url}`,
        };
      }

      if (kind === "score") {
        const scheme = argument.toUpperCase();
        const rows = await db
          .select({
            vector: schema.findingScores.vector,
            score: schema.findingScores.score,
            severity: schema.findingScores.severity,
            scheme: schema.findingScores.scheme,
          })
          .from(schema.findingScores)
          .innerJoin(
            schema.findings,
            eq(schema.findings.id, schema.findingScores.findingId),
          )
          .where(
            and(
              eq(schema.findings.caseId, caseId),
              eq(schema.findingScores.scheme, scheme),
              eq(schema.findingScores.reviewState, "APPROVED"),
            ),
          )
          .limit(1);

        const score = rows[0];

        if (score === undefined) {
          return null;
        }

        return {
          kind,
          argument,
          // A published score is public by nature; the report's own audience
          // rules already decide whether the section appears at all.
          visibility: "PUBLIC",
          html:
            `<div class="cv-score">` +
            `<div class="cv-score-value">${score.score ?? "—"} ` +
            `${escapeHtml(score.severity ?? "")}</div>` +
            `<div class="cv-score-vector">${escapeHtml(score.vector ?? "")}</div>` +
            `</div>`,
          text: `${score.scheme} ${score.score ?? ""} ${score.vector ?? ""}`.trim(),
        };
      }

      if (kind === "disclosure-timeline") {
        const events = await db
          .select({
            type: schema.disclosureEvents.type,
            label: schema.disclosureEvents.label,
            occurredAt: schema.disclosureEvents.occurredAt,
            visibility: schema.disclosureEvents.visibility,
          })
          .from(schema.disclosureEvents)
          .where(eq(schema.disclosureEvents.caseId, caseId))
          .orderBy(schema.disclosureEvents.occurredAt);

        const visible = events.filter((event) =>
          allowedForAudience(event.visibility, options.audience),
        );

        const rows = visible
          .map(
            (event) =>
              `<tr><td class="cv-timeline-date">${escapeHtml(
                event.occurredAt.slice(0, 10),
              )}</td><td>${escapeHtml(
                event.label ?? humaniseEventType(event.type),
              )}</td></tr>`,
          )
          .join("");

        return {
          kind,
          argument,
          // Each event was filtered individually above, so the rendered table
          // is public by construction.
          visibility: "PUBLIC",
          html: `<table class="cv-timeline"><tbody>${rows}</tbody></table>`,
          text: visible
            .map(
              (event) =>
                `${event.occurredAt.slice(0, 10)} ${event.label ?? humaniseEventType(event.type)}`,
            )
            .join("\n"),
        };
      }

      return null;
    },
  };
}

function allowedForAudience(
  visibility: ContentVisibility,
  audience: ReportAudience,
): boolean {
  const rank: Record<ContentVisibility, number> = {
    INTERNAL: 2,
    VENDOR: 1,
    PUBLIC: 0,
  };

  return rank[visibility] <= rank[audience];
}

function mostRestrictive(
  visibilities: readonly ContentVisibility[],
): ContentVisibility {
  if (visibilities.includes("INTERNAL")) {
    return "INTERNAL";
  }

  if (visibilities.includes("VENDOR")) {
    return "VENDOR";
  }

  return "PUBLIC";
}

function humaniseEventType(type: string): string {
  return type
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Resolves every referenced item in a report, for the linter. */
export async function collectReferencedItems(
  db: Database,
  caseId: string,
  audience: ReportAudience,
): Promise<
  Array<{
    reference: string;
    kind: string;
    visibility: ContentVisibility;
    approvedForAudience?: boolean;
  }>
> {
  const evidence = await db
    .select({
      ref: schema.evidence.ref,
      visibility: schema.evidence.visibility,
      strictest: sql<string>`(
        SELECT min(
          CASE a.visibility
            WHEN 'PUBLIC' THEN 'PUBLIC'
            WHEN 'VENDOR' THEN 'VENDOR'
            ELSE 'INTERNAL'
          END
        )
        FROM evidence_artifacts ea
        JOIN artifacts a ON a.id = ea.artifact_id
        WHERE ea.evidence_id = ${schema.evidence.id}
      )`,
    })
    .from(schema.evidence)
    .where(eq(schema.evidence.caseId, caseId));

  const findings = await db
    .select({
      ref: schema.findings.ref,
      visibility: schema.findings.visibility,
    })
    .from(schema.findings)
    .where(eq(schema.findings.caseId, caseId));

  const references = await db
    .select({
      ref: schema.externalReferences.ref,
      visibility: schema.externalReferences.visibility,
    })
    .from(schema.externalReferences)
    .where(eq(schema.externalReferences.caseId, caseId));

  const pocs = await db
    .select({
      ref: schema.pocs.ref,
      visibility: schema.pocs.visibility,
      status: schema.pocs.status,
    })
    .from(schema.pocs)
    .innerJoin(schema.findings, eq(schema.findings.id, schema.pocs.findingId))
    .where(eq(schema.findings.caseId, caseId));

  const assets = await db
    .select({ ref: schema.assets.ref })
    .from(schema.assets)
    .innerJoin(
      schema.caseAssets,
      eq(schema.caseAssets.assetId, schema.assets.id),
    )
    .where(eq(schema.caseAssets.caseId, caseId));

  return [
    ...evidence.map((row) => ({
      reference: row.ref,
      kind: "evidence",
      visibility: mostRestrictive([
        row.visibility,
        (row.strictest as ContentVisibility | null) ?? "PUBLIC",
      ]),
    })),
    ...findings.map((row) => ({
      reference: row.ref,
      kind: "finding",
      visibility: row.visibility,
    })),
    ...references.map((row) => ({
      reference: row.ref,
      kind: "reference",
      visibility: row.visibility,
    })),
    ...pocs.map((row) => ({
      reference: row.ref,
      kind: "poc",
      visibility: row.visibility,
      // A PoC has to be both visible to the audience and verified before it is
      // published: shipping an unverified exploit is its own kind of mistake.
      approvedForAudience:
        allowedForAudience(row.visibility, audience) &&
        row.status === "VERIFIED",
    })),
    ...assets.map((row) => ({
      reference: row.ref,
      kind: "asset",
      visibility: "PUBLIC" as ContentVisibility,
    })),
  ];
}
