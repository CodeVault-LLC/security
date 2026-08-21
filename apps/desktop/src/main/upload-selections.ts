import { randomUUID } from "node:crypto";

import type { LocalUploadSelection } from "./file-uploads.js";
import type { StoredSession } from "./session-store.js";

const DEFAULT_TTL_MS = 15 * 60_000;
const DEFAULT_MAX_SELECTIONS = 5_000;

type SelectionOwner = Pick<StoredSession, "serverUrl" | "token" | "userId">;
type PendingSelection = {
  selection: LocalUploadSelection;
  owner: SelectionOwner;
  expiresAt: number;
};

function hasSameOwner(left: SelectionOwner, right: SelectionOwner): boolean {
  return (
    left.userId === right.userId &&
    left.serverUrl === right.serverUrl &&
    left.token === right.token
  );
}

/**
 * Short-lived, session-bound capabilities for local files chosen in the OS picker.
 *
 * The renderer receives only an opaque identifier. A capability cannot cross
 * an account/server transition and expires even when the renderer abandons it
 * without logging out. It remains usable after a failed upload and is consumed
 * only after that file reaches canonical storage.
 */
export class UploadSelectionStore {
  private readonly selections = new Map<string, PendingSelection>();

  constructor(
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly maxSelections = DEFAULT_MAX_SELECTIONS,
  ) {}

  issue(
    selection: Omit<LocalUploadSelection, "selectionId">,
    owner: SelectionOwner,
    now = Date.now(),
  ): LocalUploadSelection {
    this.prune(now);
    let selectionId: string;
    do {
      selectionId = randomUUID();
    } while (this.selections.has(selectionId));

    const issued = { selectionId, ...selection };
    this.selections.set(selectionId, {
      selection: issued,
      owner: {
        userId: owner.userId,
        serverUrl: owner.serverUrl,
        token: owner.token,
      },
      expiresAt: now + this.ttlMs,
    });
    while (this.selections.size > this.maxSelections) {
      const oldest = this.selections.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.selections.delete(oldest);
    }
    return issued;
  }

  consume(
    selectionIds: readonly string[],
    owner: SelectionOwner,
    now = Date.now(),
  ): LocalUploadSelection[] {
    this.prune(now);
    const uniqueIds = new Set(selectionIds);
    if (uniqueIds.size !== selectionIds.length) {
      throw new Error("An upload selection cannot be used more than once.");
    }

    const resolved = selectionIds.map((selectionId) => {
      const pending = this.selections.get(selectionId);
      if (!pending || !hasSameOwner(pending.owner, owner)) {
        throw new Error("The upload selection expired or changed session.");
      }
      return pending.selection;
    });

    for (const selectionId of selectionIds) this.selections.delete(selectionId);
    return resolved;
  }

  resolve(
    selectionIds: readonly string[],
    owner: SelectionOwner,
    now = Date.now(),
  ): LocalUploadSelection[] {
    this.prune(now);
    const uniqueIds = new Set(selectionIds);
    if (uniqueIds.size !== selectionIds.length) {
      throw new Error("An upload selection cannot appear twice in one batch.");
    }

    return selectionIds.map((selectionId) => {
      const pending = this.selections.get(selectionId);
      if (!pending || !hasSameOwner(pending.owner, owner)) {
        throw new Error("The upload selection expired or changed session.");
      }
      return pending.selection;
    });
  }

  clear(): void {
    this.selections.clear();
  }

  private prune(now: number): void {
    for (const [selectionId, pending] of this.selections) {
      if (pending.expiresAt <= now) this.selections.delete(selectionId);
    }
  }
}
