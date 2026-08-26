import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import type {
  AiRunWithProposals,
  AiProposal,
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
  EmptyState,
  ErrorState,
  FindingHeader,
  LoadingState,
  InlineError,
  Mono,
  Select,
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

/**
 * The written body of a finding.
 *
 * The hints are prompts, not instructions: an empty field is the most common
 * state of a half-written finding, and a blank box asks a researcher to
 * remember what belongs in it while they are still thinking about the bug.
 */
const FINDING_FIELDS = [
  {
    key: "summaryMarkdown",
    label: "Executive summary",
    hint: "What it is and why it matters, in a paragraph a manager will read.",
    height: "10rem",
  },
  {
    key: "technicalMarkdown",
    label: "Technical description",
    hint: "The mechanism. Code, requests and a diagram if the path is worth drawing.",
    height: "22rem",
  },
  {
    key: "preconditionsMarkdown",
    label: "Attack preconditions",
    hint: "What an attacker needs first: position, credentials, timing.",
    height: "10rem",
  },
  {
    key: "attackPathMarkdown",
    label: "Attack path",
    hint: "Entry to impact. A ```mermaid flowchart renders in the report.",
    height: "14rem",
  },
  {
    key: "impactMarkdown",
    label: "Security impact",
    hint: "What an attacker gains, in terms the vendor's risk owner uses.",
    height: "10rem",
  },
  {
    key: "reproductionMarkdown",
    label: "Reproduction steps",
    hint: "Numbered steps someone else can follow exactly. Fence the requests.",
    height: "16rem",
  },
  {
    key: "remediationMarkdown",
    label: "Remediation recommendation",
    hint: "The fix, and any interim mitigation worth naming.",
    height: "10rem",
  },
  {
    key: "researcherNotesMarkdown",
    label: "Researcher notes (internal)",
    hint: "Working notes. Never included in a report.",
    height: "10rem",
  },
] as const;

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

  const finding = useApiQuery<FindingDetail>(
    queryKeys.finding(findingId),
    `/v1/findings/${findingId}`,
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
  const canEdit = canWrite(user);

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
    <div className="flex h-full flex-col">
      <FindingHeader
        finding={data}
        actions={
          <div className="flex items-center gap-2">
            <VisibilityBadge visibility={data.visibility} />
            {canEdit ? null : (
              <span className="text-[11px] text-text-muted">Read only</span>
            )}
            <Button asChild variant="secondary" size="sm">
              <Link to={`/cases/${data.caseId}`}>Open case</Link>
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="technical">Technical</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="scoring">Scoring</TabsTrigger>
          <TabsTrigger value="prior-art">Prior art</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="p-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
            <FindingContextColumn
              finding={data}
              canEdit={canEdit}
              onError={setError}
            />

            <div className="space-y-4 xl:col-start-1 xl:row-start-1">
              {canEdit ? (
                <AiToolbar
                  targetType="FINDING"
                  targetId={data.id}
                  actions={AI_ACTIONS}
                  onCompleted={onAiCompleted}
                  className="border-b border-border pb-4"
                />
              ) : null}

              {proposals.length === 0 ? null : (
                <div className="space-y-3">
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

              <FindingContentEditor finding={data} canEdit={canEdit} />
            </div>
          </div>

          {error === null ? null : (
            <InlineError className="mt-3">{error}</InlineError>
          )}
        </TabsContent>

        <TabsContent value="technical" className="p-4">
          <FindingContentEditor
            finding={data}
            canEdit={canEdit}
            technicalOnly
          />
        </TabsContent>

        <TabsContent value="evidence">
          <EvidencePanel
            caseId={data.caseId}
            findingId={data.id}
            canEdit={canEdit}
          />
        </TabsContent>

        <TabsContent value="scoring">
          <ScoringPanel finding={data} canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="prior-art">
          <PriorArtPanel finding={data} canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="history" className="p-4">
          <FindingHistory findingId={data.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FindingContextColumn({
  finding,
  canEdit,
  onError,
}: {
  finding: FindingDetail;
  canEdit: boolean;
  onError: (message: string | null) => void;
}): React.JSX.Element {
  const primaryAsset = finding.assets.find((asset) => asset.primary);

  return (
    <aside className="space-y-4 xl:col-start-2 xl:row-start-1">
      <StatePanel finding={finding} canEdit={canEdit} onError={onError} />

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
    </aside>
  );
}

function StatePanel({
  finding,
  canEdit,
  onError,
}: {
  finding: FindingDetail;
  canEdit: boolean;
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
          disabled={!canEdit || update.isPending}
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
          {!canEdit
            ? "You have read-only access. An editor can change workflow state."
            : update.isPending
              ? "Saving state…"
              : "Prior-art state is set from its tab, where the conclusion stays attached to a specific check."}
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
  technicalOnly = false,
}: {
  finding: FindingDetail;
  canEdit: boolean;
  technicalOnly?: boolean;
}): React.JSX.Element {
  const [savingField, setSavingField] = useState<string | null>(null);

  const update = useApiMutation<
    FindingDetail,
    { field: string; value: string }
  >(
    ({ field, value }) => ({
      path: `/v1/findings/${finding.id}`,
      method: "PATCH",
      body: { [field]: value, expectedRevision: finding.revision },
    }),
    () => [queryKeys.finding(finding.id)],
  );

  const fields = technicalOnly
    ? FINDING_FIELDS.filter((field) =>
        [
          "technicalMarkdown",
          "preconditionsMarkdown",
          "attackPathMarkdown",
          "reproductionMarkdown",
        ].includes(field.key),
      )
    : FINDING_FIELDS.filter((field) =>
        [
          "summaryMarkdown",
          "impactMarkdown",
          "remediationMarkdown",
          "researcherNotesMarkdown",
        ].includes(field.key),
      );

  const [activeField, setActiveField] = useState<
    (typeof fields)[number]["key"]
  >(fields[0]?.key ?? "summaryMarkdown");
  const [localDrafts, setLocalDrafts] = useState<Record<string, string>>({});
  const completedCount = fields.filter((field) => {
    const stored =
      (finding[field.key as keyof FindingDetail] as string | null) ?? "";

    return (localDrafts[field.key] ?? stored).trim().length > 0;
  }).length;
  const failedField = fields.find((field) => field.key === savingField);

  return (
    <section
      aria-label={technicalOnly ? "Technical writing" : "Finding narrative"}
      className="overflow-hidden rounded-(--cv-radius-lg) border border-border bg-surface"
    >
      <div className="grid min-w-0 grid-cols-1 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <div className="border-b border-border bg-surface-raised lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-2 px-3 py-2.5">
            <div>
              <h2 className="text-[13px] font-semibold">
                {technicalOnly ? "Technical sections" : "Narrative sections"}
              </h2>
              <p className="mt-0.5 text-[10.5px] text-text-muted">
                {completedCount} of {fields.length} started
              </p>
            </div>
            {canEdit ? null : (
              <span className="text-[10.5px] text-text-muted">Read only</span>
            )}
          </div>

          <nav
            aria-label={
              technicalOnly ? "Technical sections" : "Narrative sections"
            }
            className="flex overflow-x-auto border-t border-border p-1 lg:block lg:overflow-visible"
          >
            {fields.map((field) => {
              const stored =
                (finding[field.key as keyof FindingDetail] as string | null) ??
                "";
              const text = localDrafts[field.key] ?? stored;
              const words =
                text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
              const selected = activeField === field.key;

              return (
                <button
                  key={field.key}
                  id={`finding-section-tab-${field.key}`}
                  type="button"
                  aria-pressed={selected}
                  aria-controls={`finding-section-panel-${field.key}`}
                  onClick={() => setActiveField(field.key)}
                  className={`min-h-12 min-w-44 rounded-(--cv-radius) px-2.5 py-2 text-left transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus lg:mb-0.5 lg:w-full lg:min-w-0 ${
                    selected
                      ? "bg-surface text-text"
                      : "text-text-muted hover:bg-surface-hover hover:text-text"
                  }`}
                >
                  <span className="block truncate text-[12px] font-medium">
                    {field.label}
                  </span>
                  <span className="mt-0.5 block text-[10.5px] tabular-nums">
                    {words === 0 ? "Not started" : `${words} words`}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="min-w-0 p-3">
          {update.error === null ? null : (
            <InlineError className="mb-3">
              {failedField?.label ?? "This section"} could not be saved. Your
              draft remains on this device. {update.error.message}
            </InlineError>
          )}

          {fields.map((field) => {
            const stored =
              (finding[field.key as keyof FindingDetail] as string | null) ??
              "";
            const selected = activeField === field.key;

            return (
              <section
                key={field.key}
                id={`finding-section-panel-${field.key}`}
                aria-labelledby={`finding-section-tab-${field.key}`}
                hidden={!selected}
              >
                <div className="mb-3">
                  <h3 className="text-[15px] font-semibold">{field.label}</h3>
                  <p className="mt-1 max-w-3xl text-[11px] leading-5 text-text-muted text-pretty">
                    {field.hint}
                  </p>
                </div>
                <MarkdownField
                  ariaLabel={field.label}
                  value={stored}
                  readOnly={!canEdit}
                  draftKey={`finding:${finding.id}:${field.key}`}
                  caseId={finding.caseId}
                  minHeight={technicalOnly ? "26rem" : "22rem"}
                  placeholder={
                    canEdit
                      ? `${field.hint} Markdown, with tables and diagrams.`
                      : "Empty."
                  }
                  saving={update.isPending && savingField === field.key}
                  error={
                    update.error !== null && savingField === field.key
                      ? "Save failed"
                      : null
                  }
                  onChange={(value) =>
                    setLocalDrafts((current) => ({
                      ...current,
                      [field.key]: value,
                    }))
                  }
                  onSave={(value) => {
                    setSavingField(field.key);
                    update.mutate({ field: field.key, value });
                  }}
                />
              </section>
            );
          })}
        </div>
      </div>
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
