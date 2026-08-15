import { Link } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState } from "react";

import type {
  AiProviderPolicy,
  AiProviderStatus,
  AuditEvent,
  CaseSummary,
  Invite,
  ReportSummary,
  UserSummary,
} from "@codevault/contracts";
import { CONTENT_VISIBILITIES } from "@codevault/core";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Mono,
  Select,
  TlpBadge,
} from "@codevault/ui";

import { PageBody, PageHeader } from "../components/app-shell.js";
import { bridge } from "../lib/bridge.js";
import { formatDateTime } from "../lib/dates.js";
import { humanise } from "../lib/format.js";
import { useTheme } from "../hooks/use-theme.js";
import { queryKeys, useApiMutation, useApiQuery } from "../lib/api.js";
import { isAdmin, useSession } from "../lib/session.js";

/**
 * Reports index, activity log and settings.
 *
 * Grouped in one module because each is a single screen with no sub-navigation,
 * and splitting them would be three files of imports around forty lines of UI.
 */

interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

/** Reports across every case the researcher can read. */
export function ReportsRoute(): React.JSX.Element {
  const cases = useApiQuery<Paginated<CaseSummary>>(
    queryKeys.cases(),
    "/v1/cases?limit=100",
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Reports"
        description="Internal, vendor and public projections of each case."
      />

      <PageBody className="space-y-3">
        {(cases.data?.items ?? []).map((item) => (
          <CaseReports key={item.id} caseSummary={item} />
        ))}

        {cases.data?.items.length === 0 ? (
          <EmptyState
            title="No cases yet"
            description="Reports are created from a case, once there is something to report."
          />
        ) : null}
      </PageBody>
    </div>
  );
}

function CaseReports({
  caseSummary,
}: {
  caseSummary: CaseSummary;
}): React.JSX.Element {
  const reports = useApiQuery<{ items: ReportSummary[] }>(
    queryKeys.reports(caseSummary.id),
    `/v1/reports?caseId=${caseSummary.id}`,
  );

  const items = reports.data?.items ?? [];

  if (items.length === 0) {
    return <></>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Link to={`/cases/${caseSummary.id}`} className="hover:underline">
            {caseSummary.ref} — {caseSummary.title}
          </Link>
        </CardTitle>
      </CardHeader>
      <ul className="divide-y divide-border">
        {items.map((report) => (
          <li key={report.id}>
            <Link
              to={`/reports/${report.id}`}
              className="flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-surface-hover"
            >
              <Mono className="w-24 shrink-0 text-text-muted">{report.ref}</Mono>
              <span className="w-20 shrink-0 text-text-muted">
                {report.audience}
              </span>
              <span className="min-w-0 flex-1 truncate">{report.title}</span>
              <TlpBadge label={report.tlp} />
              <span className="w-28 shrink-0 text-right text-text-muted">
                {report.approvedSectionCount}/{report.sectionCount} approved
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Disclosure across cases that have it enabled. */
export function DisclosureIndexRoute(): React.JSX.Element {
  const cases = useApiQuery<Paginated<CaseSummary>>(
    queryKeys.cases(),
    "/v1/cases?limit=100",
  );

  const coordinated = (cases.data?.items ?? []).filter(
    (item) => item.disclosureEnabled,
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Disclosure"
        description="Cases with a coordination workflow, and where each one stands."
      />

      <PageBody>
        {coordinated.length === 0 ? (
          <EmptyState
            title="No cases are in coordinated disclosure"
            description="Disclosure appears here once a case's profile calls for it, or you enable it on the case."
          />
        ) : (
          <ul className="divide-y divide-border rounded-[--radius] border border-border">
            {coordinated.map((item) => (
              <li key={item.id}>
                <Link
                  to={`/cases/${item.id}`}
                  className="flex items-center gap-2 px-3 py-2 text-[12px] hover:bg-surface-hover"
                >
                  <Mono className="w-32 shrink-0 text-text-muted">
                    {item.ref}
                  </Mono>
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <span className="text-text-muted">
                    {humanise(item.profile)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </div>
  );
}

/**
 * The activity log.
 *
 * A read-only projection of the audit trail. Nothing here can be edited or
 * deleted, in the interface or in the database.
 */
export function ActivityRoute(): React.JSX.Element {
  const activity = useApiQuery<Paginated<AuditEvent>>(
    queryKeys.activity(),
    "/v1/activity?limit=200",
  );

  const items = activity.data?.items ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 30,
    overscan: 15,
  });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Activity"
        description="Append-only history. Every sensitive change is recorded here and cannot be altered."
      />

      {items.length === 0 ? (
        <EmptyState title="No activity recorded yet" />
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          <div
            style={{ height: `${virtualizer.getTotalSize()}px` }}
            className="relative w-full"
          >
            {virtualizer.getVirtualItems().map((row) => {
              const event = items[row.index];

              if (event === undefined) {
                return null;
              }

              return (
                <div
                  key={event.id}
                  className="absolute left-0 top-0 flex w-full items-center gap-2 border-b border-border px-4 text-[12px]"
                  style={{
                    height: `${row.size}px`,
                    transform: `translateY(${row.start}px)`,
                  }}
                >
                  <span className="w-40 shrink-0 text-text-muted">
                    {formatDateTime(event.occurredAt)}
                  </span>
                  <Mono className="w-56 shrink-0">{event.action}</Mono>
                  <span className="w-40 shrink-0 truncate text-text-muted">
                    {event.actor?.displayName ?? "system"}
                  </span>
                  <span className="w-28 shrink-0 text-text-muted">
                    {event.entityType}
                  </span>
                  <Mono className="min-w-0 flex-1 truncate text-text-muted">
                    {event.after === null ? "" : JSON.stringify(event.after)}
                  </Mono>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function SettingsRoute(): React.JSX.Element {
  const user = useSession((state) => state.user);
  const signOut = useSession((state) => state.signOut);
  const { preference, setPreference } = useTheme();
  const [providers, setProviders] = useState<AiProviderStatus[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("MEMBER");
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const users = useApiQuery<{ items: UserSummary[] }>(
    queryKeys.users,
    "/v1/users",
    { enabled: isAdmin(user) },
  );

  const invites = useApiQuery<{ items: Invite[] }>(
    queryKeys.invites,
    "/v1/invites",
    { enabled: isAdmin(user) },
  );

  const policies = useApiQuery<{ items: AiProviderPolicy[] }>(
    queryKeys.aiPolicies,
    "/v1/ai/policies",
  );

  const createInvite = useApiMutation<{ token: string }>(
    () => ({
      path: "/v1/invites",
      method: "POST",
      body: { email: inviteEmail.trim(), role: inviteRole },
    }),
    () => [queryKeys.invites],
  );

  const updatePolicy = useApiMutation<
    AiProviderPolicy,
    { providerId: string; changes: Partial<AiProviderPolicy> }
  >(
    ({ providerId, changes }) => ({
      path: `/v1/ai/policies/${providerId}`,
      method: "PATCH",
      body: changes,
    }),
    () => [queryKeys.aiPolicies],
  );

  useEffect(() => {
    void bridge().ai.providers().then(setProviders);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" />

      <PageBody className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
          </CardHeader>
          <CardBody className="max-w-xs">
            <Label>Theme</Label>
            <Select
              aria-label="Theme"
              value={preference}
              onValueChange={(value) =>
                setPreference(value as "dark" | "light" | "system")
              }
              className="mt-1"
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
                { value: "system", label: "Follow the system" },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Local AI providers</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-[12px]">
            {providers.length === 0 ? (
              <p className="text-text-muted">Detecting…</p>
            ) : (
              providers.map((provider) => {
                const policy = policies.data?.items.find(
                  (item) => item.providerId === provider.providerId,
                );

                return (
                  <div
                    key={provider.providerId}
                    className="rounded-[--radius] border border-border p-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{provider.displayName}</span>
                      <span
                        className={
                          provider.available
                            ? "text-[11px] text-success"
                            : "text-[11px] text-warning"
                        }
                      >
                        {provider.available
                          ? `detected ${provider.version ?? ""}`
                          : "not detected"}
                      </span>
                    </div>

                    {provider.detail === null ? null : (
                      <p className="mt-0.5 text-text-muted">{provider.detail}</p>
                    )}

                    {!provider.available ? (
                      <p className="mt-1 text-text-muted">
                        Findings and reports can still be edited manually. AI is
                        never required for ordinary work.
                      </p>
                    ) : null}

                    {isAdmin(user) ? (
                      <div className="mt-2 space-y-1 border-t border-border pt-2">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={policy?.enabled ?? false}
                            onChange={(event) =>
                              updatePolicy.mutate({
                                providerId: provider.providerId,
                                changes: { enabled: event.target.checked },
                              })
                            }
                          />
                          Enabled for this workspace
                        </label>

                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={policy?.allowRestrictedCases ?? false}
                            onChange={(event) =>
                              updatePolicy.mutate({
                                providerId: provider.providerId,
                                changes: {
                                  allowRestrictedCases: event.target.checked,
                                },
                              })
                            }
                          />
                          May receive data from restricted cases
                        </label>

                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-text-muted">
                            Visibilities allowed:
                          </span>
                          {CONTENT_VISIBILITIES.map((visibility) => {
                            const allowed =
                              policy?.allowedVisibility.includes(visibility) ??
                              false;

                            return (
                              <label
                                key={visibility}
                                className="flex items-center gap-1"
                              >
                                <input
                                  type="checkbox"
                                  checked={allowed}
                                  onChange={(event) => {
                                    const current =
                                      policy?.allowedVisibility ?? [];
                                    const next = event.target.checked
                                      ? [...new Set([...current, visibility])]
                                      : current.filter(
                                          (item) => item !== visibility,
                                        );

                                    updatePolicy.mutate({
                                      providerId: provider.providerId,
                                      changes: { allowedVisibility: next },
                                    });
                                  }}
                                />
                                {visibility.toLowerCase()}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </CardBody>
        </Card>

        {isAdmin(user) ? (
          <Card>
            <CardHeader>
              <CardTitle>Invitations</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-[12px]">
              <p className="text-text-muted">
                CodeVault has no public registration. An account exists because
                someone here invited it.
              </p>

              <div className="flex flex-wrap items-end gap-2">
                <div className="w-64">
                  <Label htmlFor="invite-email">Email</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    className="mt-1"
                  />
                </div>
                <div className="w-40">
                  <Label>Role</Label>
                  <Select
                    aria-label="Invite role"
                    value={inviteRole}
                    onValueChange={setInviteRole}
                    className="mt-1"
                    options={[
                      { value: "ADMIN", label: "Admin" },
                      { value: "MEMBER", label: "Member" },
                      { value: "VIEWER", label: "Viewer" },
                    ]}
                  />
                </div>
                <Button
                  variant="primary"
                  disabled={inviteEmail.trim().length === 0}
                  onClick={() =>
                    createInvite.mutate(undefined, {
                      onSuccess: (result) => {
                        setInviteToken(result.token);
                        setInviteEmail("");
                      },
                      onError: (mutationError) =>
                        setError(mutationError.message),
                    })
                  }
                >
                  Create invitation
                </Button>
              </div>

              {inviteToken === null ? null : (
                <div className="rounded-[--radius] border border-accent/50 bg-accent/10 p-2">
                  <p className="font-medium text-accent">
                    Copy this token now — it is shown once.
                  </p>
                  <Mono className="mt-1 block break-all">{inviteToken}</Mono>
                </div>
              )}

              {invites.data === undefined ? null : (
                <ul className="divide-y divide-border rounded-[--radius] border border-border">
                  {invites.data.items.map((invite) => (
                    <li
                      key={invite.id}
                      className="flex items-center gap-2 px-2 py-1.5"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {invite.email}
                      </span>
                      <span className="text-text-muted">{invite.role}</span>
                      <span className="text-text-muted">
                        {invite.acceptedAt !== null
                          ? "accepted"
                          : invite.revokedAt !== null
                            ? "revoked"
                            : `expires ${formatDateTime(invite.expiresAt)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {users.data === undefined ? null : (
                <div>
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-text-muted">
                    Users
                  </p>
                  <ul className="divide-y divide-border rounded-[--radius] border border-border">
                    {users.data.items.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center gap-2 px-2 py-1.5"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {item.displayName}
                        </span>
                        <span className="text-text-muted">{item.email}</span>
                        <span className="text-text-muted">{item.role}</span>
                        {item.disabled ? (
                          <span className="text-danger">disabled</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {error === null ? null : (
                <p className="text-danger">{error}</p>
              )}
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-[12px]">
            <p>
              {user?.displayName} · {user?.email} · {user?.role}
            </p>
            <Button
              variant="danger"
              onClick={() => {
                void bridge()
                  .auth.logout()
                  .then(() => signOut());
              }}
            >
              Sign out
            </Button>
          </CardBody>
        </Card>
      </PageBody>
    </div>
  );
}
