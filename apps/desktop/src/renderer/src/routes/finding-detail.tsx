import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import type {
  AiRunWithProposals,
  AiProposal,
  FindingDetail,
} from "@codevault/contracts";
import {
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
  Mono,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  VisibilityBadge,
} from "@codevault/ui";

import { AiToolbar } from "../features/ai/ai-toolbar.js";
import { MarkdownField } from "../features/markdown/markdown-field.js";
import { PriorArtPanel } from "../features/findings/prior-art-panel.js";
import { ScoringPanel } from "../features/findings/scoring-panel.js";
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
  const [proposals, setProposals] = useState<AiProposal[]>([]);
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
    setProposals((current) => [...run.proposals, ...current]);
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
            <Link
              to={`/cases/${data.caseId}`}
              className="text-[12px] text-text-muted hover:text-text hover:underline"
            >
              Open case
            </Link>
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
            <div className="space-y-4">
              {canEdit ? (
                <Card>
                  <CardBody>
                    <AiToolbar
                      targetType="FINDING"
                      targetId={data.id}
                      actions={AI_ACTIONS}
                      onCompleted={onAiCompleted}
                    />
                  </CardBody>
                </Card>
              ) : null}

              {proposals.length === 0 ? null : (
                <div className="space-y-3">
                  {proposals.map((proposal) => (
                    <ProposalReview
                      key={proposal.id}
                      proposal={proposal}
                      finding={data}
                      onResolved={() => {
                        setProposals((current) =>
                          current.filter((item) => item.id !== proposal.id),
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

            <div className="space-y-4">
              <StatePanel finding={data} canEdit={canEdit} onError={setError} />

              <Card>
                <CardHeader>
                  <CardTitle>Affected</CardTitle>
                </CardHeader>
                <CardBody className="space-y-2 text-[12px]">
                  {data.assets.length === 0 ? (
                    <p className="text-text-muted">No asset linked yet.</p>
                  ) : (
                    <ul className="space-y-1">
                      {data.assets.map((asset) => (
                        <li
                          key={asset.assetId}
                          className="flex items-center gap-2"
                        >
                          <Mono className="text-text-muted">
                            {asset.assetRef}
                          </Mono>
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
                  )}

                  {data.affectedRanges.length === 0 ? (
                    <p className="text-text-muted">
                      No affected-version conclusion recorded.
                    </p>
                  ) : (
                    <ul className="space-y-1 border-t border-border pt-2">
                      {data.affectedRanges.map((range) => (
                        <li key={range.id}>
                          <Mono>{range.expression}</Mono>{" "}
                          <span className="text-text-muted">
                            {range.status.replace(/_/g, " ").toLowerCase()}
                          </span>
                          {range.verifiedAt === null ? (
                            <span className="ml-1 text-warning">
                              (not verified)
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Identifiers</CardTitle>
                </CardHeader>
                <CardBody className="text-[12px]">
                  {data.identifiers.length === 0 ? (
                    <p className="text-text-muted">None recorded.</p>
                  ) : (
                    <ul className="space-y-1">
                      {data.identifiers.map((identifier) => (
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
          </div>

          {error === null ? null : (
            <p className="mt-3 text-[12px] text-danger">{error}</p>
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
          values={VALIDATION_STATES}
          disabled={!canEdit}
          onChange={(value) => change("validationState", value)}
        />
        <StateRow
          label="Remediation"
          value={finding.remediationState}
          values={REMEDIATION_STATES}
          disabled={!canEdit}
          onChange={(value) => change("remediationState", value)}
        />
        <StateRow
          label="Disclosure"
          value={finding.disclosureState}
          values={DISCLOSURE_STATES}
          disabled={!canEdit}
          onChange={(value) => change("disclosureState", value)}
        />
        <StateRow
          label="Visibility"
          value={finding.visibility}
          values={["INTERNAL", "VENDOR", "PUBLIC"]}
          disabled={!canEdit}
          onChange={(value) => change("visibility", value)}
        />
        <p className="text-[11px] text-text-muted">
          Prior-art state is set from the Prior art tab, where the conclusion is
          recorded against a specific check.
        </p>
      </CardBody>
    </Card>
  );
}

function StateRow({
  label,
  value,
  values,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  values: readonly string[];
  disabled: boolean;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-[90px_1fr] items-center gap-2">
      <span className="text-[11px] uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <Select
        aria-label={label}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        options={values.map((item) => ({
          value: item,
          label: item.replace(/_/g, " ").toLowerCase(),
        }))}
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
    : FINDING_FIELDS;

  return (
    <div className="space-y-3">
      {fields.map((field) => {
        const stored =
          (finding[field.key as keyof FindingDetail] as string | null) ?? "";

        return (
          <Card key={field.key}>
            <CardHeader>
              <CardTitle>{field.label}</CardTitle>
              <span className="text-[11px] text-text-muted">{field.hint}</span>
            </CardHeader>
            <CardBody>
              {/*
                Autosaved: the old per-field Save button meant eight of them on
                a page, and a finding left unsaved because the researcher moved
                on to the next box.
              */}
              <MarkdownField
                value={stored}
                readOnly={!canEdit}
                draftKey={`finding:${finding.id}:${field.key}`}
                caseId={finding.caseId}
                minHeight={field.height}
                placeholder={
                  canEdit
                    ? `${field.hint} Markdown, with tables and diagrams.`
                    : "Empty."
                }
                saving={update.isPending && savingField === field.key}
                error={
                  update.error === null || savingField !== field.key
                    ? null
                    : `${errorHeading(update.error)}. ${update.error.message}`
                }
                onSave={(value) => {
                  setSavingField(field.key);
                  update.mutate({ field: field.key, value });
                }}
              />
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

function ProposalReview({
  proposal,
  finding,
  onResolved,
}: {
  proposal: AiProposal;
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
      actor: { displayName: string } | null;
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
      {items.map((event) => (
        <li key={event.id} className="px-3 py-2 text-[12px]">
          <div className="flex items-center gap-2">
            <Mono className="w-56 shrink-0 text-text-muted">
              {event.action}
            </Mono>
            <span className="flex-1">
              {event.actor?.displayName ?? "system"}
            </span>
            <span className="text-text-muted">
              {formatDateTime(event.occurredAt)}
            </span>
          </div>
          {event.after === null ? null : (
            <pre className="mt-1 overflow-x-auto rounded-(--cv-radius) bg-surface-raised p-1.5 font-mono text-[10.5px] text-text-muted">
              {JSON.stringify(event.after)}
            </pre>
          )}
        </li>
      ))}
    </ul>
  );
}
