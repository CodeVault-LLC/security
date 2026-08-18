import { createHash } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { uuidv7 } from "@codevault/core/crypto";
import { schema } from "@codevault/db";

import type { WorkerContext } from "../context.js";
import { generateArtifactPreview } from "./artifact-preview.js";

export interface ArtifactIntegrityJobData {
  artifactId: string;
  caseId: string;
}

/** Streams the complete object through SHA-256 before it becomes available. */
export async function verifyArtifactIntegrity(
  context: WorkerContext,
  data: ArtifactIntegrityJobData,
): Promise<void> {
  const [artifact] = await context.db
    .select()
    .from(schema.artifacts)
    .where(
      and(
        eq(schema.artifacts.id, data.artifactId),
        eq(schema.artifacts.status, "VERIFYING"),
      ),
    )
    .limit(1);
  if (!artifact) return;

  const hash = createHash("sha256");
  let observedSize = 0;
  const stream = await context.storage.getObjectStream(artifact.objectKey);
  for await (const chunk of stream) {
    observedSize += chunk.byteLength;
    if (observedSize > artifact.sizeBytes) break;
    hash.update(chunk);
  }
  const observedSha256 = hash.digest("hex");
  const valid =
    observedSize === artifact.sizeBytes && observedSha256 === artifact.sha256;

  if (!valid) {
    await context.db.transaction(async (tx) => {
      const [rejected] = await tx
        .update(schema.artifacts)
        .set({ status: "REJECTED", updatedAt: sql`now()` })
        .where(
          and(
            eq(schema.artifacts.id, artifact.id),
            eq(schema.artifacts.status, "VERIFYING"),
          ),
        )
        .returning({ id: schema.artifacts.id });
      if (!rejected) return;
      const [researchCase] = await tx
        .select({ organizationId: schema.cases.organizationId })
        .from(schema.cases)
        .where(eq(schema.cases.id, artifact.caseId));
      if (researchCase) {
        await tx.insert(schema.auditEvents).values({
          id: uuidv7(),
          organizationId: researchCase.organizationId,
          action: "artifact.integrity_rejected",
          entityType: "artifact",
          entityId: artifact.id,
          caseId: artifact.caseId,
          actorId: artifact.uploadedBy,
          before: { status: "VERIFYING" },
          after: { status: "REJECTED" },
        });
      }
    });
    await context.storage
      .deleteObject(artifact.objectKey)
      .catch(() => undefined);
    return;
  }

  const [stored] = await context.db
    .update(schema.artifacts)
    .set({ status: "STORED", updatedAt: sql`now()` })
    .where(
      and(
        eq(schema.artifacts.id, artifact.id),
        eq(schema.artifacts.status, "VERIFYING"),
      ),
    )
    .returning({ id: schema.artifacts.id });
  if (stored) await generateArtifactPreview(context, data);
}
