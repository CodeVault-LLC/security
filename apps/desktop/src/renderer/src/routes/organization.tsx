import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import type {
  AiProviderPolicy,
  AiProviderStatus,
  AuditEvent,
  CreateInviteResponse,
  Invite,
  OrganizationSecurityPolicy,
  OrganizationSettings,
  OrganizationUser,
  OrganizationUserList,
} from "@codevault/contracts";
import { CONTENT_VISIBILITIES } from "@codevault/core";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Mono,
  Select,
  Spinner,
} from "@codevault/ui";

import { PageBody, PageHeader } from "../components/app-shell.js";
import { Avatar } from "../components/avatar.js";
import { QueryError } from "../components/query-boundary.js";
import { normalizeAiProviderStatuses } from "../lib/ai-providers.js";
import { useApiMutation, useApiQuery } from "../lib/api.js";
import { bridge } from "../lib/bridge.js";
import { formatDateTime } from "../lib/dates.js";
import { useSession } from "../lib/session.js";

function useIsAdmin(): boolean {
  return useSession((state) => state.user?.role) === "ADMIN";
}

function OrganizationAiPolicies(): React.JSX.Element {
  const admin = useIsAdmin();
  const [providers, setProviders] = useState<AiProviderStatus[]>([]);
  const policies = useApiQuery<{ items: AiProviderPolicy[] }>(
    ["ai-policies"],
    "/v1/ai/policies",
  );
  const update = useApiMutation<
    AiProviderPolicy,
    { providerId: string; changes: Partial<AiProviderPolicy> }
  >(
    ({ providerId, changes }) => ({
      path: `/v1/ai/policies/${providerId}`,
      method: "PATCH",
      body: changes,
    }),
    () => [["ai-policies"]],
  );

  useEffect(() => {
    void bridge()
      .ai.providers()
      .then((items) => setProviders(normalizeAiProviderStatuses(items)));
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization AI policy</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3 text-[12px]">
        <p className="text-text-muted">
          Every member can inspect which local providers may receive
          organization data. Only a recently verified administrator can change
          these rules.
        </p>
        <QueryError query={policies} />
        {providers.length === 0 ? (
          <p className="flex items-center gap-2 text-text-muted">
            <Spinner className="size-3.5" /> Detecting local providers…
          </p>
        ) : (
          providers.map((provider) => {
            const policy = policies.data?.items.find(
              (item) => item.providerId === provider.providerId,
            );
            if (!policy) return null;
            return (
              <div
                key={provider.providerId}
                className="rounded border border-border p-3"
              >
                <div className="flex items-center gap-2">
                  <strong>{provider.displayName}</strong>
                  <span
                    className={
                      provider.available ? "text-success" : "text-warning"
                    }
                  >
                    {provider.available ? "detected" : "not detected"}
                  </span>
                </div>
                <div className="mt-2 grid gap-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={policy.enabled}
                      disabled={!admin}
                      onChange={(event) =>
                        update.mutate({
                          providerId: provider.providerId,
                          changes: { enabled: event.target.checked },
                        })
                      }
                    />
                    Enabled for this organization
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={policy.allowRestrictedCases}
                      disabled={!admin}
                      onChange={(event) =>
                        update.mutate({
                          providerId: provider.providerId,
                          changes: {
                            allowRestrictedCases: event.target.checked,
                          },
                        })
                      }
                    />
                    May receive restricted-case context
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={policy.isolated}
                      disabled={!admin}
                      onChange={(event) =>
                        update.mutate({
                          providerId: provider.providerId,
                          changes: { isolated: event.target.checked },
                        })
                      }
                    />
                    Isolate runs from workstation configuration
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-text-muted">Allowed visibility:</span>
                    {CONTENT_VISIBILITIES.map((visibility) => (
                      <label
                        key={visibility}
                        className="flex items-center gap-1"
                      >
                        <input
                          type="checkbox"
                          disabled={!admin}
                          checked={policy.allowedVisibility.includes(
                            visibility,
                          )}
                          onChange={(event) => {
                            const next = event.target.checked
                              ? [
                                  ...new Set([
                                    ...policy.allowedVisibility,
                                    visibility,
                                  ]),
                                ]
                              : policy.allowedVisibility.filter(
                                  (item) => item !== visibility,
                                );
                            update.mutate({
                              providerId: provider.providerId,
                              changes: { allowedVisibility: next },
                            });
                          }}
                        />
                        {visibility.toLowerCase()}
                      </label>
                    ))}
                  </div>
                  <p className="text-text-muted">
                    Models:{" "}
                    {policy.allowedModels.length > 0
                      ? policy.allowedModels.map((model) => (
                          <Mono key={model}>{model} </Mono>
                        ))
                      : "none allowed"}
                  </p>
                </div>
              </div>
            );
          })
        )}
        {update.error ? (
          <p className="text-danger">{update.error.message}</p>
        ) : null}
      </CardBody>
    </Card>
  );
}

export function OrganizationUsersRoute(): React.JSX.Element {
  const admin = useIsAdmin();
  const users = useApiQuery<OrganizationUserList>(
    ["organization", "users"],
    "/v1/organization/users",
  );
  const invitations = useApiQuery<{ items: Invite[] }>(
    ["organization", "invitations"],
    "/v1/organization/invitations",
    { enabled: admin },
  );
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [token, setToken] = useState<string | null>(null);
  const invite = useApiMutation<CreateInviteResponse>(
    () => ({
      path: "/v1/organization/invitations",
      method: "POST",
      body: { email: email.trim(), role },
    }),
    () => [["organization", "invitations"]],
  );
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Organization users" />
      <PageBody className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Cleared members</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="mb-3 text-[12px] text-text-muted">
              Every active member can see the full case catalog and organization
              directory. Only administrators can change access.
            </p>
            <ul className="divide-y divide-border rounded border border-border">
              {users.data?.items.map((user) => (
                <li
                  key={user.id}
                  className="grid grid-cols-[1fr_1fr_auto_auto] gap-3 px-3 py-2 text-[12px]"
                >
                  <Link
                    to="/organization/users/$userId"
                    params={{ userId: user.id }}
                    className="font-semibold text-accent hover:underline"
                  >
                    <Avatar
                      avatarId={user.avatarId}
                      userId={user.id}
                      label={user.displayName}
                      size="sm"
                      showLabel
                      className="gap-1.5"
                    />
                  </Link>
                  <span className="text-text-muted">{user.email}</span>
                  <span>{user.role}</span>
                  <span
                    className={user.disabled ? "text-danger" : "text-success"}
                  >
                    {user.disabled ? "Disabled" : "Active"}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        {admin ? (
          <Card>
            <CardHeader>
              <CardTitle>Invite a user</CardTitle>
            </CardHeader>
            <CardBody>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label htmlFor="organization-invite-email">
                    Organization email
                  </Label>
                  <Input
                    id="organization-invite-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="mt-1"
                  />
                </div>
                <Select
                  aria-label="Role"
                  value={role}
                  onValueChange={setRole}
                  options={[
                    { value: "ADMIN", label: "Administrator" },
                    { value: "MEMBER", label: "Member" },
                    { value: "VIEWER", label: "Viewer" },
                  ]}
                />
                <Button
                  variant="primary"
                  onClick={() =>
                    invite.mutate(undefined, {
                      onSuccess: (result) => {
                        setToken(result.token);
                        setEmail("");
                      },
                    })
                  }
                >
                  Create invitation
                </Button>
              </div>
              {token ? (
                <div className="mt-3 rounded border border-warning/50 bg-warning/5 p-3 text-[12px]">
                  <strong>Copy once:</strong>
                  <code className="mt-1 block break-all">{token}</code>
                </div>
              ) : null}
              <ul className="mt-3 text-[12px] text-text-muted">
                {invitations.data?.items.map((item) => (
                  <li key={item.id}>
                    {item.email} · {item.role}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ) : null}
      </PageBody>
    </div>
  );
}

export function OrganizationUserDetailRoute(props: {
  userId: string;
}): React.JSX.Element {
  const admin = useIsAdmin();
  const user = useApiQuery<OrganizationUser>(
    ["organization", "users", props.userId],
    `/v1/organization/users/${props.userId}`,
  );
  const activity = useApiQuery<{ items: AuditEvent[] }>(
    ["organization", "users", props.userId, "activity"],
    `/v1/activity?actorId=${props.userId}&limit=50`,
  );
  const [roleDraft, setRoleDraft] = useState<string | null>(null);
  const update = useApiMutation<OrganizationUser, Partial<OrganizationUser>>(
    (changes) => ({
      path: `/v1/organization/users/${props.userId}`,
      method: "PATCH",
      body: changes,
    }),
    () => [
      ["organization", "users"],
      ["organization", "users", props.userId],
    ],
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Organization user" />
      <PageBody className="space-y-4">
        <Link
          to="/organization/users"
          className="text-[12px] text-accent hover:underline"
        >
          ← Organization users
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>Membership</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-[12px]">
            <Avatar
              avatarId={user.data?.avatarId ?? null}
              {...(user.data ? { userId: user.data.id } : {})}
              label={user.data?.displayName ?? "User"}
              showLabel
            />
            <p>{user.data?.email ?? "Loading…"}</p>
            <p className="text-text-muted">
              {user.data?.role ?? "—"} ·{" "}
              {user.data?.disabled ? "disabled" : "active"}
              {user.data
                ? ` · joined ${formatDateTime(user.data.joinedAt)}`
                : ""}
            </p>
            {admin && user.data ? (
              <div className="flex items-end gap-2 border-t border-border pt-3">
                <div className="w-44">
                  <Label htmlFor="organization-user-role">Role</Label>
                  <Select
                    aria-label="Organization role"
                    value={roleDraft ?? user.data.role}
                    onValueChange={setRoleDraft}
                    options={[
                      { value: "ADMIN", label: "Administrator" },
                      { value: "MEMBER", label: "Member" },
                      { value: "VIEWER", label: "Viewer" },
                    ]}
                  />
                </div>
                <Button
                  onClick={() =>
                    update.mutate({
                      role: (roleDraft ??
                        user.data!.role) as OrganizationUser["role"],
                    })
                  }
                >
                  Save role
                </Button>
                <Button
                  variant={user.data.disabled ? "secondary" : "danger"}
                  onClick={() =>
                    update.mutate({ disabled: !user.data!.disabled })
                  }
                >
                  {user.data.disabled ? "Enable user" : "Disable user"}
                </Button>
              </div>
            ) : null}
            {update.error ? (
              <p className="text-danger">{update.error.message}</p>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="divide-y divide-border text-[12px]">
              {activity.data?.items.map((event) => (
                <li key={event.id} className="flex gap-3 py-2">
                  <span className="w-40 shrink-0 text-text-muted">
                    {formatDateTime(event.occurredAt)}
                  </span>
                  <Mono>{event.action}</Mono>
                  <span className="truncate text-text-muted">
                    {event.entityType}
                  </span>
                </li>
              ))}
            </ul>
            {activity.data?.items.length === 0 ? (
              <p className="text-[12px] text-text-muted">
                No activity recorded.
              </p>
            ) : null}
          </CardBody>
        </Card>
      </PageBody>
    </div>
  );
}

export function OrganizationSettingsRoute(): React.JSX.Element {
  const admin = useIsAdmin();
  const organization = useApiQuery<OrganizationSettings>(
    ["organization", "settings"],
    "/v1/organization/settings",
  );
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [contactNameDraft, setContactNameDraft] = useState<string | null>(null);
  const [contactEmailDraft, setContactEmailDraft] = useState<string | null>(
    null,
  );
  const [reportFooterDraft, setReportFooterDraft] = useState<string | null>(
    null,
  );
  const name = nameDraft ?? organization.data?.name ?? "";
  const contactName = contactNameDraft ?? organization.data?.contactName ?? "";
  const contactEmail =
    contactEmailDraft ?? organization.data?.contactEmail ?? "";
  const reportFooter =
    reportFooterDraft ?? organization.data?.reportFooter ?? "";
  const update = useApiMutation<OrganizationSettings>(
    () => ({
      path: "/v1/organization/settings",
      method: "PATCH",
      body: {
        name: name.trim(),
        contactName:
          contactName.trim().length === 0 ? null : contactName.trim(),
        contactEmail:
          contactEmail.trim().length === 0
            ? null
            : contactEmail.trim().toLowerCase(),
        reportFooter:
          reportFooter.trim().length === 0 ? null : reportFooter.trim(),
      },
    }),
    () => [["organization", "settings"]],
  );
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Organization settings" />
      <PageBody>
        <Card>
          <CardHeader>
            <CardTitle>Organization identity</CardTitle>
          </CardHeader>
          <CardBody>
            <Avatar
              avatarId={organization.data?.avatarId ?? null}
              label={organization.data?.name ?? "Organization"}
              seed={organization.data?.id ?? "organization"}
              showLabel
              {...(admin ? { target: "ORGANIZATION" as const } : {})}
            />
            <p className="mt-1 text-[12px] text-text-muted">
              The organization name and sanitized avatar identify the security
              boundary that owns every user, case, role, and policy.
            </p>
            {admin ? (
              <div className="mt-3 max-w-2xl space-y-3 border-t border-border pt-3">
                <div>
                  <Label htmlFor="organization-name">Organization name</Label>
                  <Input
                    id="organization-name"
                    value={name}
                    onChange={(event) => setNameDraft(event.target.value)}
                    maxLength={120}
                    className="mt-1"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="organization-contact-name">
                      Report contact name
                    </Label>
                    <Input
                      id="organization-contact-name"
                      value={contactName}
                      onChange={(event) =>
                        setContactNameDraft(event.target.value)
                      }
                      maxLength={120}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="organization-contact-email">
                      Report contact email
                    </Label>
                    <Input
                      id="organization-contact-email"
                      type="email"
                      value={contactEmail}
                      onChange={(event) =>
                        setContactEmailDraft(event.target.value)
                      }
                      maxLength={320}
                      className="mt-1"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="organization-report-footer">
                    Report identity line
                  </Label>
                  <Input
                    id="organization-report-footer"
                    value={reportFooter}
                    onChange={(event) =>
                      setReportFooterDraft(event.target.value)
                    }
                    maxLength={300}
                    placeholder="Security team · security@example.com"
                    className="mt-1"
                  />
                  <p className="mt-1 text-[11px] text-text-muted">
                    Printed on the report cover with the organization contact.
                  </p>
                </div>
                <div className="flex justify-end">
                  <Button
                    variant="primary"
                    disabled={name.trim().length < 2 || update.isPending}
                    onClick={() => update.mutate()}
                  >
                    Save report identity
                  </Button>
                </div>
                <p className="mt-2 text-[11px] text-warning">
                  Changes require a recent authenticator verification.
                </p>
                {update.error ? (
                  <p className="mt-1 text-[11px] text-danger">
                    {update.error.message}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-[11px] text-text-muted">
                Read-only. Ask an administrator to change organization-wide
                settings.
              </p>
            )}
          </CardBody>
        </Card>
      </PageBody>
    </div>
  );
}

export function OrganizationSecurityRoute(): React.JSX.Element {
  const admin = useIsAdmin();
  const policy = useApiQuery<OrganizationSecurityPolicy>(
    ["organization", "security"],
    "/v1/organization/security",
  );
  const [draft, setDraft] = useState<
    Partial<{
      inviteTtlHours: number;
      sessionIdleMinutes: number;
      sessionAbsoluteHours: number;
      recentMfaMinutes: number;
    }>
  >({});
  const values = {
    inviteTtlHours: draft.inviteTtlHours ?? policy.data?.inviteTtlHours ?? 24,
    sessionIdleMinutes:
      draft.sessionIdleMinutes ?? policy.data?.sessionIdleMinutes ?? 30,
    sessionAbsoluteHours:
      draft.sessionAbsoluteHours ?? policy.data?.sessionAbsoluteHours ?? 12,
    recentMfaMinutes:
      draft.recentMfaMinutes ?? policy.data?.recentMfaMinutes ?? 10,
  };
  const update = useApiMutation<OrganizationSecurityPolicy>(
    () => ({
      path: "/v1/organization/security",
      method: "PATCH",
      body: values,
    }),
    () => [["organization", "security"]],
  );
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Organization security" />
      <PageBody className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Enforced policy</CardTitle>
          </CardHeader>
          <CardBody className="grid grid-cols-2 gap-3 text-[12px]">
            <div>
              <span className="text-text-muted">
                Multi-factor authentication
              </span>
              <strong className="block text-success">
                Required for everyone
              </strong>
            </div>
            <div>
              <span className="text-text-muted">Session idle limit</span>
              <strong className="block">
                {policy.data?.sessionIdleMinutes ?? "—"} minutes
              </strong>
            </div>
            <div>
              <span className="text-text-muted">Absolute session limit</span>
              <strong className="block">
                {policy.data?.sessionAbsoluteHours ?? "—"} hours
              </strong>
            </div>
            <div>
              <span className="text-text-muted">Sensitive-action recheck</span>
              <strong className="block">
                {policy.data?.recentMfaMinutes ?? "—"} minutes
              </strong>
            </div>
            <p className="col-span-2 mt-2 text-text-muted">
              All members may inspect these rules. Only a recently verified
              administrator can modify them.
            </p>
            {admin ? (
              <div className="col-span-2 mt-2 grid grid-cols-2 gap-3 border-t border-border pt-3">
                {(
                  [
                    ["inviteTtlHours", "Invitation lifetime (hours)"],
                    ["sessionIdleMinutes", "Idle timeout (minutes)"],
                    ["sessionAbsoluteHours", "Absolute timeout (hours)"],
                    ["recentMfaMinutes", "Sensitive-action recheck (minutes)"],
                  ] as const
                ).map(([field, label]) => (
                  <div key={field}>
                    <Label htmlFor={field}>{label}</Label>
                    <Input
                      id={field}
                      type="number"
                      value={values[field]}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [field]: Number(event.target.value),
                        }))
                      }
                      className="mt-1"
                    />
                  </div>
                ))}
                <div className="col-span-2">
                  <Button
                    variant="primary"
                    disabled={update.isPending}
                    onClick={() => update.mutate()}
                  >
                    Save security policy
                  </Button>
                  {update.error ? (
                    <p className="mt-1 text-danger">{update.error.message}</p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </CardBody>
        </Card>
        <OrganizationAiPolicies />
      </PageBody>
    </div>
  );
}
