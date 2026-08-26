import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Download,
  Eye,
  FileWarning,
  Maximize2,
  MoreHorizontal,
  PanelLeft,
  Pilcrow,
  Sparkles,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

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
import { allowedTlpForAudience, type TlpLabel } from "@codevault/standards";
import {
  AiProposalPanel,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogTrigger,
  EmptyState,
  ErrorState,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  LoadingState,
  Mono,
  ReportSectionStatus,
  Select,
} from "@codevault/ui";

import { AiToolbar } from "../features/ai/ai-toolbar.js";
import { ResizablePanels } from "../components/resizable-panels.js";
import type { Command } from "../features/markdown/commands.js";
import { InsertMenu } from "../features/markdown/insert-menu.js";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "../features/markdown/markdown-editor.js";
import { MarkdownToolbar } from "../features/markdown/markdown-toolbar.js";
import { RenderedMarkdown } from "../features/markdown/markdown-preview.js";
import {
  errorHeading,
  queryKeys,
  useApiMutation,
  useApiQuery,
} from "../lib/api.js";
import { QueryError } from "../components/query-boundary.js";
import { bridge } from "../lib/bridge.js";
import { canWrite, useSession } from "../lib/session.js";

/**
 * The report workspace.
 *
 * The Markdown buffer is the default surface. Sections, rendering, report
 * state, exports, formatting, and AI assistance are disclosed only when the
 * researcher asks for them. Blocking lint remains visible because it changes
 * what the researcher can do: approval and export stop until it is resolved.
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
  const [proposals, setProposals] = useState<AiProposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showSections, setShowSections] = useState(false);
  const [showExports, setShowExports] = useState(false);

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

  const updateTlp = useApiMutation<ReportDetail, TlpLabel>(
    (tlp) => ({
      path: `/v1/reports/${reportId}`,
      method: "PATCH",
      body: { tlp, expectedRevision: report.data?.revision ?? 1 },
    }),
    (updated) => [
      queryKeys.report(reportId),
      queryKeys.reportLint(reportId),
      queryKeys.reportPreview(reportId),
      queryKeys.reports(updated.caseId),
    ],
  );

  const exportReport = useApiMutation<ReportExport>(
    () => ({
      path: `/v1/reports/${reportId}/exports`,
      method: "POST",
      body: { format: "PDF" },
    }),
    () => [
      queryKeys.report(reportId),
      queryKeys.reportExports(reportId),
      queryKeys.dashboard,
    ],
  );

  const exports = useApiQuery<{ items: ReportExport[] }>(
    queryKeys.reportExports(reportId),
    `/v1/reports/${reportId}/exports`,
    {
      // Rendering runs in the worker, so the list is polled while anything is
      // still in flight and left alone once every export has settled.
      refetchInterval: (query) =>
        (query.state.data?.items ?? []).some(
          (item) => item.status === "QUEUED" || item.status === "RUNNING",
        )
          ? 2_000
          : false,
    },
  );

  if (report.isLoading) {
    return <LoadingState label="Loading report…" />;
  }

  if (report.error !== null || report.data === undefined) {
    return (
      <ErrorState
        title={errorHeading(report.error)}
        description={
          report.error?.message ?? "That report could not be loaded."
        }
        action={
          <Button
            variant="secondary"
            size="sm"
            loading={report.isFetching}
            onClick={() => void report.refetch()}
          >
            Try again
          </Button>
        }
      />
    );
  }

  const data = report.data;
  const blocking = lint.data?.findings.filter(
    (finding) => finding.severity === "BLOCKING",
  );
  const reportBlocked =
    lint.isLoading || lint.error !== null || (blocking?.length ?? 0) > 0;
  const requiredApprovalCount = sections.filter(
    (section) =>
      section.required &&
      section.reviewState !== "APPROVED" &&
      section.reviewState !== "LOCKED",
  ).length;
  const actionBlockReason = lint.isLoading
    ? "Checking the report for blockers."
    : lint.error !== null
      ? "Reload the report checks before approval or export."
      : (blocking?.length ?? 0) > 0
        ? `Resolve ${blocking?.length ?? 0} blocking issue${blocking?.length === 1 ? "" : "s"} first.`
        : null;
  const hasUnsettledExport = (exports.data?.items ?? []).some(
    (item) => item.status !== "COMPLETED",
  );
  const sectionNavigation = (
    <aside className="h-full overflow-y-auto bg-surface px-2 py-3">
      <p className="px-2 pb-2 text-[10px] font-medium uppercase tracking-[0.09em] text-text-muted">
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
  );
  const editorWorkspace = (
    <div className="flex h-full min-w-0 flex-col">
      {activeSection === null ? null : (
        <div className="border-b border-border p-2 md:hidden">
          <Select
            aria-label="Report section"
            value={activeSection.id}
            onValueChange={setActiveSectionId}
            options={sections.map((section) => ({
              value: section.id,
              label: `${section.title}${section.required ? " · required" : ""}`,
            }))}
          />
        </div>
      )}
      {activeSection === null ? (
        <EmptyState title="This report has no sections" />
      ) : (
        <SectionWorkspace
          // Keyed by section and revision so the draft starts from the stored
          // text whenever either changes, including after accepting AI text.
          key={`${activeSection.id}:${activeSection.revision}`}
          reportId={reportId}
          caseId={data.caseId}
          reportTitle={data.title}
          reportReference={data.ref}
          audience={data.audience}
          section={activeSection}
          canEdit={canEdit}
          showPreview={showPreview}
          previewHtml={preview.data?.html ?? null}
          lint={lint.data ?? null}
          proposals={proposals}
          onProposals={setProposals}
          onError={setError}
          onSave={(content) =>
            saveSection.mutate(
              { section: activeSection, content },
              {
                onError: (mutationError) => setError(mutationError.message),
              },
            )
          }
          saving={saveSection.isPending}
          onApprove={() =>
            approveSection.mutate(activeSection, {
              onError: (mutationError) => setError(mutationError.message),
            })
          }
          approving={approveSection.isPending}
          onAiCompleted={(run: AiRunWithProposals) => {
            setProposals(run.proposals);
            void queryClient.invalidateQueries({
              queryKey: queryKeys.report(reportId),
            });
          }}
        />
      )}
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex min-h-16 items-center gap-3 border-b border-border px-3 sm:px-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold leading-5">
            {data.title}
          </h1>
          <Mono className="text-[10.5px] text-text-muted">{data.ref}</Mono>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={showSections}
            className={`hidden md:inline-flex ${showSections ? "bg-surface-hover text-text" : ""}`}
            onClick={() => setShowSections((current) => !current)}
          >
            <PanelLeft aria-hidden className="size-3.5" />
            Sections
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={showPreview}
            className={showPreview ? "bg-surface-hover text-text" : ""}
            onClick={() => setShowPreview((current) => !current)}
          >
            <Eye aria-hidden className="size-3.5" />
            Preview
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Report details">
                <MoreHorizontal aria-hidden className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Report details</DropdownMenuLabel>
              <div className="space-y-1 px-2 pb-2 text-[11px] text-text-muted">
                <p>
                  {data.tlp} · {data.audience.toLowerCase()} ·{" "}
                  {titleCase(data.status)}
                </p>
                <p>
                  {data.approvedSectionCount} of {data.sectionCount} sections
                  approved
                </p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setShowExports((current) => !current)}
              >
                <Download aria-hidden className="size-4" />
                {showExports ? "Hide exports" : "Show exports"}
              </DropdownMenuItem>
              {canEdit ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger disabled={updateTlp.isPending}>
                      TLP marking · {data.tlp}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuLabel>
                        Who may receive this report?
                      </DropdownMenuLabel>
                      <DropdownMenuRadioGroup value={data.tlp}>
                        {allowedTlpForAudience(data.audience).map((label) => (
                          <DropdownMenuRadioItem
                            key={label}
                            value={label}
                            onClick={() => {
                              if (label !== data.tlp) {
                                updateTlp.mutate(label, {
                                  onError: (mutationError) =>
                                    setError(mutationError.message),
                                });
                              }
                            }}
                          >
                            {label}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem
                    disabled={
                      reportBlocked ||
                      requiredApprovalCount > 0 ||
                      approveReport.isPending
                    }
                    title={
                      actionBlockReason ??
                      (requiredApprovalCount > 0
                        ? `Approve ${requiredApprovalCount} required section${requiredApprovalCount === 1 ? "" : "s"} first.`
                        : "Approve the report.")
                    }
                    onSelect={() =>
                      approveReport.mutate(undefined, {
                        onError: (mutationError) =>
                          setError(mutationError.message),
                      })
                    }
                  >
                    <Check aria-hidden className="size-4" />
                    Approve report
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={reportBlocked || exportReport.isPending}
                    title={actionBlockReason ?? "Export this report as PDF."}
                    onSelect={() =>
                      exportReport.mutate(undefined, {
                        onError: (mutationError) =>
                          setError(mutationError.message),
                      })
                    }
                  >
                    <Download aria-hidden className="size-4" />
                    Export PDF
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
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
              {blocking.length === 1 ? " prevents" : "s prevent"} approval and
              export.
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

      <QueryError query={lint} className="mx-4 mt-3" />
      <QueryError query={exports} className="mx-4 mt-3" />
      <QueryError query={preview} className="mx-4 mt-3" />

      {showExports || hasUnsettledExport ? (
        <ReportExportStrip
          items={exports.data?.items ?? []}
          onError={setError}
        />
      ) : null}

      <main className="min-h-0 flex-1">
        {showSections ? (
          <ResizablePanels
            primary={sectionNavigation}
            secondary={editorWorkspace}
            primaryLabel="Report sections"
            secondaryLabel="Report section editor"
            resizeLabel="Resize report sections"
            storageKey="report-sections-split"
            initialPrimarySize={0.2}
            minPrimarySize={188}
            maxPrimarySize={340}
            minSecondarySize={520}
            className="cv-report-sections-layout h-full"
          />
        ) : (
          editorWorkspace
        )}
      </main>
    </div>
  );
}

/**
 * The exports of this report, most recent first.
 *
 * An export is rendered by the worker, so the button that starts one cannot
 * hand back a file. This is where it arrives: the status while it runs, the
 * reason if it failed, and the digest of what was produced — which is the thing
 * a researcher quotes when someone asks whether a PDF in circulation is theirs.
 */
function ReportExportStrip({
  items,
  onError,
}: {
  items: readonly ReportExport[];
  onError: (message: string | null) => void;
}): React.JSX.Element | null {
  if (items.length === 0) {
    return null;
  }

  const download = (artifactId: string): void => {
    void bridge()
      .reports.downloadPdf(artifactId)
      .then((outcome) => {
        if (!outcome.ok) onError(outcome.message);
      });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-raised px-4 py-1.5 text-[11px]">
      <span className="text-text-muted">Exports</span>
      {items.slice(0, 4).map((item) => (
        <span
          key={item.id}
          className="flex items-center gap-1.5 rounded border border-border bg-surface px-1.5 py-0.5"
        >
          <span className="font-medium">{item.format}</span>
          <span className="text-text-muted">{titleCase(item.status)}</span>

          {item.status === "COMPLETED" && item.artifactId !== null ? (
            <>
              {item.sha256 === null ? null : (
                <Mono className="text-text-muted">
                  {item.sha256.slice(0, 12)}
                </Mono>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => download(item.artifactId as string)}
              >
                <Download aria-hidden className="size-3" />
                Download
              </Button>
            </>
          ) : null}

          {item.status === "FAILED" ? (
            <span className="text-danger">
              {item.failureReason ?? "Rendering failed."}
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

/** `COMPLETED` reads as shouting in a status chip; `Completed` does not. */
function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

interface SectionWorkspaceProps {
  reportId: string;
  caseId: string;
  reportTitle: string;
  reportReference: string;
  audience: string;
  section: ReportSection;
  canEdit: boolean;
  showPreview: boolean;
  previewHtml: string | null;
  lint: LintResult | null;
  proposals: AiProposal[];
  onProposals: (update: (current: AiProposal[]) => AiProposal[]) => void;
  onError: (message: string | null) => void;
  onSave: (content: string) => void;
  saving: boolean;
  onApprove: () => void;
  approving: boolean;
  onAiCompleted: (run: AiRunWithProposals) => void;
}

/**
 * One section: its header, its AI actions, its editor and its preview.
 *
 * The draft lives here rather than in the route so that editing one section
 * does not re-render the section tree, the lint panel and the preview on every
 * keystroke.
 */
function SectionWorkspace({
  reportId,
  caseId,
  reportTitle,
  reportReference,
  audience,
  section,
  canEdit,
  showPreview,
  previewHtml,
  lint,
  proposals,
  onProposals,
  onError,
  onSave,
  saving,
  onApprove,
  approving,
  onAiCompleted,
}: SectionWorkspaceProps): React.JSX.Element {
  const [draft, setDraft] = useState(section.contentMarkdown);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAssist, setShowAssist] = useState(false);
  const [showFormatting, setShowFormatting] = useState(false);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const dirty = draft !== section.contentMarkdown;
  const locked = !canEdit || section.reviewState === "LOCKED";
  const editorPane = (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-surface">
      {locked || !showFormatting ? null : (
        <MarkdownToolbar
          onCommand={(command: Command) => editorRef.current?.run(command)}
          onInsertMenu={() => setMenuOpen(true)}
        />
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        <MarkdownEditor
          ref={editorRef}
          ariaLabel={`${section.title} report section`}
          value={draft}
          onChange={(next) => {
            onError(null);
            setDraft(next);
          }}
          readOnly={locked}
          showLineNumbers
          placeholder="Markdown. Press / to insert a table, a diagram or a reference to this case's evidence."
          onSlash={() => setMenuOpen(true)}
          className="h-full"
        />
      </div>
    </div>
  );
  const previewPane = (
    <div className="flex h-full min-w-0 overflow-y-auto">
      <PreviewPane
        html={previewHtml}
        lint={lint}
        sectionId={section.id}
        reportTitle={reportTitle}
        reportReference={reportReference}
        audience={audience}
      />
    </div>
  );

  return (
    <>
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 sm:px-4">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-[14px] font-medium">
              {section.title}
            </h2>
            {dirty ? (
              <span className="shrink-0 text-[10.5px] text-text-muted">
                Edited
              </span>
            ) : null}
          </div>
          {section.promptPurpose === null ? null : (
            <p className="truncate text-[11px] text-text-muted">
              {section.promptPurpose}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1">
          {canEdit ? (
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={showFormatting}
              className={showFormatting ? "bg-surface-hover text-text" : ""}
              onClick={() => setShowFormatting((current) => !current)}
            >
              <Pilcrow aria-hidden className="size-3.5" />
              Format
            </Button>
          ) : null}
          {canEdit ? (
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={showAssist}
              className={showAssist ? "bg-surface-hover text-text" : ""}
              onClick={() => setShowAssist((current) => !current)}
            >
              <Sparkles aria-hidden className="size-3.5" />
              Assist
            </Button>
          ) : null}
          {canEdit ? (
            <Button
              size="sm"
              variant={dirty ? "primary" : "ghost"}
              disabled={!dirty || saving}
              loading={saving}
              onClick={() => onSave(draft)}
            >
              Save
            </Button>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Section review">
                <MoreHorizontal aria-hidden className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel>Section review</DropdownMenuLabel>
              <div className="space-y-1 px-2 pb-2 text-[11px] text-text-muted">
                <p>{titleCase(section.reviewState)}</p>
                {section.approvedBy === null ? null : (
                  <p>Approved by {section.approvedBy.displayName}</p>
                )}
                {section.approvedAt === null ? null : (
                  <p>{new Date(section.approvedAt).toLocaleString()}</p>
                )}
              </div>
              {canEdit ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={dirty || approving}
                    title={
                      dirty
                        ? "Save your changes before approving."
                        : "Approve this section's current text."
                    }
                    onSelect={onApprove}
                  >
                    <Check aria-hidden className="size-4" />
                    Approve section
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {canEdit && showAssist ? (
        <AiToolbar
          targetType="REPORT_SECTION"
          targetId={section.id}
          actions={SECTION_AI_ACTIONS}
          onCompleted={onAiCompleted}
          className="border-b border-border px-3 py-2"
        />
      ) : null}

      {proposals.length === 0 ? null : (
        <div className="space-y-2 border-b border-border p-3">
          {proposals.map((proposal) => (
            <SectionProposal
              key={proposal.id}
              proposal={proposal}
              section={section}
              reportId={reportId}
              onResolved={() =>
                onProposals((current) =>
                  current.filter((item) => item.id !== proposal.id),
                )
              }
            />
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {showPreview ? (
          <ResizablePanels
            primary={editorPane}
            secondary={previewPane}
            primaryLabel="Markdown editor"
            secondaryLabel="Report preview"
            resizeLabel="Resize editor and preview"
            storageKey="report-editor-preview-split"
            initialPrimarySize={0.64}
            minPrimarySize={420}
            minSecondarySize={340}
            className="cv-report-preview-layout h-full"
          />
        ) : (
          editorPane
        )}
      </div>

      <InsertMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        caseId={caseId}
        onInsert={(snippet) => {
          editorRef.current?.dropSlash();
          editorRef.current?.insert(snippet);
        }}
      />
    </>
  );
}

function PreviewPane({
  html,
  lint,
  sectionId,
  reportTitle,
  reportReference,
  audience,
}: {
  html: string | null;
  lint: LintResult | null;
  sectionId: string;
  reportTitle: string;
  reportReference: string;
  audience: string;
}): React.JSX.Element {
  const sectionFindings =
    lint?.findings.filter((finding) => finding.sectionId === sectionId) ?? [];
  const renderedBody = html === null ? null : extractBody(html);

  return (
    <div className="flex min-h-full w-full flex-col bg-background">
      <div className="sticky top-0 z-10 flex min-h-11 items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2">
        <div className="min-w-0">
          <p className="text-[12px] font-medium">Report preview</p>
          <p className="truncate text-[10px] text-text-muted">
            Saved report · {reportReference}
          </p>
        </div>

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" disabled={renderedBody === null}>
              <Maximize2 aria-hidden className="size-3.5" />
              Full screen
            </Button>
          </DialogTrigger>
          <DialogContent
            title={`${reportTitle} preview`}
            description={`${reportReference} · ${audience.toLowerCase()} report · saved content`}
            width="max-w-none"
            className="cv-report-preview-dialog"
          >
            <DialogBody className="cv-report-preview-dialog-body">
              <div className="cv-report-preview-page">
                {renderedBody === null ? null : (
                  <RenderedMarkdown html={renderedBody} />
                )}
              </div>
            </DialogBody>
          </DialogContent>
        </Dialog>
      </div>

      {sectionFindings.length === 0 ? null : (
        <section
          aria-label="Issues in this section"
          className="mx-4 mt-3 overflow-hidden rounded-(--cv-radius-lg) border border-warning/40 bg-warning/6"
        >
          <div className="flex items-center gap-2 border-b border-warning/25 px-3 py-2">
            <AlertTriangle
              aria-hidden
              className="size-3.5 shrink-0 text-warning"
            />
            <p className="text-[11px] font-medium">
              {sectionFindings.length} issue
              {sectionFindings.length === 1 ? "" : "s"} in this section
            </p>
          </div>
          <ul className="divide-y divide-border">
            {sectionFindings.map((finding, index) => (
              <LintRow key={`${finding.ruleId}-${index}`} finding={finding} />
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-1 p-3 sm:p-4">
        <div className="min-h-full w-full overflow-hidden rounded-(--cv-radius-lg) border border-border bg-surface">
          {renderedBody === null ? (
            <p
              aria-live="polite"
              className="cv-preview-state cv-preview-state--document"
            >
              Rendering saved report…
            </p>
          ) : (
            // Server-rendered, because only the server can resolve a directive
            // against the database and apply this audience's visibility rules.
            // Diagrams are drawn here, by the code the PDF worker also runs.
            <RenderedMarkdown html={renderedBody} />
          )}
        </div>
      </div>
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
