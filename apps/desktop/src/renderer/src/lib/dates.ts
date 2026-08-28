/**
 * Date formatting.
 *
 * Timestamps are stored and transported in UTC and shown in the researcher's
 * local timezone, with the zone named whenever the exact moment matters — a
 * disclosure timeline that is ambiguous about which day something happened is
 * worse than no timeline.
 *
 * Implemented with `Intl` rather than a date library: this is the whole of what
 * the product needs, and it is a dozen lines.
 */

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["week", 7 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

const relativeFormatter = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
  style: "long",
});

/** "3 days ago", "in 2 weeks". Past and future both read naturally. */
export function formatDistanceToNowStrict(timestamp: string): string {
  const target = new Date(timestamp).getTime();

  if (Number.isNaN(target)) {
    return "—";
  }

  const difference = target - Date.now();
  const magnitude = Math.abs(difference);

  for (const [unit, milliseconds] of RELATIVE_UNITS) {
    if (magnitude >= milliseconds) {
      return relativeFormatter.format(
        Math.round(difference / milliseconds),
        unit,
      );
    }
  }

  return "just now";
}

/** Compact elapsed time for operational table cells: "3d 4h", "2h 18m". */
export function formatElapsedDuration(
  startedAt: string,
  endedAt: string | number = Date.now(),
): string {
  const started = new Date(startedAt).getTime();
  const ended =
    typeof endedAt === "number" ? endedAt : new Date(endedAt).getTime();

  if (Number.isNaN(started) || Number.isNaN(ended)) {
    return "—";
  }

  const minutes = Math.max(0, Math.floor((ended - started) / 60_000));
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const remainingMinutes = minutes % 60;

  if (days >= 365) {
    const years = Math.floor(days / 365);
    const remainingMonths = Math.floor((days % 365) / 30);
    return `${years}y${remainingMonths > 0 ? ` ${remainingMonths}mo` : ""}`;
  }

  if (days >= 30) {
    const months = Math.floor(days / 30);
    const remainingDays = days % 30;
    return `${months}mo${remainingDays > 0 ? ` ${remainingDays}d` : ""}`;
  }

  if (days > 0) {
    return `${days}d${hours > 0 ? ` ${hours}h` : ""}`;
  }

  if (hours > 0) {
    return `${hours}h${remainingMinutes > 0 ? ` ${remainingMinutes}m` : ""}`;
  }

  return `${remainingMinutes}m`;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short",
});

export function formatDate(timestamp: string | null): string {
  if (timestamp === null) {
    return "—";
  }

  const value = new Date(timestamp);

  return Number.isNaN(value.getTime()) ? "—" : dateFormatter.format(value);
}

/** Used wherever the exact moment matters: audit rows, disclosure events. */
export function formatDateTime(timestamp: string | null): string {
  if (timestamp === null) {
    return "—";
  }

  const value = new Date(timestamp);

  return Number.isNaN(value.getTime()) ? "—" : dateTimeFormatter.format(value);
}

/** ISO date for form inputs, in the local timezone. */
export function toDateInputValue(timestamp: string | null): string {
  if (timestamp === null) {
    return "";
  }

  const value = new Date(timestamp);

  if (Number.isNaN(value.getTime())) {
    return "";
  }

  const offset = value.getTimezoneOffset() * 60_000;

  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}
