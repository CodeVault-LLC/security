const FINDING_UPDATE_FIELDS = [
  "title",
  "summaryMarkdown",
  "technicalMarkdown",
  "preconditionsMarkdown",
  "attackPathMarkdown",
  "impactMarkdown",
  "reproductionMarkdown",
  "remediationMarkdown",
  "researcherNotesMarkdown",
  "validationState",
  "remediationState",
  "disclosureState",
  "externalIdState",
  "priorArtState",
  "visibility",
  "cweIds",
] as const;

const STATE_FIELDS = new Set<string>([
  "validationState",
  "remediationState",
  "disclosureState",
  "externalIdState",
  "priorArtState",
  "visibility",
]);

export interface FindingRevisionChanges {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  stateOnly: boolean;
}

/**
 * Produces the bounded before/after snapshot stored with a finding audit event.
 * Only fields accepted by the update contract are considered.
 */
export function collectFindingRevisionChanges(
  existingInput: object,
  bodyInput: object,
): FindingRevisionChanges {
  const existing = existingInput as Record<string, unknown>;
  const body = bodyInput as Record<string, unknown>;
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const changedFields: string[] = [];

  for (const field of FINDING_UPDATE_FIELDS) {
    const next = body[field];

    if (next === undefined || valuesEqual(existing[field], next)) {
      continue;
    }

    before[field] = existing[field];
    after[field] = next;
    changedFields.push(field);
  }

  return {
    before,
    after,
    stateOnly:
      changedFields.length > 0 &&
      changedFields.every((field) => STATE_FIELDS.has(field)),
  };
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => Object.is(value, right[index]))
    );
  }

  return false;
}
