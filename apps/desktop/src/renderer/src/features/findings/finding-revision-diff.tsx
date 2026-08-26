const FIELD_DETAILS: Record<
  string,
  { label: string; order: number; longForm?: boolean }
> = {
  ref: { label: "Reference", order: 0 },
  title: { label: "Title", order: 1 },
  summaryMarkdown: {
    label: "Executive summary",
    order: 2,
    longForm: true,
  },
  technicalMarkdown: {
    label: "Technical description",
    order: 3,
    longForm: true,
  },
  preconditionsMarkdown: {
    label: "Attack preconditions",
    order: 4,
    longForm: true,
  },
  attackPathMarkdown: { label: "Attack path", order: 5, longForm: true },
  impactMarkdown: { label: "Security impact", order: 6, longForm: true },
  reproductionMarkdown: {
    label: "Reproduction steps",
    order: 7,
    longForm: true,
  },
  remediationMarkdown: {
    label: "Remediation recommendation",
    order: 8,
    longForm: true,
  },
  researcherNotesMarkdown: {
    label: "Researcher notes",
    order: 9,
    longForm: true,
  },
  validationState: { label: "Validation state", order: 10 },
  remediationState: { label: "Remediation state", order: 11 },
  disclosureState: { label: "Disclosure state", order: 12 },
  externalIdState: { label: "External ID state", order: 13 },
  priorArtState: { label: "Prior-art state", order: 14 },
  visibility: { label: "Visibility", order: 15 },
  cweIds: { label: "CWE identifiers", order: 16 },
};

export interface FindingRevisionChange {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
  longForm: boolean;
}

export function findingRevisionChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): FindingRevisionChange[] {
  const previous = before ?? {};
  const next = after ?? {};
  const fields = new Set([...Object.keys(previous), ...Object.keys(next)]);

  return [...fields]
    .filter((field) => !valuesEqual(previous[field], next[field]))
    .sort((left, right) => {
      const leftOrder = FIELD_DETAILS[left]?.order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = FIELD_DETAILS[right]?.order ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.localeCompare(right);
    })
    .map((field) => ({
      field,
      label: FIELD_DETAILS[field]?.label ?? humanizeField(field),
      before: previous[field] ?? null,
      after: next[field] ?? null,
      longForm: FIELD_DETAILS[field]?.longForm ?? false,
    }));
}

export function formatRevisionValue(value: unknown): string {
  if (value === null || value === undefined) return "Not set";
  if (typeof value === "string") {
    if (value.trim().length === 0) return "Empty";
    return value;
  }
  if (Array.isArray(value)) {
    return value.length === 0
      ? "None"
      : value.map((item) => formatRevisionValue(item)).join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export function FindingRevisionDiff({
  changes,
}: {
  changes: FindingRevisionChange[];
}): React.JSX.Element | null {
  if (changes.length === 0) return null;

  return (
    <div className="mt-2 divide-y divide-border overflow-hidden rounded-(--cv-radius) border border-border">
      {changes.map((change) => (
        <div key={change.field} className="bg-surface px-3 py-2.5">
          <p className="mb-1.5 text-[11px] font-medium text-text-muted">
            {change.label}
          </p>
          <div
            className={
              change.longForm
                ? "grid gap-2 lg:grid-cols-2"
                : "grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_1rem_minmax(0,1fr)] sm:items-start"
            }
          >
            <RevisionValue
              label="Before"
              value={change.before}
              longForm={change.longForm}
            />
            <span
              aria-hidden
              className="hidden pt-1 text-center text-text-muted sm:block"
            >
              →
            </span>
            <RevisionValue
              label="After"
              value={change.after}
              longForm={change.longForm}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function RevisionValue({
  label,
  value,
  longForm,
}: {
  label: string;
  value: unknown;
  longForm: boolean;
}): React.JSX.Element {
  return (
    <div className="min-w-0">
      <span className="text-[10px] font-medium uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <pre
        className={
          longForm
            ? "mt-1 max-h-52 overflow-auto whitespace-pre-wrap rounded-(--cv-radius) bg-surface-raised p-2 font-mono text-[11px] text-text"
            : "mt-0.5 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-text"
        }
      >
        {formatRevisionValue(value)}
      </pre>
    </div>
  );
}

function humanizeField(field: string): string {
  return field
    .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => valuesEqual(value, right[index]))
    );
  }
  if (
    typeof left === "object" &&
    left !== null &&
    typeof right === "object" &&
    right !== null
  ) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return false;
}
