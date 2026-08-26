export interface DisclosureCalendarDates {
  expectedResponseAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  plannedDisclosureAt: string | null;
}

export interface DisclosureCalendarInput {
  caseId: string;
  caseRef: string;
  caseTitle: string;
  generatedAt: string;
  dates: DisclosureCalendarDates;
}

const DATE_EVENTS: Array<{
  field: keyof DisclosureCalendarDates;
  slug: string;
  label: string;
}> = [
  {
    field: "expectedResponseAt",
    slug: "expected-response",
    label: "expected vendor response",
  },
  { field: "startsAt", slug: "embargo-start", label: "embargo starts" },
  { field: "endsAt", slug: "embargo-end", label: "embargo ends" },
  {
    field: "plannedDisclosureAt",
    slug: "planned-disclosure",
    label: "planned disclosure",
  },
];

/** Builds an RFC 5545 calendar containing only explicit case deadline metadata. */
export function exportDisclosureCalendar(
  input: DisclosureCalendarInput,
): string {
  const events = DATE_EVENTS.flatMap((definition) => {
    const value = input.dates[definition.field];
    if (value === null) return [];
    return [{ ...definition, value, date: calendarDate(value) }];
  }).sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.slug.localeCompare(right.slug),
  );

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "PRODID:-//CodeVault//Disclosure Calendar 1.0//EN",
    `X-WR-CALNAME:${escapeText(`${input.caseRef} disclosure deadlines`)}`,
  ];

  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.slug}-${input.caseId}@codevault.local`,
      `DTSTAMP:${calendarTimestamp(input.generatedAt)}`,
      `DTSTART;VALUE=DATE:${event.date}`,
      `SUMMARY:${escapeText(`${input.caseRef} ${event.label}`)}`,
      `DESCRIPTION:${escapeText(input.caseTitle)}`,
      "CLASS:PRIVATE",
      "STATUS:CONFIRMED",
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return `${lines.flatMap(foldContentLine).join("\r\n")}\r\n`;
}

function calendarDate(value: string): string {
  const date = validDate(value);
  return [
    date.getUTCFullYear().toString().padStart(4, "0"),
    (date.getUTCMonth() + 1).toString().padStart(2, "0"),
    date.getUTCDate().toString().padStart(2, "0"),
  ].join("");
}

function calendarTimestamp(value: string): string {
  const date = validDate(value);
  return `${calendarDate(date.toISOString())}T${[
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  ]
    .map((part) => part.toString().padStart(2, "0"))
    .join("")}Z`;
}

function validDate(value: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid disclosure calendar date: ${value}`);
  }
  return date;
}

function escapeText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\r", "\\n")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function foldContentLine(line: string): string[] {
  const encoder = new TextEncoder();
  const folded: string[] = [];
  let current = "";

  for (const character of line) {
    if (encoder.encode(current + character).byteLength <= 75) {
      current += character;
      continue;
    }
    folded.push(current);
    current = ` ${character}`;
  }

  folded.push(current);
  return folded;
}
