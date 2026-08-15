import { sql } from "drizzle-orm";

import {
  formatReference,
  isYearScopedReference,
  type ReferenceKind,
} from "@codevault/core";

import type { Database } from "./client.js";

/**
 * Human-reference allocation.
 *
 * The sequence is bumped with a single `INSERT ... ON CONFLICT DO UPDATE`
 * returning the new value, so allocation is atomic and two concurrent creates
 * cannot both receive `FIND-2026-0007`. Call this inside the same transaction
 * as the insert it names.
 */

export async function allocateReference(
  db: Database,
  kind: ReferenceKind,
  now: Date = new Date(),
): Promise<string> {
  const year = isYearScopedReference(kind) ? now.getUTCFullYear() : 0;

  const result = await db.execute<{ value: number }>(sql`
    INSERT INTO reference_sequences (kind, year, value)
    VALUES (${kind}, ${year}, 1)
    ON CONFLICT (kind, year)
    DO UPDATE SET value = reference_sequences.value + 1
    RETURNING value
  `);

  const row = result.rows[0];

  if (row === undefined) {
    throw new Error(`Failed to allocate a reference for "${kind}".`);
  }

  return formatReference(
    kind,
    row.value,
    isYearScopedReference(kind) ? year : undefined,
  );
}
