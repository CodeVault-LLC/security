import {
  AlertTriangle,
  BadgeCheck,
  Landmark,
  Plus,
  ShieldCheck,
  Target,
  UserRound,
  Wrench,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import type {
  DisclosureOverview,
  SubmissionSummary,
} from "@codevault/contracts";
import { CONTENT_VISIBILITIES, DISCLOSURE_EVENT_TYPES } from "@codevault/core";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  EmptyState,
  Input,
  Label,
  LoadingState,
  Mono,
  Select,
  visibilitySelectOptions,
} from "@codevault/ui";

import {
  formatDate,
  formatDateTime,
  toDateInputValue,
} from "../../lib/dates.js";
import { humanise } from "../../lib/format.js";
import { Avatar } from "../../components/avatar.js";
import { MarkdownField } from "../markdown/markdown-field.js";
import { MarkdownPreview } from "../markdown/markdown-preview.js";
import { queryKeys, useApiMutation, useApiQuery } from "../../lib/api.js";
import { QueryError } from "../../components/query-boundary.js";
import { CreateSubmissionDialog } from "../submissions/create-submission-dialog.js";

/**
 * Disclosure coordination.
 *
 * A timeline of structured events, the stakeholders they involve, and the
 * dates that were agreed. Warnings appear here and nowhere else: CodeVault
 * does not email a vendor on a researcher's behalf, because a tool that
 * notifies a third party on a schedule has made a disclosure decision that was
 * not its to make.
 */

/**
 * Who a stakeholder is to this case.
 *
 * Spelled out because the difference between a CNA and a CERT decides who
 * assigns an identifier and who coordinates the date, and getting that wrong
 * costs a researcher weeks.
 */
const STAKEHOLDER_ROLES = [
  {
    value: "VENDOR_SECURITY",
    description: "The vendor's security or PSIRT contact.",
    icon: <ShieldCheck className="size-3.5" />,
  },
  {
    value: "VENDOR_ENGINEERING",
    description: "Engineers building the fix.",
    icon: <Wrench className="size-3.5" />,
  },
  {
    value: "CNA",
    description: "Numbering authority that assigns the CVE.",
    icon: <BadgeCheck className="size-3.5" />,
  },
  {
    value: "CERT",
    description: "A coordination centre acting as intermediary.",
    icon: <Landmark className="size-3.5" />,
  },
  {
    value: "PROGRAM",
    description: "A bug bounty or disclosure programme.",
    icon: <Target className="size-3.5" />,
  },
  {
    value: "OTHER",
    description: "Anyone else involved in the coordination.",
    icon: <UserRound className="size-3.5" />,
  },
] as const;

export interface DisclosurePanelProps {
  caseId: string;
  canEdit: boolean;
}

export function DisclosurePanel({
  caseId,
  canEdit,
}: DisclosurePanelProps): React.JSX.Element {
  const [eventOpen, setEventOpen] = useState(false);
  const [stakeholderOpen, setStakeholderOpen] = useState(false);
  const [submissionOpen, setSubmissionOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const overview = useApiQuery<DisclosureOverview>(
    queryKeys.disclosure(caseId),
    `/v1/cases/${caseId}/disclosure`,
  );
  const submissions = useApiQuery<SubmissionSummary[]>(
    queryKeys.submissions(caseId),
    `/v1/cases/${caseId}/submissions`,
  );

  const setEmbargo = useApiMutation<
    DisclosureOverview,
    Record<string, string | null>
  >(
    (body) => ({
      path: `/v1/cases/${caseId}/embargo`,
      method: "POST",
      body,
    }),
    () => [queryKeys.disclosure(caseId), queryKeys.dashboard],
  );

  const data = overview.data;

  return (
    <div className="space-y-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Vendor submissions</CardTitle>
          {canEdit ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => setSubmissionOpen(true)}
            >
              <Plus aria-hidden className="size-3" />
              Prepare submission
            </Button>
          ) : null}
        </CardHeader>
        {submissions.data === undefined || submissions.data.length === 0 ? (
          <CardBody className="text-[12px] text-text-muted">
            No vendor package has been prepared. Route details are snapshotted
            when a draft is created.
          </CardBody>
        ) : (
          <ul className="divide-y divide-border">
            {submissions.data.map((submission) => (
              <li key={submission.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-surface-raised"
                  onClick={() =>
                    void navigate({
                      to: "/submissions/$submissionId",
                      params: { submissionId: submission.id },
                    })
                  }
                >
                  <Mono>{submission.ref}</Mono>
                  <span className="min-w-0 flex-1 truncate">
                    {submission.vendor.name}
                  </span>
                  <span className="text-text-muted">
                    {humanise(submission.status)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {data?.warnings.length ? (
        <Card className="border-warning/40">
          <CardBody className="space-y-1">
            {data.warnings.map((warning) => (
              <p
                key={warning.code}
                className="flex items-start gap-2 text-[12px] text-warning"
              >
                <AlertTriangle
                  aria-hidden
                  className="mt-0.5 size-3.5 shrink-0"
                />
                <span>
                  {warning.message}
                  {warning.dueAt === null
                    ? ""
                    : ` (${formatDate(warning.dueAt)})`}
                </span>
              </p>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
            {canEdit ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setEventOpen(true)}
              >
                <Plus aria-hidden className="size-3" />
                Record event
              </Button>
            ) : null}
          </CardHeader>

          <QueryError query={overview} />

          {data === undefined ? (
            <LoadingState />
          ) : data.events.length === 0 ? (
            <EmptyState
              title="No disclosure events recorded"
              description="Discovery, first contact, acknowledgement, patch and publication — each with its date and, where relevant, its correspondence."
            />
          ) : (
            <ul className="divide-y divide-border">
              {data.events.map((event) => (
                <li key={event.id} className="flex gap-3 px-3 py-2 text-[12px]">
                  <Mono className="w-24 shrink-0 text-text-muted">
                    {formatDate(event.occurredAt)}
                  </Mono>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {event.label ?? humanise(event.type)}
                    </p>
                    {event.detailMarkdown === null ? null : (
                      <MarkdownPreview
                        markdown={event.detailMarkdown}
                        className="mt-0.5 text-text-muted"
                        debounceMs={0}
                      />
                    )}
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-text-muted">
                      {event.stakeholderName === null
                        ? ""
                        : `${event.stakeholderName} · `}
                      <span>recorded by</span>
                      <Avatar
                        avatarId={null}
                        userId={event.recordedBy.id}
                        label={event.recordedBy.displayName}
                        size="sm"
                        showLabel
                        className="gap-1"
                      />
                      <span>on {formatDateTime(event.createdAt)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Stakeholders</CardTitle>
              {canEdit ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setStakeholderOpen(true)}
                >
                  Add
                </Button>
              ) : null}
            </CardHeader>
            {data === undefined || data.stakeholders.length === 0 ? (
              <CardBody className="text-[12px] text-text-muted">
                No contact recorded. Coordinated disclosure requires one before
                you can log that the vendor was contacted.
              </CardBody>
            ) : (
              <ul className="divide-y divide-border">
                {data.stakeholders.map((stakeholder) => (
                  <li key={stakeholder.id} className="px-3 py-2 text-[12px]">
                    <p className="font-medium">{stakeholder.name}</p>
                    <p className="text-text-muted">
                      {stakeholder.organisation ?? "—"} ·{" "}
                      {humanise(stakeholder.role)}
                    </p>
                    {stakeholder.email === null ? null : (
                      <Mono className="text-text-muted">
                        {stakeholder.email}
                      </Mono>
                    )}
                    {stakeholder.secureChannel === null ? null : (
                      <Mono className="block truncate text-[10.5px] text-text-muted">
                        {stakeholder.secureChannel}
                      </Mono>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Dates</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
              <DateField
                label="Expected vendor response"
                value={data?.embargo?.expectedResponseAt ?? null}
                disabled={!canEdit}
                onChange={(value) =>
                  setEmbargo.mutate(
                    { expectedResponseAt: value },
                    { onError: (e) => setError(e.message) },
                  )
                }
              />
              <DateField
                label="Embargo starts"
                value={data?.embargo?.startsAt ?? null}
                disabled={!canEdit}
                onChange={(value) =>
                  setEmbargo.mutate(
                    { startsAt: value },
                    { onError: (e) => setError(e.message) },
                  )
                }
              />
              <DateField
                label="Embargo ends"
                value={data?.embargo?.endsAt ?? null}
                disabled={!canEdit}
                onChange={(value) =>
                  setEmbargo.mutate(
                    { endsAt: value },
                    { onError: (e) => setError(e.message) },
                  )
                }
              />
              <DateField
                label="Planned disclosure"
                value={data?.embargo?.plannedDisclosureAt ?? null}
                disabled={!canEdit}
                onChange={(value) =>
                  setEmbargo.mutate(
                    { plannedDisclosureAt: value },
                    { onError: (e) => setError(e.message) },
                  )
                }
              />
              {error === null ? null : (
                <p className="text-[12px] text-danger">{error}</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <RecordEventDialog
        open={eventOpen}
        onOpenChange={setEventOpen}
        caseId={caseId}
        stakeholders={data?.stakeholders ?? []}
      />
      <AddStakeholderDialog
        open={stakeholderOpen}
        onOpenChange={setStakeholderOpen}
        caseId={caseId}
      />
      <CreateSubmissionDialog
        caseId={caseId}
        open={submissionOpen}
        onOpenChange={setSubmissionOpen}
        onCreated={(submission) => {
          setSubmissionOpen(false);
          void navigate({
            to: "/submissions/$submissionId",
            params: { submissionId: submission.id },
          });
        }}
      />
    </div>
  );
}

function DateField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string | null;
  disabled: boolean;
  onChange: (value: string | null) => void;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-[150px_1fr] items-center gap-2">
      <span className="text-[11px] uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <Input
        type="date"
        aria-label={label}
        disabled={disabled}
        value={toDateInputValue(value)}
        onChange={(event) =>
          onChange(
            event.target.value.length === 0
              ? null
              : new Date(`${event.target.value}T00:00:00Z`).toISOString(),
          )
        }
      />
    </div>
  );
}

function RecordEventDialog({
  open,
  onOpenChange,
  caseId,
  stakeholders,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  stakeholders: DisclosureOverview["stakeholders"];
}): React.JSX.Element {
  const [type, setType] = useState<string>("VENDOR_CONTACTED");
  const [label, setLabel] = useState("");
  const [occurredAt, setOccurredAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [detail, setDetail] = useState("");
  const [stakeholderId, setStakeholderId] = useState("");
  const [visibility, setVisibility] = useState("VENDOR");
  const [error, setError] = useState<string | null>(null);

  const record = useApiMutation<unknown>(
    () => ({
      path: `/v1/cases/${caseId}/disclosure-events`,
      method: "POST",
      body: {
        type,
        ...(label.trim().length === 0 ? {} : { label: label.trim() }),
        occurredAt: new Date(`${occurredAt}T12:00:00Z`).toISOString(),
        ...(detail.trim().length === 0
          ? {}
          : { detailMarkdown: detail.trim() }),
        ...(stakeholderId.length === 0 ? {} : { stakeholderId }),
        visibility,
      },
    }),
    () => [queryKeys.disclosure(caseId), queryKeys.dashboard],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Record a disclosure event"
        description="The timeline in every report is generated from these entries."
      >
        <DialogBody className="space-y-3">
          <div>
            <Label>Event</Label>
            <Select
              aria-label="Event type"
              value={type}
              onValueChange={setType}
              className="mt-1"
              options={DISCLOSURE_EVENT_TYPES.map((value) => ({
                value,
                label: humanise(value),
              }))}
            />
          </div>

          {type === "CUSTOM" ? (
            <div>
              <Label htmlFor="event-label">Label</Label>
              <Input
                id="event-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                className="mt-1"
              />
            </div>
          ) : null}

          <div>
            <Label htmlFor="event-date">Date</Label>
            <Input
              id="event-date"
              type="date"
              value={occurredAt}
              onChange={(event) => setOccurredAt(event.target.value)}
              className="mt-1"
            />
          </div>

          {stakeholders.length === 0 ? null : (
            <div>
              <Label>Stakeholder (optional)</Label>
              <Select
                aria-label="Stakeholder"
                value={stakeholderId.length === 0 ? undefined : stakeholderId}
                onValueChange={setStakeholderId}
                placeholder="None"
                className="mt-1"
                options={stakeholders.map((stakeholder) => ({
                  value: stakeholder.id,
                  label: stakeholder.name,
                  description: stakeholder.organisation ?? undefined,
                }))}
              />
            </div>
          )}

          <div>
            <Label>Visibility</Label>
            <Select
              aria-label="Visibility"
              value={visibility}
              onValueChange={setVisibility}
              className="mt-1"
              options={visibilitySelectOptions(CONTENT_VISIBILITIES)}
            />
          </div>

          <div>
            <Label>Detail (optional)</Label>
            <div className="mt-1">
              <MarkdownField
                value={detail}
                onChange={setDetail}
                draftKey={`disclosure:new:${caseId}`}
                caseId={caseId}
                minHeight="9rem"
                placeholder="What happened, and what was sent or received. Markdown."
              />
            </div>
          </div>

          {error === null ? null : (
            <p className="text-[12px] text-danger">{error}</p>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={record.isPending}
            onClick={() =>
              record.mutate(undefined, {
                onSuccess: () => {
                  onOpenChange(false);
                  setDetail("");
                },
                onError: (mutationError) => setError(mutationError.message),
              })
            }
          >
            Record event
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddStakeholderDialog({
  open,
  onOpenChange,
  caseId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [role, setRole] = useState("VENDOR_SECURITY");
  const [email, setEmail] = useState("");
  const [secureChannel, setSecureChannel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = useApiMutation<unknown>(
    () => ({
      path: `/v1/cases/${caseId}/stakeholders`,
      method: "POST",
      body: {
        name: name.trim(),
        ...(organisation.trim().length === 0
          ? {}
          : { organisation: organisation.trim() }),
        role,
        ...(email.trim().length === 0 ? {} : { email: email.trim() }),
        ...(secureChannel.trim().length === 0
          ? {}
          : { secureChannel: secureChannel.trim() }),
      },
    }),
    () => [queryKeys.disclosure(caseId), queryKeys.caseReadiness(caseId)],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add a disclosure contact">
        <DialogBody className="space-y-3">
          <div>
            <Label htmlFor="stakeholder-name">Name</Label>
            <Input
              id="stakeholder-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="stakeholder-org">Organisation</Label>
            <Input
              id="stakeholder-org"
              value={organisation}
              onChange={(event) => setOrganisation(event.target.value)}
              className="mt-1"
            />
          </div>

          <div>
            <Label>Role</Label>
            <Select
              aria-label="Role"
              value={role}
              onValueChange={setRole}
              className="mt-1"
              options={STAKEHOLDER_ROLES.map(
                ({ value, description, icon }) => ({
                  value,
                  label: humanise(value),
                  description,
                  icon,
                }),
              )}
            />
          </div>

          <div>
            <Label htmlFor="stakeholder-email">Email</Label>
            <Input
              id="stakeholder-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="stakeholder-channel">
              Secure channel (PGP fingerprint, portal)
            </Label>
            <Input
              id="stakeholder-channel"
              value={secureChannel}
              onChange={(event) => setSecureChannel(event.target.value)}
              className="mt-1 font-mono"
            />
          </div>

          {error === null ? null : (
            <p className="text-[12px] text-danger">{error}</p>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={name.trim().length === 0 || add.isPending}
            onClick={() =>
              add.mutate(undefined, {
                onSuccess: () => {
                  onOpenChange(false);
                  setName("");
                  setOrganisation("");
                  setEmail("");
                  setSecureChannel("");
                },
                onError: (mutationError) => setError(mutationError.message),
              })
            }
          >
            Add contact
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
