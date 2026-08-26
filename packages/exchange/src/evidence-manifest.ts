import type { Evidence } from "@codevault/contracts";

export const EVIDENCE_MANIFEST_FORMAT = "codevault.evidence-manifest" as const;

export interface BuildEvidenceManifestInput {
  caseId: string;
  findingId?: string | undefined;
  generatedAt: string;
  evidence: readonly Evidence[];
}

/** Build a portable metadata and digest inventory without evidence bytes. */
export function buildEvidenceManifest(
  input: BuildEvidenceManifestInput,
): string {
  const records = [...input.evidence]
    .sort(
      (left, right) =>
        left.ref.localeCompare(right.ref) || left.id.localeCompare(right.id),
    )
    .map((record) => ({
      id: record.id,
      ref: record.ref,
      findingId: record.findingId,
      title: record.title,
      descriptionMarkdown: record.descriptionMarkdown,
      visibility: record.visibility,
      capturedAt: record.capturedAt,
      createdBy: record.createdBy,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      revision: record.revision,
      artifacts: [...record.artifacts]
        .sort(
          (left, right) =>
            left.filename.localeCompare(right.filename) ||
            left.id.localeCompare(right.id),
        )
        .map((artifact) => ({
          id: artifact.id,
          findingId: artifact.findingId,
          filename: artifact.filename,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
          sha256: artifact.sha256,
          artifactKind: artifact.artifactKind,
          visibility: artifact.visibility,
          status: artifact.status,
          uploadedBy: artifact.uploadedBy,
          capturedAt: artifact.capturedAt,
          metadata: canonicalize(artifact.metadata),
          createdAt: artifact.createdAt,
        })),
    }));
  const artifacts = records.flatMap((record) => record.artifacts);

  return `${JSON.stringify(
    {
      format: EVIDENCE_MANIFEST_FORMAT,
      version: 1,
      generatedAt: input.generatedAt,
      scope: {
        caseId: input.caseId,
        findingId: input.findingId ?? null,
      },
      counts: {
        evidence: records.length,
        artifacts: artifacts.length,
        totalBytes: artifacts.reduce(
          (total, artifact) => total + artifact.sizeBytes,
          0,
        ),
      },
      evidence: records,
    },
    null,
    2,
  )}\n`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}
