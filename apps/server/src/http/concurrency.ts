import { conflict } from "@codevault/core";

/**
 * Optimistic concurrency.
 *
 * Every mutable entity carries a revision, and every update states the revision
 * it was written against. This is what stops an AI proposal prepared five
 * minutes ago from overwriting an edit made two minutes ago, and it gives the
 * client the exact message the UX rules ask for.
 */

export interface RevisionedEntity {
  revision: number;
}

export function assertRevision(
  entity: RevisionedEntity,
  expectedRevision: number,
  entityLabel: string,
): void {
  if (entity.revision === expectedRevision) {
    return;
  }

  throw conflict(
    `This ${entityLabel} changed since you loaded it. ` +
      `Review the latest version before applying your change.`,
    { expectedRevision, currentRevision: entity.revision },
  );
}

/** The revision an update should write. */
export function nextRevision(entity: RevisionedEntity): number {
  return entity.revision + 1;
}
