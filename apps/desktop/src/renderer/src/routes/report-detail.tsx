import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Download, FileWarning } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  AiProposal,
  AiRunWithProposals,
  LintFinding,
  LintResult,
  ReportDetail,
  ReportExport,
  ReportPreview,
  ReportSection,
} from "@codevault/contracts";
import {
  AiProposalPanel,
  ApprovalState,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Mono,
  ReportSectionStatus,
  TlpBadge,
} from "@codevault/ui";

import { AiToolbar } from "../features/ai/ai-toolbar.js";
import { MarkdownEditor } from "../features/reports/markdown-editor.js";
import {
  errorHeading,
  queryKeys,
  useApiMutation,
  useApiQuery,
} from "../lib/api.js";
import { canWrite, useSession } from "../lib/session.js";

/**
 * The report workspace.
 *
 * Section tree on the left, Markdown in the middle, rendered preview and lint
 * on the right. The lint panel is not decoration: a BLOCKING finding stops
 * approval and export, and this is where a researcher sees why.
 */

const SECTION_AI_ACTIONS = [
  {
    id: "REPORT_DRAFT_SECTION" as const,
    label: "Draft section",
    description: "Draft this section from data this audience may see.",
  },
  {
    id: "REPORT_POLISH_SECTION" as const,
    label: "Polish",
    description: "Improve clarity without changing any claim.",
  },
  {
    id: "REPORT_CONSISTENCY_REVIEW" as const,
    label: "Consistency",
    description: "Compare the text against the canonical records.",
  },
  {
    id: "REPORT_LEAK_REVIEW" as const,
    label: "Leak review",
    description: "A second opinion on anything that should not be published.",
  },
];

export function ReportDetailRoute({
  reportId,
}: {
  reportId: string;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const user = useSession((state) => state.user);
  const canEdit = canWrite(user);

  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [proposals, setProposals] = useState<AiProposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);

  const report = useApiQuery<ReportDetail>(
    queryKeys.report(reportId),
    `/v1/reports/${reportId}`,
  );

  const lint = useApiQuery<LintResult>(
    queryKeys.reportLint(reportId),
    `/v1/reports/${reportId}/lint`,
  );

  const preview = useApiQuery<ReportPreview>(
    queryKeys.reportPreview(reportId),
    `/v1/reports/${reportId}/preview`,
    { enabled: showPreview },
  );

  const sections = useMemo(
    () => report.data?.sections ?? [],
    [report.data?.sections],
  );

  const activeSection = useMemo(
    () =>
      sections.find((section) => section.id === activeSectionId) ??
      sections[0] ??
      null,
    [sections, activeSectionId],
  );

  useEffect(() => {
    if (activeSection !== null) {
      setDraft(activeSection.contentMarkdown);
    }
  }, [activeSection?.id, activeSection?.revision]);

  const saveSection = useApiMutation<
    ReportDetail,
    { section: ReportSection; content: string; reviewState?: string }
  >(
    ({ section, content, reviewState }) => ({
      path: `/v1/reports/${reportId}/sections/${section.id}`,
      method: "PATCH",
      body: {
        contentMarkdown: content,
        ...(reviewState === undefined ? {} : { reviewState }),
        expectedRevision: section.revision,
      },
    }),
    () => [
      queryKeys.report(reportId),
      queryKeys.reportLint(reportId),
      queryKeys.reportPreview(reportId),
    ],
  );

  const approveSection = useApiMutation<ReportDetail, ReportSection>(
    (section) => ({
      path: `/v1/reports/${reportId}/sections/${section.id}`,
      method: "PATCH",
      body: { reviewState: "APPROVED", expectedRevision: section.revision },
    }),
    () => [queryKeys.report(reportId), queryKeys.reportLint(reportId)],
  );

  const approveReport = useApiMutation<ReportDetail>(
    () => ({
      path: `/v1/reports/${reportId}/approve`,
      method: "POST",
      body: { expectedRevision: report.data?.revision ?? 1 },
    }),
    () => [queryKeys.report(reportId), queryKeys.dashboard],
  );

  const exportReport = useApiMutation<ReportExport>(
    () => ({
      path: `/v1/reports/${reportId}/exports`,
      method: "POST",
      body: { format: "PDF" },
    }),
    () => [queryKeys.report(reportId), queryKeys.dashboard],
  );

  if (report.isLoading) {
    return <p className="p-4 text-[12px] text-text-muted">Loading…</p>;
  }

  if (report.error !== null || report.data === undefined) {
    return (
      <EmptyState
        title={errorHeading(report.error)}
        description={report.error?.message ?? "That report could not be loaded."}
      />
    );
  }

  const data = report.data;
  const blocking = lint.data?.findings.filter(
    (finding) => finding.severity === "BLOCKING",
  );
  const dirty =
    activeSection !== null && draft !== activeSection.contentMarkdown;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Mono className="text-text-muted">{data.ref}</Mono>
            <TlpBadge label={data.tlp} />
            <span className="rounded border border-border px-1 text-[10px] uppercase text-text-muted">
              {data.audience}
            </span>
            <span className="rounded border border-border px-1 text-[10px] uppercase text-text-muted">
              {data.status.replace("_", " ").toLowerCase()}
            </span>
          </div>
          <h1 className="mt-0.5 truncate text-[15px] font-semibold">
            {data.title}
          </h1>
          <p className="text-[11px] text-text-muted">
            {data.approvedSectionCount} of {data.sectionCount} sections approved
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowPreview((current) => !current)}
          >
            {showPreview ? "Hide preview" : "Show preview"}
          </Button>
          {canEdit ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={approveReport.isPending}
                onClick={() =>
                  approveReport.mutate(undefined, {
                    onError: (mutationError) => setError(mutationError.message),
                  })
                }
              >
                <Check aria-hidden className="size-3" />
                Approve report
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={exportReport.isPending}
                onClick={() =>
                  exportReport.mutate(undefined, {
                    onError: (mutationError) => setError(mutationError.message),
                  })
                }
              >
                <Download aria-hidden className="size-3" />
                Export PDF
              </Button>
            </>
          ) : null}
        </div>
      </header>

      {error === null ? null : (
        <div className="border-b border-danger/40 bg-danger/10 px-4 py-2 text-[12px] text-danger">
          {error}
        </div>
      )}

      {blocking === undefined || blocking.length === 0 ? null : (
        <div className="flex items-start gap-2 border-b border-danger/40 bg-danger/10 px-4 py-2 text-[12px] text-danger">
          <FileWarning aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <div>
            <p className="font-medium">
              {blocking.length} blocking issue
              {blocking.length === 1 ? "" : "s"} prevent approval and export.
            </p>
            <ul className="mt-0.5 list-disc pl-4">
              {blocking.slice(0, 4).map((finding, index) => (
                <li key={`${finding.ruleId}-${index}`}>
                  {finding.sectionTitle === null
                    ? ""
                    : `${finding.sectionTitle}: `}
                  {finding.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 overflow-y-auto border-r border-border p-2">
          <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-[0.09em] text-text-muted">
            Sections
          </p>
          {sections.map((section) => (
            <ReportSectionStatus
              key={section.id}
              title={section.title}
              state={section.reviewState}
              required={section.required}
              hasContent={section.contentMarkdown.trim().length > 0}
              active={activeSection?.id === section.id}
              onSelect={() => setActiveSectionId(section.id)}
            />
          ))}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {activeSection === null ? (
            <EmptyState title="This report has no sections" />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                <div className="min-w-0">
                  <h2 className="truncate text-[13px] font-medium">
                    {activeSection.title}
                  </h2>
                  {activeSection.promptPurpose === null ? null : (
                    <p className="truncate text-[11px] text-text-muted">
                      {activeSection.promptPurpose}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <ApprovalState
                    state={activeSection.reviewState}
                    approvedBy={activeSection.approvedBy?.displayName ?? null}
                    approvedAt={activeSection.approvedAt}
                  />
                  {canEdit ? (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!dirty || saveSection.isPending}
                        onClick={() =>
                          saveSection.mutate(
                            { section: activeSection, content: draft },
                            {
                              onError: (mutationError) =>
                                setError(mutationError.message),
                            },
                          )
                        }
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={dirty || approveSection.isPending}
                        title={
                          dirty
                            ? "Save your changes before approving."
                            : "Approve this section's current text."
                        }
                        onClick={() =>
                          approveSection.mutate(activeSection, {
                            onError: (mutationError) =>
                              setError(mutationError.message),
                          })
                        }
                      >
                        Approve section
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>

              {canEdit ? (
                <div className="border-b border-border px-3 py-2">
                  <AiToolbar
                    targetType="REPORT_SECTION"
                    targetId={activeSection.id}
                    actions={SECTION_AI_ACTIONS}
                    onCompleted={(run: AiRunWithProposals) => {
                      setProposals(run.proposals);
                      void queryClient.invalidateQueries({
                        queryKey: queryKeys.report(reportId),
                      });
                    }}
                  />
                </div>
              ) : null}

              {proposals.length === 0 ? null : (
                <div className="space-y-2 border-b border-border p-3">
                  {proposals.map((proposal) => (
                    <SectionProposal
                      key={proposal.id}
                      proposal={proposal}
                      section={activeSection}
                      reportId={reportId}
                      onResolved={() =>
                        setProposals((current) =>
                          current.filter((item) => item.id !== proposal.id),
                        )
                      }
                    />
                  ))}
                </div>
              )}

              <div className="flex min-h-0 flex-1">
                <div className="min-w-0 flex-1 overflow-hidden border-r border-border">
                  <MarkdownEditor
                    value={draft}
                    onChange={setDraft}
                    readOnly={!canEdit || activeSection.reviewState === "LOCKED"}
                    className="h-full"
                  />
                </div>

                {showPreview ? (
                  <div className="min-w-0 flex-1 overflow-y-auto">
                    <PreviewPane
                      html={preview.data?.html ?? null}
                      lint={lint.data ?? null}
                      sectionId={activeSection.id}
                    />
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewPane({
  html,
  lint,
  sectionId,
}: {
  html: string | null;
  lint: LintResult | null;
  sectionId: string;
}): React.JSX.Element {
  const sectionFindings =
    lint?.findings.filter((finding) => finding.sectionId === sectionId) ?? [];

  return (
    <div className="space-y-3 p-3">
      {sectionFindings.length === 0 ? null : (
        <Card className="border-warning/40">
          <CardHeader>
            <CardTitle>Lint · this section</CardTitle>
          </CardHeader>
          <ul className="divide-y divide-border">
            {sectionFindings.map((finding, index) => (
              <LintRow key={`${finding.ruleId}-${index}`} finding={finding} />
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
        </CardHeader>
        <CardBody>
          {html === null ? (
            <p className="text-[12px] text-text-muted">Rendering…</p>
          ) : (
            // The HTML comes from the server's sanitising pipeline, which drops
            // raw HTML at the Markdown AST and allow-lists the result. It is
            // the same renderer the exported PDF uses.
            <div
              className="cv-preview text-[13px]"
              dangerouslySetInnerHTML={{ __html: extractBody(html) }}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function LintRow({ finding }: { finding: LintFinding }): React.JSX.Element {
  const tone =
    finding.severity === "BLOCKING" || finding.severity === "ERROR"
      ? "text-danger"
      : finding.severity === "WARNING"
        ? "text-warning"
        : "text-text-muted";

  return (
    <li className="flex items-start gap-2 px-3 py-1.5 text-[12px]">
      <AlertTriangle aria-hidden className={`mt-0.5 size-3 shrink-0 ${tone}`} />
      <span className="min-w-0">
        <span className={`font-medium ${tone}`}>{finding.severity}</span>{" "}
        {finding.message}
        {finding.excerpt === null ? null : (
          <Mono className="mt-0.5 block truncate text-text-muted">
            {finding.line === null ? "" : `line ${finding.line}: `}
            {finding.excerpt}
          </Mono>
        )}
      </span>
    </li>
  );
}

function SectionProposal({
  proposal,
  section,
  reportId,
  onResolved,
}: {
  proposal: AiProposal;
  section: ReportSection;
  reportId: string;
  onResolved: () => void;
}): React.JSX.Element {
  const accept = useApiMutation<AiProposal>(
    () => ({
      path: `/v1/ai/proposals/${proposal.id}/accept`,
      method: "POST",
      body: { expectedRevision: section.revision },
    }),
    () => [queryKeys.report(reportId), queryKeys.reportPreview(reportId)],
  );

  const reject = useApiMutation<{ ok: true }>(
    () => ({
      path: `/v1/ai/proposals/${proposal.id}/reject`,
      method: "POST",
      body: {},
    }),
    () => [queryKeys.report(reportId)],
  );

  return (
    <AiProposalPanel
      proposal={proposal}
      currentValues={{ contentMarkdown: section.contentMarkdown }}
      busy={accept.isPending || reject.isPending}
      onAccept={() => accept.mutate(undefined, { onSuccess: onResolved })}
      onReject={() => reject.mutate(undefined, { onSuccess: onResolved })}
    />
  );
}

/**
 * Extracts the body of the rendered report document.
 *
 * The preview endpoint returns a complete printable document; the pane shows
 * only its content, without the cover page and running headers.
 */
function extractBody(html: string): string {
  const match = /<main>([\s\S]*)<\/main>/.exec(html);

  return match?.[1] ?? html;
}
