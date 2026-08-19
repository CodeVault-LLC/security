import { useState } from "react";

import type {
  FindingSummary,
  IntakeDraft,
  IntakeItem,
} from "@codevault/contracts";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  InlineError,
  Input,
  Label,
  LoadingState,
  Mono,
  Select,
  Textarea,
} from "@codevault/ui";

import { QueryError } from "../../components/query-boundary.js";
import { queryKeys, useApiMutation, useApiQuery } from "../../lib/api.js";
import { ManualIntakeDialog } from "./manual-intake-dialog.js";

export function IntakePanel({
  caseId,
  canEdit,
  findings,
}: {
  caseId: string;
  canEdit: boolean;
  findings: readonly FindingSummary[];
}): React.JSX.Element {
  const [manualOpen, setManualOpen] = useState(false);
  const items = useApiQuery<{ items: IntakeItem[] }>(
    queryKeys.intake(caseId),
    `/v1/intake?caseId=${caseId}`,
  );

  const accept = useApiMutation<IntakeItem, IntakeItem>(
    (item) => ({
      path: `/v1/intake/items/${item.id}/accept`,
      method: "POST",
      body: { expectedRevision: item.revision },
    }),
    () => [queryKeys.intake(caseId), queryKeys.findings({ caseId })],
  );
  const reject = useApiMutation<
    IntakeItem,
    { item: IntakeItem; reason: string }
  >(
    ({ item, reason }) => ({
      path: `/v1/intake/items/${item.id}/reject`,
      method: "POST",
      body: { expectedRevision: item.revision, reason },
    }),
    () => [queryKeys.intake(caseId)],
  );
  const save = useApiMutation<
    IntakeItem,
    { item: IntakeItem; draft: IntakeDraft }
  >(
    ({ item, draft }) => ({
      path: `/v1/intake/items/${item.id}`,
      method: "PATCH",
      body: { expectedRevision: item.revision, draft },
    }),
    () => [queryKeys.intake(caseId)],
  );
  const merge = useApiMutation<
    IntakeItem,
    { item: IntakeItem; findingId: string }
  >(
    ({ item, findingId }) => ({
      path: `/v1/intake/items/${item.id}/merge`,
      method: "POST",
      body: { expectedRevision: item.revision, findingId },
    }),
    () => [queryKeys.intake(caseId)],
  );

  const pending = (items.data?.items ?? []).filter(
    (item) => item.status === "PENDING",
  );
  const error = accept.error ?? reject.error ?? save.error ?? merge.error;

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-medium">Finding intake</h2>
          <p className="text-[11px] text-text-muted">
            Drafts from people and AI stay here until a researcher accepts them.
          </p>
        </div>
        {canEdit ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setManualOpen(true)}
          >
            Record existing finding
          </Button>
        ) : null}
      </div>

      {error === null ? null : <InlineError>{error.message}</InlineError>}

      {items.error !== null ? (
        <QueryError query={items} />
      ) : items.isLoading ? (
        <LoadingState label="Loading intake drafts…" />
      ) : pending.length === 0 ? (
        <EmptyState
          title="No findings waiting for review"
          description="Existing findings and future folder scans will appear here before they can change case data."
          action={
            canEdit ? (
              <Button variant="secondary" onClick={() => setManualOpen(true)}>
                Record existing finding
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {pending.map((item) => (
            <IntakeItemCard
              key={item.id}
              item={item}
              canEdit={canEdit}
              busy={
                accept.isPending ||
                reject.isPending ||
                save.isPending ||
                merge.isPending
              }
              findingOptions={findings.map((finding) => ({
                id: finding.id,
                label: `${finding.ref} · ${finding.title}`,
              }))}
              onAccept={() => accept.mutate(item)}
              onReject={(reason) => reject.mutate({ item, reason })}
              onSave={(draft) => save.mutate({ item, draft })}
              onMerge={(findingId) => merge.mutate({ item, findingId })}
            />
          ))}
        </div>
      )}

      <ManualIntakeDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        caseId={caseId}
      />
    </div>
  );
}

export function IntakeItemCard({
  item,
  canEdit,
  busy,
  onAccept,
  onReject,
  onSave,
  findingOptions = [],
  onMerge,
}: {
  item: IntakeItem;
  canEdit: boolean;
  busy: boolean;
  onAccept: () => void;
  onReject: (reason: string) => void;
  onSave: (draft: IntakeDraft) => void;
  findingOptions?: readonly { id: string; label: string }[];
  onMerge?: (findingId: string) => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.draft);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [merging, setMerging] = useState(false);
  const [mergeFindingId, setMergeFindingId] = useState<string>("");

  const setMarkdown = (
    field:
      | "summaryMarkdown"
      | "technicalMarkdown"
      | "impactMarkdown"
      | "remediationMarkdown",
    value: string,
  ): void => setDraft((current) => ({ ...current, [field]: value }));

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{item.draft.title}</CardTitle>
          <p className="mt-0.5 text-[11px] text-text-muted">
            {item.batch.sourceLabel} · {item.batch.source.toLowerCase()}
            {item.confidence === null
              ? ""
              : ` · ${item.confidence.toLowerCase()} confidence`}
          </p>
        </div>
        <Mono className="text-[10px] text-text-muted">rev {item.revision}</Mono>
      </CardHeader>

      <CardBody className="space-y-3">
        {editing ? (
          <>
            <div>
              <Label htmlFor={`intake-title-${item.id}`}>Title</Label>
              <Input
                id={`intake-title-${item.id}`}
                className="mt-1"
                value={draft.title}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
              />
            </div>
            {(
              [
                ["summaryMarkdown", "Summary"],
                ["technicalMarkdown", "Technical"],
                ["impactMarkdown", "Impact"],
                ["remediationMarkdown", "Remediation"],
              ] as const
            ).map(([field, label]) => (
              <div key={field}>
                <Label htmlFor={`${field}-${item.id}`}>{label}</Label>
                <Textarea
                  id={`${field}-${item.id}`}
                  className="mt-1 min-h-24"
                  value={draft[field] ?? ""}
                  onChange={(event) => setMarkdown(field, event.target.value)}
                />
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || draft.title.trim().length < 8}
                onClick={() => {
                  onSave({ ...draft, title: draft.title.trim() });
                  setEditing(false);
                }}
              >
                Save draft
              </Button>
            </div>
          </>
        ) : (
          <>
            {item.draft.summaryMarkdown === undefined ? null : (
              <p className="whitespace-pre-wrap text-[12px]">
                {item.draft.summaryMarkdown}
              </p>
            )}
            <div className="grid gap-3 lg:grid-cols-2">
              <DraftSection
                label="Technical"
                value={item.draft.technicalMarkdown}
              />
              <DraftSection label="Impact" value={item.draft.impactMarkdown} />
              <DraftSection
                label="Remediation"
                value={item.draft.remediationMarkdown}
              />
              <div>
                <p className="text-[10px] uppercase text-text-muted">
                  Citations
                </p>
                {item.citations.length === 0 ? (
                  <p className="text-[11px] text-warning">
                    No citations supplied.
                  </p>
                ) : (
                  <ul className="text-[11px] text-text-muted">
                    {item.citations.map((citation, index) => (
                      <li key={index}>
                        {citation.kind === "FILE"
                          ? citation.path
                          : citation.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}

        {rejecting ? (
          <div className="rounded-(--cv-radius) border border-danger/30 p-2">
            <Label htmlFor={`reject-${item.id}`}>Rejection reason</Label>
            <Input
              id={`reject-${item.id}`}
              className="mt-1"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRejecting(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={busy || reason.trim().length === 0}
                onClick={() => onReject(reason.trim())}
              >
                Confirm rejection
              </Button>
            </div>
          </div>
        ) : merging ? (
          <div className="rounded-(--cv-radius) border border-border p-2">
            <Label>Merge into existing finding</Label>
            <Select
              aria-label="Merge into existing finding"
              className="mt-1"
              value={mergeFindingId === "" ? undefined : mergeFindingId}
              onValueChange={setMergeFindingId}
              placeholder="Choose a finding"
              options={findingOptions.map((finding) => ({
                value: finding.id,
                label: finding.label,
              }))}
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMerging(false)}
              >
                Cancel
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || mergeFindingId === ""}
                onClick={() => onMerge?.(mergeFindingId)}
              >
                Confirm merge
              </Button>
            </div>
          </div>
        ) : canEdit ? (
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={() => setRejecting(true)}
            >
              Reject
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
            {findingOptions.length === 0 || onMerge === undefined ? null : (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => setMerging(true)}
              >
                Merge
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={onAccept}
            >
              Accept
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function DraftSection({
  label,
  value,
}: {
  label: string;
  value: string | undefined;
}): React.JSX.Element | null {
  if (value === undefined || value.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] uppercase text-text-muted">{label}</p>
      <p className="whitespace-pre-wrap text-[11px] text-text-muted">{value}</p>
    </div>
  );
}
