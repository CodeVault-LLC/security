import { validationError } from "@codevault/core";

/**
 * Cursor pagination.
 *
 * Cursors encode the sort key of the last row returned. Offsets would drift as
 * rows are inserted, which in an activity feed means silently skipping events.
 */

export interface Cursor {
  /** ISO timestamp of the last item on the previous page. */
  timestamp: string;
  /** Tie-breaker for rows sharing a timestamp. */
  id: string;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.timestamp}|${cursor.id}`, "utf8").toString(
    "base64url",
  );
}

export function decodeCursor(value: string | undefined): Cursor | null {
  if (value === undefined || value.length === 0) {
    return null;
  }

  const decoded = Buffer.from(value, "base64url").toString("utf8");
  const separator = decoded.lastIndexOf("|");

  if (separator < 0) {
    throw validationError("The pagination cursor is not valid.");
  }

  const timestamp = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);

  if (Number.isNaN(Date.parse(timestamp)) || id.length === 0) {
    throw validationError("The pagination cursor is not valid.");
  }

  return { timestamp, id };
}

export function pageSize(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
}

/**
 * Splits an over-fetched result into a page and its next cursor.
 *
 * Callers request `pageSize + 1` rows; the extra row is what proves another
 * page exists without a second count query.
 */
export function paginate<T extends { id: string }>(
  rows: T[],
  size: number,
  timestampOf: (row: T) => string,
): { items: T[]; nextCursor: string | null } {
  if (rows.length <= size) {
    return { items: rows, nextCursor: null };
  }

  const items = rows.slice(0, size);
  const last = items[items.length - 1];

  if (last === undefined) {
    return { items, nextCursor: null };
  }

  return {
    items,
    nextCursor: encodeCursor({ timestamp: timestampOf(last), id: last.id }),
  };
}
