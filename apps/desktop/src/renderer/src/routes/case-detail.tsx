import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";

import type {
  CaseDetail,
  CaseReadiness,
  FindingSummary,
  ReportSummary,
} from "@codevault/contracts";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  LoadingState,
  Mono,
  PriorArtBadge,
  SeverityBadge,
  StateBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TlpBadge,
} from "@codevault/ui";

import { CreateFindingDialog } from "../features/findings/create-finding-dialog.js";
import { ExportCaseArchiveButton } from "../features/cases/case-archive-actions.js";
import { Avatar } from "../components/avatar.js";
import { DisclosurePanel } from "../features/disclosure/disclosure-panel.js";
import { EvidencePanel } from "../features/evidence/evidence-panel.js";
import { IntakePanel } from "../features/intake/intake-panel.js";
import { formatDistanceToNowStrict } from "../lib/dates.js";
import { humanise } from "../lib/format.js";
import {
  errorHeading,
  queryKeys,
  useApiMutation,
  useApiQuery,
} from "../lib/api.js";
import { canWrite, useSession } from "../lib/session.js";
import { QueryError } from "../components/query-boundary.js";

/**
 * The case workspace.
 *
 * The Disclosure tab appears only when the case profile implies coordination or
 * the researcher has turned it on. A standard case — someone looking at a
 * plugin on a Saturday — is not asked about embargo dates it will never have.
 */

interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export function CaseDetailRoute({
  caseId,
}: {
  caseId: string;
}): React.JSX.Element {
  const user = useSession((state) => state.user);
  const canEdit = canWrite(user);
  const [createFindingOpen, setCreateFindingOpen] = useState(false);

  const detail = useApiQuery<CaseDetail>(
    queryKeys.case(caseId),
    `/v1/cases/${caseId}`,
  );

  const findings = useApiQuery<Paginated<FindingSummary>>(
    queryKeys.findings({ caseId }),
    `/v1/findings?caseId=${caseId}&limit=200`,
  );

  const reports = useApiQuery<{ items: ReportSummary[] }>(
    queryKeys.reports(caseId),
    `/v1/reports?caseId=${caseId}`,
  );

  const readiness = useApiQuery<CaseReadiness>(
    queryKeys.caseReadiness(caseId),
    `/v1/cases/${caseId}/readiness`,
  );

  if (detail.isLoading) {
    return <LoadingState label="Loading case…" />;
  }

  if (detail.error !== null || detail.data === undefined) {
    return (
      <ErrorState
        title={errorHeading(detail.error)}
        description={detail.error?.message ?? "That case could not be loaded."}
        action={
          <Button
            variant="secondary"
            size="sm"
            loading={detail.isFetching}
            onClick={() => void detail.refetch()}
          >
            Try again
          </Button>
        }
      />
    );
  }

  const data = detail.data;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-4 py-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between xl:gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Mono className="text-text-muted">{data.ref}</Mono>
              <StateBadge kind="validation" state={data.status} />
              <span className="text-[11px] text-text-muted">
                {humanise(data.profile)}
              </span>
              {data.restricted ? (
                <span className="text-[11px] text-danger">Restricted</span>
              ) : null}
              {canEdit ? null : (
                <span className="text-[11px] text-text-muted">Read only</span>
              )}
            </div>
            <h1 className="mt-1 text-[18px] font-semibold leading-tight tracking-[-0.015em] text-balance">
              {data.title}
            </h1>
            {data.summary === null ? null : (
              <p className="mt-0.5 max-w-3xl text-[12px] text-text-muted">
                {data.summary}
              </p>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-start gap-2 self-start">
            <ExportCaseArchiveButton caseId={caseId} />
            {canEdit ? (
              <Button
                size="sm"
                variant="primary"
                onClick={() => setCreateFindingOpen(true)}
              >
                <Plus aria-hidden className="size-3" />
                New finding
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="findings">Findings</TabsTrigger>
          <TabsTrigger value="intake">Intake</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          {data.disclosureEnabled ? (
            <TabsTrigger value="disclosure">Disclosure</TabsTrigger>
          ) : null}
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="p-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Readiness</CardTitle>
                {readiness.data === undefined ? null : (
                  <span
                    className={
                      readiness.data.satisfied
                        ? "text-[11px] text-success"
                        : "text-[11px] text-warning"
                    }
                  >
                    {readiness.data.satisfied
                      ? "All requirements met"
                      : "Requirements outstanding"}
                  </span>
                )}
              </CardHeader>
              {readiness.error !== null ? (
                <QueryError query={readiness} className="m-3" />
              ) : readiness.isLoading ? (
                <LoadingState />
              ) : readiness.data === undefined ? null : readiness.data
                  .requirements.length === 0 ? (
                <CardBody className="text-[12px] text-text-muted">
                  This case's policy pack imposes no publication requirements.
                </CardBody>
              ) : (
                <ul className="divide-y divide-border">
                  {readiness.data.requirements.map((requirement) => (
                    <li
                      key={requirement.id}
                      className="flex items-start gap-2 px-3 py-1.5 text-[12px]"
                    >
                      <span
                        aria-hidden
                        className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                          requirement.satisfied ? "bg-success" : "bg-warning"
                        }`}
                      />
                      <span className="min-w-0">
                        <span className="block">{requirement.description}</span>
                        {requirement.detail === null ? null : (
                          <span className="block text-text-muted">
                            {requirement.detail}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Members</CardTitle>
                <div className="flex items-center gap-1 text-[11px] text-text-muted">
                  owner
                  <Avatar
                    avatarId={null}
                    userId={data.owner.id}
                    label={data.owner.displayName}
                    size="sm"
                    showLabel
                    className="gap-1"
                  />
                </div>
              </CardHeader>
              {data.members.length === 0 ? (
                <CardBody className="text-[12px] text-text-muted">
                  {data.restricted
                    ? "Only the owner can see this case. Add members to share it."
                    : "No explicit members. Everyone with an account can read this case."}
                </CardBody>
              ) : (
                <ul className="divide-y divide-border">
                  {data.members.map((member) => (
                    <li
                      key={member.user.id}
                      className="flex items-center gap-2 px-3 py-1.5 text-[12px]"
                    >
                      <Avatar
                        avatarId={null}
                        userId={member.user.id}
                        label={member.user.displayName}
                        size="sm"
                        showLabel
                        className="min-w-0 flex-1 gap-1.5"
                      />
                      <span className="text-[10px] uppercase text-text-muted">
                        {member.access.toLowerCase()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="findings">
          {findings.error !== null ? (
            <QueryError query={findings} className="m-4" />
          ) : findings.isLoading ? (
            <LoadingState label="Loading case findings…" />
          ) : (
            <FindingsTable
              findings={findings.data?.items ?? []}
              canEdit={canEdit}
              onCreate={() => setCreateFindingOpen(true)}
            />
          )}
        </TabsContent>

        <TabsContent value="intake">
          <IntakePanel
            caseId={caseId}
            canEdit={canEdit}
            findings={findings.data?.items ?? []}
          />
        </TabsContent>

        <TabsContent value="evidence">
          <EvidencePanel caseId={caseId} canEdit={canEdit} />
        </TabsContent>

        {data.disclosureEnabled ? (
          <TabsContent value="disclosure">
            <DisclosurePanel caseId={caseId} canEdit={canEdit} />
          </TabsContent>
        ) : null}

        <TabsContent value="reports" className="p-4">
          {reports.error !== null ? (
            <QueryError query={reports} />
          ) : reports.isLoading ? (
            <LoadingState label="Loading case reports…" />
          ) : (
            <ReportsPanel
              caseId={caseId}
              reports={reports.data?.items ?? []}
              canEdit={canEdit}
            />
          )}
        </TabsContent>
      </Tabs>

      <CreateFindingDialog
        open={createFindingOpen}
        onOpenChange={setCreateFindingOpen}
        caseId={caseId}
      />
    </div>
  );
}

function FindingsTable({
  findings,
  canEdit,
  onCreate,
}: {
  findings: readonly FindingSummary[];
  canEdit: boolean;
  onCreate: () => void;
}): React.JSX.Element {
  if (findings.length === 0) {
    return (
      <EmptyState
        title="No findings in this case yet"
        description="Record one as soon as you have something reproducible; the detail comes later."
        action={
          canEdit ? (
            <Button variant="primary" onClick={onCreate}>
              <Plus aria-hidden className="size-3.5" />
              New finding
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <ul className="divide-y divide-border">
      {findings.map((finding) => (
        <li key={finding.id}>
          <Link
            to={`/findings/${finding.id}`}
            className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2 text-[12px] hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus lg:grid-cols-[8rem_minmax(12rem,1fr)_auto_auto_auto_6rem]"
          >
            <Mono className="text-text-muted max-lg:row-start-2">
              {finding.ref}
            </Mono>
            <span className="min-w-0 truncate font-medium max-lg:col-span-2 max-lg:row-start-1">
              {finding.title}
            </span>
            <SeverityBadge severity={finding.severity} score={finding.score} />
            <StateBadge kind="validation" state={finding.validationState} />
            <PriorArtBadge state={finding.priorArtState} />
            <span className="shrink-0 text-right text-text-muted">
              {formatDistanceToNowStrict(finding.updatedAt)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ReportsPanel({
  caseId,
  reports,
  canEdit,
}: {
  caseId: string;
  reports: readonly ReportSummary[];
  canEdit: boolean;
}): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);

  const create = useApiMutation<
    ReportSummary,
    "INTERNAL" | "VENDOR" | "PUBLIC"
  >(
    (audience) => ({
      path: "/v1/reports",
      method: "POST",
      body: { caseId, audience },
    }),
    () => [queryKeys.reports(caseId), queryKeys.reports()],
  );

  const audiences = ["INTERNAL", "VENDOR", "PUBLIC"] as const;

  return (
    <div className="space-y-3">
      <div className="divide-y divide-border rounded-(--cv-radius-lg) border border-border">
        {audiences.map((audience) => {
          const report = reports.find((item) => item.audience === audience);

          return (
            <section
              key={audience}
              className="grid min-h-16 grid-cols-1 gap-2 px-3.5 py-2.5 text-[12px] lg:grid-cols-[8.5rem_minmax(0,1fr)_auto] lg:items-center"
            >
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="font-semibold">{humanise(audience)}</h2>
                {report === undefined ? null : <TlpBadge label={report.tlp} />}
              </div>
              <div className="min-w-0">
                {report === undefined ? (
                  <p className="max-w-3xl text-pretty text-text-muted">
                    Not created. Each report is a projection of this case for
                    one audience, and sees only the data that audience may see.
                  </p>
                ) : (
                  <>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Mono className="text-text-muted">{report.ref}</Mono>
                      <StateBadge kind="review" state={report.status} />
                    </div>
                    <p className="mt-1 text-[11px] tabular-nums text-text-muted">
                      {report.approvedSectionCount} of {report.sectionCount}{" "}
                      sections approved
                    </p>
                  </>
                )}
              </div>
              <div className="flex justify-start lg:justify-end">
                {report === undefined ? (
                  canEdit ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={create.isPending}
                      onClick={() =>
                        create.mutate(audience, {
                          onError: (mutationError) =>
                            setError(mutationError.message),
                        })
                      }
                    >
                      Create {audience.toLowerCase()} report
                    </Button>
                  ) : null
                ) : (
                  <Button asChild size="sm" variant="secondary">
                    <Link to={`/reports/${report.id}`}>Open report</Link>
                  </Button>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {error === null ? null : (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
