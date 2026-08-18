import { addBusinessDays } from "./business-days.js";

export const SUBMISSION_STATUSES = [
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
  "SEALED",
  "SENDING",
  "SENT",
  "SEND_FAILED",
  "RECORDED_MANUALLY",
  "CANCELLED",
] as const;

export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const COORDINATION_STATES = [
  "PREPARING",
  "AWAITING_ACKNOWLEDGEMENT",
  "ACKNOWLEDGED",
  "NEEDS_INFORMATION",
  "IN_TRIAGE",
  "IN_REMEDIATION",
  "FIX_AVAILABLE",
  "COORDINATING_DISCLOSURE",
  "RESOLVED",
  "CLOSED",
] as const;

export type CoordinationState = (typeof COORDINATION_STATES)[number];

export const MESSAGE_CLASSIFICATIONS = [
  "UNREVIEWED",
  "AUTO_REPLY",
  "ACKNOWLEDGEMENT",
  "REQUEST_FOR_INFORMATION",
  "STATUS_UPDATE",
  "FIX_AVAILABLE",
  "REJECTION",
  "OTHER",
] as const;

export type MessageClassification = (typeof MESSAGE_CLASSIFICATIONS)[number];

const SUBMISSION_TRANSITIONS: Record<
  SubmissionStatus,
  readonly SubmissionStatus[]
> = {
  DRAFT: ["IN_REVIEW", "CANCELLED"],
  IN_REVIEW: ["DRAFT", "APPROVED", "CANCELLED"],
  APPROVED: ["IN_REVIEW", "SEALED", "CANCELLED"],
  SEALED: ["SENDING", "RECORDED_MANUALLY", "CANCELLED"],
  SENDING: ["SENT", "SEND_FAILED"],
  SENT: ["DRAFT"],
  SEND_FAILED: ["SENDING", "CANCELLED"],
  RECORDED_MANUALLY: [],
  CANCELLED: [],
};

export function canTransitionSubmission(
  from: SubmissionStatus,
  to: SubmissionStatus,
): boolean {
  return from === to || SUBMISSION_TRANSITIONS[from].includes(to);
}

export function assertSubmissionTransition(
  from: SubmissionStatus,
  to: SubmissionStatus,
): void {
  if (!canTransitionSubmission(from, to)) {
    throw new Error(`Submission cannot transition from ${from} to ${to}.`);
  }
}

export interface NextActionInput {
  state: CoordinationState;
  lastOutboundAt?: string | null;
  lastInboundAt?: string | null;
  lastInboundClassification?: MessageClassification | null;
  acknowledgementBusinessDays: number;
  now?: string;
}

export type NextAction =
  | { kind: "VENDOR_REPLY_NEEDS_REVIEW"; dueAt: string }
  | { kind: "WAITING_FOR_ACKNOWLEDGEMENT"; dueAt: string }
  | { kind: "VENDOR_ACKNOWLEDGEMENT_OVERDUE"; dueAt: string }
  | { kind: "NONE"; dueAt: null };

function instantMs(value: string, field: string): number {
  const milliseconds = new Date(value).getTime();

  if (!Number.isFinite(milliseconds)) {
    throw new TypeError(`${field} must be a valid ISO instant.`);
  }

  return milliseconds;
}

/**
 * Derives a coordination prompt without mutating lifecycle state.
 *
 * Auto-replies are deliberately ignored for acknowledgement purposes. A real
 * reply first requires human classification/review; this function never turns
 * message arrival into a vendor acknowledgement on its own.
 */
export function computeNextAction(input: NextActionInput): NextAction {
  if (
    input.lastInboundAt !== undefined &&
    input.lastInboundAt !== null &&
    input.lastInboundClassification === "UNREVIEWED"
  ) {
    instantMs(input.lastInboundAt, "lastInboundAt");

    return {
      kind: "VENDOR_REPLY_NEEDS_REVIEW",
      dueAt: new Date(input.lastInboundAt).toISOString(),
    };
  }

  if (
    input.state !== "AWAITING_ACKNOWLEDGEMENT" ||
    input.lastOutboundAt === undefined ||
    input.lastOutboundAt === null
  ) {
    return { kind: "NONE", dueAt: null };
  }

  const classification = input.lastInboundClassification;

  if (
    input.lastInboundAt !== undefined &&
    input.lastInboundAt !== null &&
    classification !== undefined &&
    classification !== null &&
    classification !== "AUTO_REPLY"
  ) {
    return { kind: "NONE", dueAt: null };
  }

  const dueAt = addBusinessDays(
    input.lastOutboundAt,
    input.acknowledgementBusinessDays,
  );
  const now = input.now ?? new Date().toISOString();

  if (instantMs(now, "now") >= instantMs(dueAt, "dueAt")) {
    return { kind: "VENDOR_ACKNOWLEDGEMENT_OVERDUE", dueAt };
  }

  return { kind: "WAITING_FOR_ACKNOWLEDGEMENT", dueAt };
}
