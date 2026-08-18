function parseIsoInstant(value: string): Date {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(
      "Business-day arithmetic requires a valid ISO instant.",
    );
  }

  return date;
}

/** Adds whole weekdays while preserving the input instant's UTC time. */
export function addBusinessDays(iso: string, count: number): string {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("Business-day count must be a non-negative integer.");
  }

  const date = parseIsoInstant(iso);

  for (let added = 0; added < count;) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();

    if (day !== 0 && day !== 6) {
      added += 1;
    }
  }

  return date.toISOString();
}
