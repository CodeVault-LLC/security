/**
 * Local drafts.
 *
 * A safety net, not a store. The server holds the document; this keeps a copy
 * of unsaved text in the window so that a crash, a closed dialog or a
 * navigation away mid-sentence does not lose the paragraph a researcher just
 * wrote about how they got in.
 *
 * Recovery is always offered, never applied: silently replacing what the
 * server returned with older local text is how someone loses an edit made
 * elsewhere without ever being told.
 */

const PREFIX = "cv-draft:";

/** Drafts older than this are cleared on the next write. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export interface StoredDraft {
  text: string;
  savedAt: number;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Access itself throws when storage is disabled for the origin.
    return null;
  }
}

export function readDraft(key: string): StoredDraft | null {
  const store = storage();

  if (store === null) {
    return null;
  }

  try {
    const raw = store.getItem(`${PREFIX}${key}`);

    if (raw === null) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as StoredDraft).text !== "string" ||
      typeof (parsed as StoredDraft).savedAt !== "number"
    ) {
      return null;
    }

    return parsed as StoredDraft;
  } catch {
    return null;
  }
}

export function writeDraft(key: string, text: string): void {
  const store = storage();

  if (store === null) {
    return;
  }

  try {
    pruneExpired(store);
    store.setItem(
      `${PREFIX}${key}`,
      JSON.stringify({ text, savedAt: Date.now() } satisfies StoredDraft),
    );
  } catch {
    // A full quota must never stop someone typing. The draft is a convenience;
    // the document itself is on the server.
  }
}

export function clearDraft(key: string): void {
  const store = storage();

  try {
    store?.removeItem(`${PREFIX}${key}`);
  } catch {
    // Nothing to do; see above.
  }
}

function pruneExpired(store: Storage): void {
  const cutoff = Date.now() - MAX_AGE_MS;
  const stale: string[] = [];

  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);

    if (key === null || !key.startsWith(PREFIX)) {
      continue;
    }

    const raw = store.getItem(key);

    if (raw === null) {
      continue;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      const savedAt = (parsed as StoredDraft | null)?.savedAt;

      if (typeof savedAt !== "number" || savedAt < cutoff) {
        stale.push(key);
      }
    } catch {
      stale.push(key);
    }
  }

  for (const key of stale) {
    store.removeItem(key);
  }
}
