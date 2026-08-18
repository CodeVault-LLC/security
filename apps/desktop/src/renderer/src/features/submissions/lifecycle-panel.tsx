import { COORDINATION_STATES, type CoordinationState } from "@codevault/core";
import type {
  SubmissionDetail,
  UpdateSubmissionLifecycleRequest,
} from "@codevault/contracts";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  Select,
  Textarea,
} from "@codevault/ui";
import { useState } from "react";

import { humanise } from "../../lib/format.js";

type LifecycleFields = Omit<
  UpdateSubmissionLifecycleRequest,
  "expectedRevision"
>;

function inputDate(value: string | null): string {
  return value === null ? "" : new Date(value).toISOString().slice(0, 16);
}

function apiDate(value: string): string | null {
  return value === "" ? null : new Date(`${value}:00.000Z`).toISOString();
}

export function LifecyclePanel({
  submission,
  canEdit,
  saving,
  onSave,
}: {
  submission: SubmissionDetail;
  canEdit: boolean;
  saving: boolean;
  onSave: (fields: LifecycleFields) => void;
}): React.JSX.Element {
  const [coordinationState, setCoordinationState] = useState<CoordinationState>(
    submission.coordinationState,
  );
  const [plannedNextContactAt, setPlannedNextContactAt] = useState(
    inputDate(submission.plannedNextContactAt),
  );
  const [agreedDisclosureAt, setAgreedDisclosureAt] = useState(
    inputDate(submission.agreedDisclosureAt),
  );
  const [vendorReference, setVendorReference] = useState(
    submission.vendorReference ?? "",
  );
  const [coordinationNotes, setCoordinationNotes] = useState(
    submission.coordinationNotes ?? "",
  );
  const [snoozedUntil, setSnoozedUntil] = useState(
    inputDate(submission.snoozedUntil),
  );
  const [snoozeReason, setSnoozeReason] = useState(
    submission.snoozeReason ?? "",
  );

  const submit = (): void => {
    onSave({
      coordinationState,
      plannedNextContactAt: apiDate(plannedNextContactAt),
      agreedDisclosureAt: apiDate(agreedDisclosureAt),
      vendorReference: vendorReference.trim() || null,
      coordinationNotes: coordinationNotes.trim() || null,
      snoozedUntil: apiDate(snoozedUntil),
      snoozeReason: snoozeReason.trim() || null,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Coordination</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <label className="block space-y-1 text-[12px]">
          <span className="text-text-muted">State</span>
          <Select
            aria-label="Coordination state"
            value={coordinationState}
            disabled={!canEdit || saving}
            onValueChange={(value) =>
              setCoordinationState(value as CoordinationState)
            }
            options={COORDINATION_STATES.map((value) => ({
              value,
              label: humanise(value),
            }))}
          />
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
          <DateField
            label="Planned next contact (UTC)"
            value={plannedNextContactAt}
            disabled={!canEdit || saving}
            onChange={setPlannedNextContactAt}
          />
          <DateField
            label="Agreed disclosure (UTC)"
            value={agreedDisclosureAt}
            disabled={!canEdit || saving}
            onChange={setAgreedDisclosureAt}
          />
        </div>
        <label className="block space-y-1 text-[12px]">
          <span className="text-text-muted">Vendor reference</span>
          <Input
            value={vendorReference}
            maxLength={300}
            disabled={!canEdit || saving}
            placeholder="Ticket, PSIRT case, or advisory ID"
            onChange={(event) => setVendorReference(event.target.value)}
          />
        </label>
        <label className="block space-y-1 text-[12px]">
          <span className="text-text-muted">
            Coordination notes{" "}
            {coordinationState === "RESOLVED" || coordinationState === "CLOSED"
              ? "(required)"
              : ""}
          </span>
          <Textarea
            rows={3}
            value={coordinationNotes}
            maxLength={20_000}
            disabled={!canEdit || saving}
            placeholder="Decisions and outcomes; do not paste secrets."
            onChange={(event) => setCoordinationNotes(event.target.value)}
          />
        </label>
        <div className="rounded-(--cv-radius) border border-border p-2">
          <DateField
            label="Snooze until (UTC, maximum 180 days)"
            value={snoozedUntil}
            disabled={!canEdit || saving}
            onChange={(value) => {
              setSnoozedUntil(value);
              if (value === "") setSnoozeReason("");
            }}
          />
          <label className="mt-2 block space-y-1 text-[12px]">
            <span className="text-text-muted">Snooze reason</span>
            <Input
              value={snoozeReason}
              maxLength={1_000}
              disabled={!canEdit || saving || snoozedUntil === ""}
              placeholder="Required when snoozed"
              onChange={(event) => setSnoozeReason(event.target.value)}
            />
          </label>
        </div>
        {canEdit ? (
          <Button size="sm" loading={saving} onClick={submit}>
            Save coordination
          </Button>
        ) : null}
      </CardBody>
    </Card>
  );
}

function DateField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <label className="block space-y-1 text-[12px]">
      <span className="text-text-muted">{label}</span>
      <Input
        type="datetime-local"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
