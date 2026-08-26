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
  let remaining = count;

  if (remaining > 0 && date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + 2);
    remaining -= 1;
  } else if (remaining > 0 && date.getUTCDay() === 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    remaining -= 1;
  }

  const wholeWeeks = Math.floor(remaining / 5);

  if (wholeWeeks > 0) {
    date.setUTCDate(date.getUTCDate() + wholeWeeks * 7);
    remaining -= wholeWeeks * 5;
  }

  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();

    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }

  return date.toISOString();
}
