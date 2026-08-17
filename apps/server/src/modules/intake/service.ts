import { and, asc, eq } from "drizzle-orm";

import type { AppInstance } from "../../http/app-instance.js";
import type { IntakeItem } from "@codevault/contracts";
import { notFound } from "@codevault/core";
import { schema } from "@codevault/db";

type Db = AppInstance["db"];

export async function loadIntakeItem(
  db: Db,
  itemId: string,
): Promise<IntakeItem> {
  const rows = await db
    .select({ item: schema.aiIntakeItems, batch: schema.aiIntakeBatches })
    .from(schema.aiIntakeItems)
    .innerJoin(
      schema.aiIntakeBatches,
      eq(schema.aiIntakeBatches.id, schema.aiIntakeItems.batchId),
    )
    .where(eq(schema.aiIntakeItems.id, itemId))
    .limit(1);
  const row = rows[0];

  if (row === undefined) throw notFound("Intake item");

  const [creator, reviewer] = await Promise.all([
    loadActor(db, row.batch.createdBy),
    row.item.reviewedBy === null
      ? Promise.resolve(null)
      : loadActor(db, row.item.reviewedBy),
  ]);

  return toIntakeItem(row.item, row.batch, creator, reviewer);
}

export async function listIntakeItems(
  db: Db,
  caseId: string,
  status?: IntakeItem["status"],
): Promise<IntakeItem[]> {
  const rows = await db
    .select({ item: schema.aiIntakeItems, batch: schema.aiIntakeBatches })
    .from(schema.aiIntakeItems)
    .innerJoin(
      schema.aiIntakeBatches,
      eq(schema.aiIntakeBatches.id, schema.aiIntakeItems.batchId),
    )
    .where(
      status === undefined
        ? eq(schema.aiIntakeBatches.caseId, caseId)
        : and(
            eq(schema.aiIntakeBatches.caseId, caseId),
            eq(schema.aiIntakeItems.status, status),
          ),
    )
    .orderBy(asc(schema.aiIntakeItems.createdAt));

  return Promise.all(
    rows.map(async (row) => {
      const [creator, reviewer] = await Promise.all([
        loadActor(db, row.batch.createdBy),
        row.item.reviewedBy === null
          ? Promise.resolve(null)
          : loadActor(db, row.item.reviewedBy),
      ]);
      return toIntakeItem(row.item, row.batch, creator, reviewer);
    }),
  );
}

type Actor = { id: string; displayName: string; email: string };
type ItemRow = typeof schema.aiIntakeItems.$inferSelect;
type BatchRow = typeof schema.aiIntakeBatches.$inferSelect;

async function loadActor(db: Db, id: string): Promise<Actor> {
  const rows = await db
    .select({
      id: schema.users.id,
      displayName: schema.users.displayName,
      email: schema.users.email,
    })
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  const actor = rows[0];
  if (actor === undefined) throw notFound("User");
  return actor;
}

function toIntakeItem(
  item: ItemRow,
  batch: BatchRow,
  creator: Actor,
  reviewer: Actor | null,
): IntakeItem {
  return {
    id: item.id,
    batch: {
      id: batch.id,
      caseId: batch.caseId,
      source: batch.source,
      sourceLabel: batch.sourceLabel,
      runId: batch.runId,
      manifest: batch.manifest,
      createdBy: creator,
      createdAt: batch.createdAt,
    },
    status: item.status,
    draft: item.draft,
    citations: item.citations,
    confidence: item.confidence,
    createdFindingId: item.createdFindingId,
    mergedIntoFindingId: item.mergedIntoFindingId,
    reviewedBy: reviewer,
    reviewedAt: item.reviewedAt,
    rejectionReason: item.rejectionReason,
    revision: item.revision,
    createdAt: item.createdAt,
  };
}
