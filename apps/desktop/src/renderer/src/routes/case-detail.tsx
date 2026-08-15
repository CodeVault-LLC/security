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
import { DisclosurePanel } from "../features/disclosure/disclosure-panel.js";
import { EvidencePanel } from "../features/evidence/evidence-panel.js";
import { formatDistanceToNowStrict } from "../lib/dates.js";
import { humanise } from "../lib/format.js";
import {
  errorHeading,
  queryKeys,
  useApiMutation,
  useApiQuery,
} from "../lib/api.js";
import { canWrite, useSession } from "../lib/session.js";

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
    return <p className="p-4 text-[12px] text-text-muted">Loading…</p>;
  }

  if (detail.error !== null || detail.data === undefined) {
    return (
      <EmptyState
        title={errorHeading(detail.error)}
        description={detail.error?.message ?? "That case could not be loaded."}
      />
    );
  }

  const data = detail.data;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Mono className="text-text-muted">{data.ref}</Mono>
              <StateBadge kind="validation" state={data.status} />
              <span className="rounded border border-border px-1 text-[10px] uppercase text-text-muted">
                {humanise(data.profile)}
              </span>
              {data.restricted ? (
                <span className="rounded border border-danger/50 px-1 text-[10px] uppercase text-danger">
                  Restricted
                </span>
              ) : null}
            </div>
            <h1 className="mt-0.5 truncate text-[15px] font-semibold">
              {data.title}
            </h1>
            {data.summary === null ? null : (
              <p className="mt-0.5 max-w-3xl text-[12px] text-text-muted">
                {data.summary}
              </p>
            )}
          </div>

          {canEdit ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setCreateFindingOpen(true)}
            >
              <Plus aria-hidden className="size-3" />
              New finding
            </Button>
          ) : null}
        </div>
      </header>

      <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="findings">Findings</TabsTrigger>
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
              {readiness.data === undefined ? (
                <CardBody className="text-[12px] text-text-muted">
                  Loading…
                </CardBody>
              ) : readiness.data.requirements.length === 0 ? (
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
                <span className="text-[11px] text-text-muted">
                  owner {data.owner.displayName}
                </span>
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
                      <span className="min-w-0 flex-1 truncate">
                        {member.user.displayName}
                      </span>
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
          <FindingsTable findings={findings.data?.items ?? []} />
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
          <ReportsPanel
            caseId={caseId}
            reports={reports.data?.items ?? []}
            canEdit={canEdit}
          />
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
}: {
  findings: readonly FindingSummary[];
}): React.JSX.Element {
  if (findings.length === 0) {
    return (
      <EmptyState
        title="No findings in this case yet"
        description="Record one as soon as you have something reproducible; the detail comes later."
      />
    );
  }

  return (
    <ul className="divide-y divide-border">
      {findings.map((finding) => (
        <li key={finding.id}>
          <Link
            to={`/findings/${finding.id}`}
            className="flex items-center gap-2 px-4 py-2 text-[12px] hover:bg-surface-hover"
          >
            <Mono className="w-32 shrink-0 text-text-muted">{finding.ref}</Mono>
            <span className="min-w-0 flex-1 truncate">{finding.title}</span>
            <SeverityBadge severity={finding.severity} score={finding.score} />
            <StateBadge kind="validation" state={finding.validationState} />
            <PriorArtBadge state={finding.priorArtState} />
            <span className="w-16 shrink-0 text-right text-text-muted">
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

  const create = useApiMutation<ReportSummary, "INTERNAL" | "VENDOR" | "PUBLIC">(
    (audience) => ({
      path: "/v1/reports",
      method: "POST",
      body: { caseId, audience },
    }),
    () => [queryKeys.reports(caseId)],
  );

  const audiences = ["INTERNAL", "VENDOR", "PUBLIC"] as const;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {audiences.map((audience) => {
          const report = reports.find((item) => item.audience === audience);

          return (
            <Card key={audience}>
              <CardHeader>
                <CardTitle>{audience}</CardTitle>
                {report === undefined ? null : <TlpBadge label={report.tlp} />}
              </CardHeader>
              <CardBody className="space-y-2 text-[12px]">
                {report === undefined ? (
                  <>
                    <p className="text-text-muted">
                      Not created. Each report is a projection of this case for
                      one audience, and sees only the data that audience may see.
                    </p>
                    {canEdit ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={create.isPending}
                        onClick={() =>
                          create.mutate(audience, {
                            onError: (mutationError) =>
                              setError(mutationError.message),
                          })
                        }
                      >
                        Create {audience.toLowerCase()} report
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <Mono className="text-text-muted">{report.ref}</Mono>
                      <span className="rounded border border-border px-1 text-[10px] uppercase text-text-muted">
                        {report.status.replace("_", " ").toLowerCase()}
                      </span>
                    </div>
                    <p className="text-text-muted">
                      {report.approvedSectionCount} of {report.sectionCount}{" "}
                      sections approved
                    </p>
                    <Link
                      to={`/reports/${report.id}`}
                      className="inline-block text-accent hover:underline"
                    >
                      Open report
                    </Link>
                  </>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>

      {error === null ? null : (
        <p className="text-[12px] text-danger">{error}</p>
      )}
    </div>
  );
}
