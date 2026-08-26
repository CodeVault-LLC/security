import type {
  DisclosureState,
  PriorArtState,
  RemediationState,
  ValidationState,
} from "@codevault/core";
import type { SeverityRating } from "@codevault/standards";

export interface FindingFilterState {
  validationState: ValidationState | "";
  remediationState: RemediationState | "";
  disclosureState: DisclosureState | "";
  priorArtState: PriorArtState | "";
  severity: SeverityRating | "";
}

export type FindingViewId =
  | "needs-validation"
  | "needs-prior-art"
  | "unfixed-critical"
  | "ready-for-vendor"
  | "coordinating";

interface FindingFilterView {
  id: FindingViewId;
  label: string;
  description: string;
  filters: FindingFilterState;
}

const EMPTY_FILTERS: FindingFilterState = {
  validationState: "",
  remediationState: "",
  disclosureState: "",
  priorArtState: "",
  severity: "",
};

export const FINDING_FILTER_VIEWS: readonly FindingFilterView[] = [
  {
    id: "needs-validation",
    label: "Needs validation",
    description: "Draft findings awaiting reproduction or review.",
    filters: { ...EMPTY_FILTERS, validationState: "DRAFT" },
  },
  {
    id: "needs-prior-art",
    label: "Needs prior-art check",
    description: "Findings without a recorded prior-art conclusion.",
    filters: { ...EMPTY_FILTERS, priorArtState: "UNCHECKED" },
  },
  {
    id: "unfixed-critical",
    label: "Unfixed critical",
    description: "Critical findings that remain unfixed.",
    filters: {
      ...EMPTY_FILTERS,
      remediationState: "UNFIXED",
      severity: "CRITICAL",
    },
  },
  {
    id: "ready-for-vendor",
    label: "Ready for vendor",
    description: "Confirmed findings with contact material prepared.",
    filters: {
      ...EMPTY_FILTERS,
      validationState: "CONFIRMED",
      disclosureState: "CONTACT_PREPARED",
    },
  },
  {
    id: "coordinating",
    label: "In coordination",
    description: "Findings currently moving through vendor coordination.",
    filters: { ...EMPTY_FILTERS, disclosureState: "COORDINATING" },
  },
];

export function applyFindingView(id: FindingViewId): FindingFilterState {
  const view = FINDING_FILTER_VIEWS.find((item) => item.id === id);
  if (view === undefined) return { ...EMPTY_FILTERS };
  return { ...view.filters };
}

export function matchingFindingView(
  filters: FindingFilterState,
): FindingViewId | null {
  const match = FINDING_FILTER_VIEWS.find((view) =>
    filterStatesEqual(view.filters, filters),
  );
  return match?.id ?? null;
}

function filterStatesEqual(
  left: FindingFilterState,
  right: FindingFilterState,
): boolean {
  return (
    left.validationState === right.validationState &&
    left.remediationState === right.remediationState &&
    left.disclosureState === right.disclosureState &&
    left.priorArtState === right.priorArtState &&
    left.severity === right.severity
  );
}
