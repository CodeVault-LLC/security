/**
 * Small display formatters.
 *
 * Kept together so the same value is written the same way everywhere it
 * appears — a size in an evidence list and a size in an AI context preview
 * should not disagree about what a kilobyte is.
 */

import { humaniseState } from "@codevault/ui";

export function formatBytesApprox(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB"];
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

/**
 * Turns `PEER_REVIEWED` into `Peer reviewed`, for labels and filters.
 *
 * Delegates to the UI package rather than keeping a second implementation.
 * The copy that used to live here had no acronym table, so the same enum came
 * out as "Cve reserved" in a disclosure timeline and "CVE reserved" in the
 * badge directly above it.
 */
export function humanise(value: string): string {
  return humaniseState(value);
}

/** Truncates in the middle, keeping both ends legible. */
export function truncateMiddle(value: string, max = 48): string {
  if (value.length <= max) {
    return value;
  }

  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);

  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}
