import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { MoreHorizontal, PanelRight, Sparkles } from "lucide-react";
import { useState } from "react";

import type {
  AiRunWithProposals,
  AiProposal,
  CaseDetail,
  FindingDetail,
} from "@codevault/contracts";
import {
  CONTENT_VISIBILITIES,
  DISCLOSURE_STATES,
  REMEDIATION_STATES,
  VALIDATION_STATES,
} from "@codevault/core";
import {
  AiProposalPanel,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  LoadingState,
  InlineError,
  Mono,
  Select,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  stateSelectOptions,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  VisibilityBadge,
  visibilitySelectOptions,
  type SelectOption,
} from "@codevault/ui";

import { AiToolbar } from "../features/ai/ai-toolbar.js";
import { Avatar } from "../components/avatar.js";
import { MarkdownField } from "../features/markdown/markdown-field.js";
import {
  buildFindingDocument,
  parseFindingDocument,
} from "../features/findings/finding-document.js";
import { PriorArtPanel } from "../features/findings/prior-art-panel.js";
import {
  FindingRevisionDiff,
  findingRevisionChanges,
} from "../features/findings/finding-revision-diff.js";
import { ScoringPanel } from "../features/findings/scoring-panel.js";
import { AffectedVersionMatrix } from "../features/findings/affected-version-matrix.js";
import { RemediationSlaCard } from "../features/findings/remediation-sla-card.js";
import { PublicAdvisoryBuilder } from "../features/findings/public-advisory-builder.js";
import { EvidencePanel } from "../features/evidence/evidence-panel.js";
import { formatDateTime } from "../lib/dates.js";
import {
  errorHeading,
  queryKeys,
  useApiMutation,
  useApiQuery,
} from "../lib/api.js";
import { canWrite, useSession } from "../lib/session.js";
import { QueryError } from "../components/query-boundary.js";

/**
 * The finding workspace.
 *
 * The header is pinned; the tabs are the researcher's working surface. AI
 * proposals appear inline as diffs to accept, edit or reject, and no AI action
 * changes anything until one of those buttons is pressed.
 */

const AI_ACTIONS = [
  {
    id: "FINDING_DRAFT_SUMMARY" as const,
    label: "Draft summary",
    description: "Draft the executive summary from the recorded evidence.",
  },
  {
    id: "FINDING_DRAFT_TECHNICAL" as const,
    label: "Draft technical",
    description: "Draft the technical analysis from evidence and notes.",
  },
  {
    id: "FINDING_DRAFT_IMPACT" as const,
    label: "Draft impact",
    description: "Describe what an attacker gains.",
  },
  {
    id: "FINDING_SUGGEST_CWE" as const,
    label: "Suggest CWE",
    description: "Rank candidate weakness classifications with reasoning.",
  },
  {
    id: "FINDING_FACT_CHECK" as const,
    label: "Fact check",
    description: "Classify each claim against the recorded evidence.",
  },
  {
    id: "AFFECTED_VERSION_REVIEW" as const,
    label: "Review versions",
    description:
      "Highlight version conclusions that were inferred, not tested.",
  },
];

export function FindingDetailRoute({
  findingId,
}: {
  findingId: string;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const user = useSession((state) => state.user);
  // Carries the run's model alongside each proposal: the model is a property of
  // the run, but the reviewer needs it where they decide whether to accept.
  const [proposals, setProposals] = useState<ReviewableProposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAssist, setShowAssist] = useState(false);

  const finding = useApiQuery<FindingDetail>(
    queryKeys.finding(findingId),
    `/v1/findings/${findingId}`,
  );
  const caseId = finding.data?.caseId;
  const caseAccess = useApiQuery<CaseDetail>(
    queryKeys.case(caseId ?? "pending"),
    `/v1/cases/${caseId ?? "pending"}`,
    { enabled: caseId !== undefined },
  );

  if (finding.isLoading) {
    return <LoadingState label="Loading finding…" />;
  }

  if (finding.error !== null || finding.data === undefined) {
    return (
      <ErrorState
        title={errorHeading(finding.error)}
        description={
          finding.error?.message ?? "That finding could not be loaded."
        }
        action={
          <Button
            variant="secondary"
            size="sm"
            loading={finding.isFetching}
            onClick={() => void finding.refetch()}
          >
            Try again
          </Button>
        }
      />
    );
  }

  const data = finding.data;
  const ownsCase = user != null && caseAccess.data?.owner.id === user.id;
  const capabilities =
    caseAccess.data?.members.find((member) => member.user.id === user?.id)
      ?.capabilities ?? [];
  const canAct = canWrite(user);
  const canEdit = canAct && (ownsCase || capabilities.includes("WRITE"));
  const canApprove = canAct && (ownsCase || capabilities.includes("APPROVAL"));
  const canDisclose =
    canAct && (ownsCase || capabilities.includes("DISCLOSURE"));

  const onAiCompleted = (run: AiRunWithProposals): void => {
    setProposals((current) => [
      ...run.proposals.map((proposal) => ({ proposal, model: run.model })),
      ...current,
    ]);
    void queryClient.invalidateQueries({
      queryKey: queryKeys.finding(findingId),
    });
  };

  return (
    <Sheet>
      <div className="flex h-full flex-col">
        <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
          <Link
            to={`/cases/${data.caseId}`}
            className="shrink-0 rounded-sm focus-visible:outline-2 focus-visible:outline-focus"
            title={`Open case ${data.caseRef}`}
          >
            <Mono className="text-text-muted hover:text-text">{data.ref}</Mono>
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-[13px] font-semibold">
            {data.title}
          </h1>
          <div className="hidden shrink-0 items-center gap-1.5 md:flex">
            <VisibilityBadge visibility={data.visibility} />
          </div>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="size-8 px-0"
              aria-label="Finding details"
              title="Finding details"
            >
              <PanelRight aria-hidden className="size-3.5" />
            </Button>
          </SheetTrigger>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="size-8 px-0"
                aria-label="More finding actions"
                title="More actions"
              >
                <MoreHorizontal aria-hidden className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {canEdit ? (
                <DropdownMenuItem
                  onSelect={() => setShowAssist((current) => !current)}
                >
                  <Sparkles aria-hidden className="size-4" />
                  {showAssist ? "Hide assistant" : "Open assistant"}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem asChild>
                <Link to={`/cases/${data.caseId}`}>Open case</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {error === null ? null : (
          <InlineError className="mx-4 mt-3">{error}</InlineError>
        )}

        <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="scoring">Score</TabsTrigger>
            <TabsTrigger value="evidence">Evidence</TabsTrigger>
            <TabsTrigger value="prior-art">Prior art</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="overflow-hidden">
            <div className="flex h-full min-h-0 flex-col">
              {canEdit && showAssist ? (
                <AiToolbar
                  targetType="FINDING"
                  targetId={data.id}
                  actions={AI_ACTIONS}
                  onCompleted={onAiCompleted}
                  className="shrink-0 border-b border-border px-3 py-2"
                />
              ) : null}

              {proposals.length === 0 ? null : (
                <div className="max-h-64 shrink-0 space-y-3 overflow-y-auto border-b border-border p-3">
                  {proposals.map(({ proposal, model }) => (
                    <ProposalReview
                      key={proposal.id}
                      proposal={proposal}
                      model={model}
                      finding={data}
                      onResolved={() => {
                        setProposals((current) =>
                          current.filter(
                            (item) => item.proposal.id !== proposal.id,
                          ),
                        );
                        void queryClient.invalidateQueries({
                          queryKey: queryKeys.finding(findingId),
                        });
                      }}
                    />
                  ))}
                </div>
              )}

              <div className="min-h-0 flex-1">
                <FindingContentEditor finding={data} canEdit={canEdit} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="evidence">
            <EvidencePanel
              caseId={data.caseId}
              findingId={data.id}
              canEdit={canEdit}
            />
          </TabsContent>

          <TabsContent value="scoring">
            <ScoringPanel
              finding={data}
              canEdit={canEdit}
              canApprove={canApprove}
            />
          </TabsContent>

          <TabsContent value="prior-art">
            <PriorArtPanel finding={data} canEdit={canEdit} />
          </TabsContent>

          <TabsContent value="history" className="p-4">
            <FindingHistory findingId={data.id} />
          </TabsContent>
        </Tabs>
      </div>

      <SheetContent>
        <SheetHeader>
          <SheetTitle>Finding details</SheetTitle>
          <SheetDescription>
            Workflow, affected assets, identifiers and disclosure controls.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <FindingContextColumn
            finding={data}
            canEdit={canEdit}
            canDisclose={canDisclose}
            onError={setError}
          />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function FindingContextColumn({
  finding,
  canEdit,
  canDisclose,
  onError,
}: {
  finding: FindingDetail;
  canEdit: boolean;
  canDisclose: boolean;
  onError: (message: string | null) => void;
}): React.JSX.Element {
  const primaryAsset = finding.assets.find((asset) => asset.primary);

  return (
    <div className="space-y-4">
      <StatePanel
        finding={finding}
        canEdit={canEdit}
        canDisclose={canDisclose}
        onError={onError}
      />

      <RemediationSlaCard finding={finding} canEdit={canEdit} />

      <PublicAdvisoryBuilder finding={finding} canEdit={canEdit} />

      <Card>
        <CardHeader>
          <CardTitle>Affected</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2 text-[12px]">
          {finding.assets.length === 0 ? (
            <p className="text-text-muted">No asset linked yet.</p>
          ) : (
            <div className="space-y-2">
              <ul className="space-y-1">
                {finding.assets.map((asset) => (
                  <li key={asset.assetId} className="flex items-center gap-2">
                    <Mono className="text-text-muted">{asset.assetRef}</Mono>
                    <Link
                      to={`/assets/${asset.assetId}`}
                      className="min-w-0 flex-1 truncate hover:underline"
                    >
                      {asset.name}
                    </Link>
                    {asset.primary ? (
                      <span className="text-[10px] uppercase text-accent">
                        Primary
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {primaryAsset === undefined ? null : (
                <Button asChild variant="ghost" size="sm">
                  <Link
                    to="/findings"
                    search={{
                      assetId: primaryAsset.assetId,
                      assetName: primaryAsset.name,
                    }}
                  >
                    View findings on this asset
                  </Link>
                </Button>
              )}
            </div>
          )}

          {finding.assets.length === 0 ? null : (
            <div className="border-t border-border pt-2">
              <AffectedVersionMatrix
                assets={finding.assets}
                ranges={finding.affectedRanges}
              />
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Identifiers</CardTitle>
        </CardHeader>
        <CardBody className="text-[12px]">
          {finding.identifiers.length === 0 ? (
            <p className="text-text-muted">None recorded.</p>
          ) : (
            <ul className="space-y-1">
              {finding.identifiers.map((identifier) => (
                <li key={identifier.id} className="flex gap-2">
                  <span className="w-16 shrink-0 text-text-muted">
                    {identifier.scheme}
                  </span>
                  <Mono>{identifier.value}</Mono>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export function StatePanel({
  finding,
  canEdit,
  canDisclose,
  onError,
}: {
  finding: FindingDetail;
  canEdit: boolean;
  canDisclose: boolean;
  onError: (message: string | null) => void;
}): React.JSX.Element {
  const update = useApiMutation<FindingDetail, Record<string, string>>(
    (changes) => ({
      path: `/v1/findings/${finding.id}`,
      method: "PATCH",
      body: { ...changes, expectedRevision: finding.revision },
    }),
    () => [
      queryKeys.finding(finding.id),
      queryKeys.findings(),
      queryKeys.dashboard,
    ],
  );

  const change = (field: string, value: string): void => {
    onError(null);
    update.mutate(
      { [field]: value },
      { onError: (mutationError) => onError(mutationError.message) },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>State</CardTitle>
      </CardHeader>
      <CardBody className="space-y-2">
        <StateRow
          label="Validation"
          value={finding.validationState}
          options={stateSelectOptions("validation", VALIDATION_STATES)}
          disabled={!canEdit || update.isPending}
          onChange={(value) => change("validationState", value)}
        />
        <StateRow
          label="Remediation"
          value={finding.remediationState}
          options={stateSelectOptions("remediation", REMEDIATION_STATES)}
          disabled={!canEdit || update.isPending}
          onChange={(value) => change("remediationState", value)}
        />
        <StateRow
          label="Disclosure"
          value={finding.disclosureState}
          options={stateSelectOptions("disclosure", DISCLOSURE_STATES)}
          disabled={!canDisclose || update.isPending}
          onChange={(value) => change("disclosureState", value)}
        />
        <StateRow
          label="Visibility"
          value={finding.visibility}
          options={visibilitySelectOptions(CONTENT_VISIBILITIES)}
          disabled={!canEdit || update.isPending}
          onChange={(value) => change("visibility", value)}
        />
        <p className="text-[11px] leading-4 text-text-muted" role="status">
          {!canEdit && !canDisclose
            ? "You have read-only access. An editor can change workflow state."
            : update.isPending
              ? "Saving state…"
              : canEdit
                ? "Prior-art state is set from its tab, where the conclusion stays attached to a specific check."
                : "You can change disclosure state; research content remains read only."}
        </p>
      </CardBody>
    </Card>
  );
}

function StateRow({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly SelectOption[];
  disabled: boolean;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-[90px_1fr] items-center gap-2">
      <span className="text-[12px] font-medium text-text-muted">{label}</span>
      <Select
        aria-label={label}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        options={options}
      />
    </div>
  );
}

function FindingContentEditor({
  finding,
  canEdit,
}: {
  finding: FindingDetail;
  canEdit: boolean;
}): React.JSX.Element {
  const update = useApiMutation<FindingDetail, Record<string, string>>(
    (content) => ({
      path: `/v1/findings/${finding.id}`,
      method: "PATCH",
      body: { ...content, expectedRevision: finding.revision },
    }),
    () => [queryKeys.finding(finding.id)],
  );

  return (
    <section
      aria-label="Finding narrative"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-surface"
    >
      <MarkdownField
        ariaLabel="Finding document"
        value={buildFindingDocument(finding)}
        readOnly={!canEdit}
        draftKey={`finding:${finding.id}:document`}
        caseId={finding.caseId}
        fill
        showLineNumbers
        placeholder="Write the finding as one Markdown document. Keep the section headings so each part remains available to reports."
        saving={update.isPending}
        error={
          update.error === null
            ? null
            : `Save failed. Your local draft is safe. ${update.error.message}`
        }
        onSave={(value) => update.mutate(parseFindingDocument(value))}
      />
    </section>
  );
}

/** A proposal together with the model that produced it. */
interface ReviewableProposal {
  proposal: AiProposal;
  model: AiRunWithProposals["model"];
}

function ProposalReview({
  proposal,
  model,
  finding,
  onResolved,
}: {
  proposal: AiProposal;
  model: AiRunWithProposals["model"];
  finding: FindingDetail;
  onResolved: () => void;
}): React.JSX.Element {
  const accept = useApiMutation<AiProposal>(
    () => ({
      path: `/v1/ai/proposals/${proposal.id}/accept`,
      method: "POST",
      body: { expectedRevision: finding.revision },
    }),
    () => [queryKeys.finding(finding.id)],
  );

  const reject = useApiMutation<{ ok: true }>(
    () => ({
      path: `/v1/ai/proposals/${proposal.id}/reject`,
      method: "POST",
      body: {},
    }),
    () => [queryKeys.finding(finding.id)],
  );

  const currentValues: Record<string, unknown> = {};

  for (const field of Object.keys(proposal.patch)) {
    currentValues[field] = (finding as unknown as Record<string, unknown>)[
      field
    ];
  }

  return (
    <div>
      <AiProposalPanel
        proposal={proposal}
        currentValues={currentValues}
        model={model}
        busy={accept.isPending || reject.isPending}
        onAccept={() => accept.mutate(undefined, { onSuccess: onResolved })}
        onReject={() => reject.mutate(undefined, { onSuccess: onResolved })}
      />
      {accept.error === null ? null : (
        <p className="mt-1 text-[12px] text-danger">
          <span className="font-medium">{errorHeading(accept.error)}.</span>{" "}
          {accept.error.message}
        </p>
      )}
      {reject.error === null ? null : (
        <p className="mt-1 text-[12px] text-danger">
          <span className="font-medium">{errorHeading(reject.error)}.</span>{" "}
          {reject.error.message}
        </p>
      )}
    </div>
  );
}

function FindingHistory({
  findingId,
}: {
  findingId: string;
}): React.JSX.Element {
  const activity = useApiQuery<{
    items: Array<{
      id: string;
      action: string;
      actor: { id: string; displayName: string } | null;
      occurredAt: string;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    }>;
  }>(
    queryKeys.activity({ entityId: findingId }),
    `/v1/activity?entityType=finding&entityId=${findingId}&limit=100`,
  );

  const items = activity.data?.items ?? [];

  if (activity.error !== null) {
    return <QueryError query={activity} className="m-4" />;
  }

  if (activity.isLoading) {
    return <LoadingState label="Loading finding history…" />;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="No recorded history yet"
        description="State changes, score approvals and AI decisions appear here."
      />
    );
  }

  return (
    <ul className="divide-y divide-border rounded-(--cv-radius) border border-border">
      {items.map((event) => {
        const changes = findingRevisionChanges(event.before, event.after);
        const metadata = (
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-1 text-left sm:grid-cols-[14rem_1fr_auto] sm:items-center sm:gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <Mono className="text-text-muted">{event.action}</Mono>
              {changes.length === 0 ? null : (
                <span className="rounded-full bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
                  {changes.length} {changes.length === 1 ? "change" : "changes"}
                </span>
              )}
            </span>
            <div className="flex-1">
              {event.actor ? (
                <Avatar
                  avatarId={null}
                  userId={event.actor.id}
                  label={event.actor.displayName}
                  size="sm"
                  showLabel
                  className="gap-1.5"
                />
              ) : (
                "system"
              )}
            </div>
            <span className="text-text-muted">
              {formatDateTime(event.occurredAt)}
            </span>
          </div>
        );

        return (
          <li key={event.id} className="px-3 py-2.5 text-[12px]">
            {changes.length === 0 ? (
              metadata
            ) : (
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-(--cv-radius) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                  {metadata}
                  <span
                    aria-hidden
                    className="text-text-muted transition-transform group-open:rotate-90"
                  >
                    ›
                  </span>
                </summary>
                <FindingRevisionDiff changes={changes} />
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}
