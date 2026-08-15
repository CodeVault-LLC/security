/**
 * Small display formatters.
 *
 * Kept together so the same value is written the same way everywhere it
 * appears — a size in an evidence list and a size in an AI context preview
 * should not disagree about what a kilobyte is.
 */

export function formatBytesApprox(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

/** Turns `PEER_REVIEWED` into `Peer reviewed`, for labels and filters. */
export function humanise(value: string): string {
  const words = value.toLowerCase().split("_");
  const [first, ...rest] = words;

  if (first === undefined) {
    return value;
  }

  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
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
