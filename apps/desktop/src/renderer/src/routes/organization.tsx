import { Link } from "@tanstack/react-router";
import { CheckCircle2, CircleOff, LockKeyhole, RotateCcw } from "lucide-react";
import { useEffect, useId, useState } from "react";

import {
  AI_EFFORT_LEVELS,
  AI_PROVIDER_CAPABILITIES,
  AI_PROVIDER_IDS,
  AI_SETTING_SOURCES,
  type AiProviderPolicy,
  type AiProviderStatus,
  type AuditEvent,
  type CreateInviteResponse,
  type Invite,
  type OrganizationSecurityPolicy,
  type OrganizationSettings,
  type OrganizationUser,
  type OrganizationUserList,
} from "@codevault/contracts";
import { CONTENT_VISIBILITIES } from "@codevault/core";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  FieldDescription,
  FieldError,
  Input,
  Label,
  LoadingState,
  Mono,
  Select,
  Spinner,
} from "@codevault/ui";

import { Avatar } from "../components/avatar.js";
import { QueryError } from "../components/query-boundary.js";
import { OrganizationSettingsPage as OrganizationPage } from "../components/settings-layout.js";
import { normalizeAiProviderStatuses } from "../lib/ai-providers.js";
import { useApiMutation, useApiQuery } from "../lib/api.js";
import { bridge } from "../lib/bridge.js";
import { formatDateTime } from "../lib/dates.js";
import { useSession } from "../lib/session.js";

function useIsAdmin(): boolean {
  return useSession((state) => state.user?.role) === "ADMIN";
}

function PolicyCheckbox({
  checked,
  disabled = false,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  description?: string;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  const checkboxId = useId();

  return (
    <div
      className={cn(
        "flex min-h-10 items-start gap-2 rounded-(--cv-radius) px-2 py-1.5 text-[12px]",
        disabled
          ? "cursor-not-allowed opacity-60"
          : "cursor-pointer hover:bg-surface-hover",
      )}
    >
      <Checkbox
        id={checkboxId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
        className="mt-0.5"
      />
      <label htmlFor={checkboxId} className="min-w-0 cursor-inherit">
        <span className="block font-medium text-text">{label}</span>
        {description === undefined ? null : (
          <span className="mt-0.5 block text-[11px] leading-4 text-text-muted">
            {description}
          </span>
        )}
      </label>
    </div>
  );
}

const ORGANIZATION_ROLES = [
  { value: "ADMIN", label: "Admin" },
  { value: "MEMBER", label: "Member" },
  { value: "VIEWER", label: "Viewer" },
] as const;

function OrganizationRolePicker({
  value,
  onChange,
  disabled = false,
  legend = "Organization role",
}: {
  value: OrganizationUser["role"];
  onChange: (value: OrganizationUser["role"]) => void;
  disabled?: boolean;
  legend?: string;
}): React.JSX.Element {
  const groupId = useId();

  return (
    <fieldset disabled={disabled}>
      <legend className="text-[12px] font-medium text-text">{legend}</legend>
      <div className="mt-1 grid h-9 grid-cols-3 divide-x divide-border overflow-hidden rounded-(--cv-radius) border border-border-strong bg-surface">
        {ORGANIZATION_ROLES.map((role) => (
          <label
            key={role.value}
            className={cn(
              "relative cursor-pointer",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <input
              type="radio"
              name={groupId}
              value={role.value}
              checked={value === role.value}
              disabled={disabled}
              className="peer sr-only"
              onChange={() => onChange(role.value)}
            />
            <span className="flex h-full items-center justify-center px-2 text-[11px] font-medium text-text-muted transition-[background-color,color] duration-100 hover:bg-surface-hover hover:text-text peer-checked:bg-accent/10 peer-checked:text-accent peer-focus-visible:outline-2 peer-focus-visible:-outline-offset-2 peer-focus-visible:outline-focus">
              {role.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function PolicyCheckChip({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  const checkboxId = useId();

  return (
    <div
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-(--cv-radius) border px-2 text-[11px] font-medium",
        checked
          ? "border-accent/45 bg-accent/10 text-accent"
          : "border-border bg-surface text-text-muted",
        disabled ? "cursor-not-allowed opacity-60" : "hover:bg-surface-hover",
      )}
    >
      <Checkbox
        id={checkboxId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <label
        htmlFor={checkboxId}
        className={cn("cursor-pointer", disabled && "cursor-not-allowed")}
      >
        {label}
      </label>
    </div>
  );
}

function SettingsSaveBar({
  dirty,
  invalid = false,
  pending,
  saved,
  error,
  saveLabel,
  onReset,
  onSave,
}: {
  dirty: boolean;
  invalid?: boolean;
  pending: boolean;
  saved: boolean;
  error: string | null;
  saveLabel: string;
  onReset: () => void;
  onSave: () => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border bg-surface-raised/55 px-4 py-3">
      <div className="min-w-0 flex-1 text-[11px]">
        {error !== null ? (
          <FieldError className="mt-0">{error}</FieldError>
        ) : saved ? (
          <span className="inline-flex items-center gap-1.5 text-success">
            <CheckCircle2 aria-hidden className="size-3.5" />
            Changes saved
          </span>
        ) : dirty ? (
          <span className="text-text-muted">Unsaved changes</span>
        ) : (
          <span className="text-text-muted">No pending changes</span>
        )}
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={!dirty || pending}
        onClick={onReset}
      >
        <RotateCcw aria-hidden />
        Reset
      </Button>
      <Button
        type="button"
        size="sm"
        variant={dirty && !invalid ? "primary" : "secondary"}
        loading={pending}
        disabled={!dirty || invalid}
        title={
          !dirty
            ? "There are no changes to save."
            : invalid
              ? "Fix the highlighted fields before saving."
              : undefined
        }
        onClick={onSave}
      >
        {saveLabel}
      </Button>
    </div>
  );
}

function OrganizationAiPolicyEditor({
  admin,
  detectionUnknown = false,
  persisted,
  provider,
  policy,
}: {
  admin: boolean;
  detectionUnknown?: boolean;
  persisted: boolean;
  provider: AiProviderStatus;
  policy: AiProviderPolicy;
}): React.JSX.Element {
  const [draft, setDraft] = useState<Partial<AiProviderPolicy>>({});
  const [saved, setSaved] = useState(false);
  const values = { ...policy, ...draft };
  const dirty = (Object.keys(draft) as Array<keyof AiProviderPolicy>).some(
    (field) => JSON.stringify(values[field]) !== JSON.stringify(policy[field]),
  );
  const budgetInvalid =
    values.maxBudgetUsd !== null &&
    (values.maxBudgetUsd < 0 || values.maxBudgetUsd > 100);
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

  const change = <K extends keyof AiProviderPolicy>(
    field: K,
    value: AiProviderPolicy[K],
  ): void => {
    setSaved(false);
    setDraft((current) => ({ ...current, [field]: value }));
  };

  return (
    <article className="border-t border-border first:border-t-0">
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold">
              {provider.displayName}
            </h3>
            <span
              className={cn(
                "inline-flex min-h-5 items-center gap-1 rounded-full border px-1.5 text-[11px] font-medium leading-none",
                provider.available
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-warning/45 bg-warning/10 text-warning",
              )}
            >
              {provider.available ? (
                <CheckCircle2 aria-hidden className="size-3" />
              ) : (
                <CircleOff aria-hidden className="size-3" />
              )}
              {provider.available
                ? "Detected on this device"
                : detectionUnknown
                  ? "Detection unavailable"
                  : "Not detected"}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-text-muted">
            {detectionUnknown
              ? "Local availability could not be checked"
              : provider.version === null
                ? "Local version unavailable"
                : `Local version ${provider.version}`}
            {persisted && policy.updatedAt
              ? ` · Policy updated ${formatDateTime(policy.updatedAt)}`
              : " · No organization policy saved"}
          </p>
        </div>
        <PolicyCheckbox
          checked={values.enabled}
          disabled={!admin}
          label="Provider enabled"
          description="Allows approved actions to use this provider."
          onChange={(checked) => change("enabled", checked)}
        />
      </div>

      <div className="grid gap-4 border-t border-border px-4 py-4 xl:grid-cols-2">
        <section>
          <h4 className="text-[12px] font-semibold">Data access</h4>
          <p className="mt-0.5 text-[11px] text-text-muted">
            Choose which organization content may leave the server-built context
            boundary.
          </p>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            <PolicyCheckbox
              checked={values.allowRestrictedCases}
              disabled={!admin}
              label="Restricted cases"
              description="May receive context from restricted cases."
              onChange={(checked) => change("allowRestrictedCases", checked)}
            />
            <PolicyCheckbox
              checked={values.retainFullPrompts}
              disabled={!admin}
              label="Retain full prompts"
              description="Stores prompt text for audit instead of its hash only."
              onChange={(checked) => change("retainFullPrompts", checked)}
            />
          </div>
          <fieldset className="mt-3">
            <legend className="text-[11px] font-medium text-text-muted">
              Allowed visibility
            </legend>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {CONTENT_VISIBILITIES.map((visibility) => {
                const checked = values.allowedVisibility.includes(visibility);
                return (
                  <PolicyCheckChip
                    key={visibility}
                    checked={checked}
                    disabled={!admin}
                    label={visibility.toLowerCase()}
                    onChange={(nextChecked) =>
                      change(
                        "allowedVisibility",
                        nextChecked
                          ? [
                              ...new Set([
                                ...values.allowedVisibility,
                                visibility,
                              ]),
                            ]
                          : values.allowedVisibility.filter(
                              (item) => item !== visibility,
                            ),
                      )
                    }
                  />
                );
              })}
            </div>
          </fieldset>
        </section>

        <section>
          <h4 className="text-[12px] font-semibold">Models and effort</h4>
          <p className="mt-0.5 text-[11px] text-text-muted">
            An empty allow-list prevents the provider from running even when it
            is enabled.
          </p>
          <fieldset className="mt-2">
            <legend className="text-[11px] font-medium text-text-muted">
              Allowed models
            </legend>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {provider.models.map((model) => (
                <PolicyCheckbox
                  key={model}
                  checked={values.allowedModels.includes(model)}
                  disabled={!admin}
                  label={model}
                  onChange={(checked) => {
                    const next = checked
                      ? [...new Set([...values.allowedModels, model])]
                      : values.allowedModels.filter((item) => item !== model);
                    change("allowedModels", next);
                    if (
                      values.defaultModel !== null &&
                      !next.includes(values.defaultModel)
                    ) {
                      change("defaultModel", null);
                    }
                  }}
                />
              ))}
            </div>
          </fieldset>
          <fieldset className="mt-3">
            <legend className="text-[11px] font-medium text-text-muted">
              Allowed effort levels
            </legend>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {AI_EFFORT_LEVELS.map((effort) => {
                const checked = values.allowedEfforts.includes(effort);
                return (
                  <PolicyCheckChip
                    key={effort}
                    checked={checked}
                    disabled={!admin}
                    label={effort}
                    onChange={(nextChecked) =>
                      change(
                        "allowedEfforts",
                        nextChecked
                          ? [...new Set([...values.allowedEfforts, effort])]
                          : values.allowedEfforts.filter(
                              (item) => item !== effort,
                            ),
                      )
                    }
                  />
                );
              })}
            </div>
          </fieldset>
          <div className="mt-3 max-w-sm">
            <Label htmlFor={`${provider.providerId}-default-model`}>
              Default model
            </Label>
            <Select
              aria-label={`${provider.displayName} default model`}
              value={values.defaultModel ?? ""}
              disabled={!admin || values.allowedModels.length === 0}
              onValueChange={(value) =>
                change(
                  "defaultModel",
                  value.length === 0
                    ? null
                    : (value as AiProviderPolicy["defaultModel"]),
                )
              }
              options={[
                { value: "", label: "No default" },
                ...values.allowedModels.map((model) => ({
                  value: model,
                  label: model,
                })),
              ]}
            />
          </div>
        </section>
      </div>

      <details className="border-t border-border px-4 py-3">
        <summary className="flex min-h-8 cursor-pointer list-none items-center text-[12px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          Advanced execution policy
        </summary>
        <div className="grid gap-3 pt-3 md:grid-cols-2">
          <PolicyCheckbox
            checked={values.isolated}
            disabled={!admin}
            label="Isolate workstation configuration"
            description="Prevents the provider from reading local project or user configuration."
            onChange={(checked) => change("isolated", checked)}
          />
          <div>
            <Label htmlFor={`${provider.providerId}-budget`}>
              Maximum cost per run
            </Label>
            <div className="mt-1 flex items-center gap-2">
              <Input
                id={`${provider.providerId}-budget`}
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={values.maxBudgetUsd ?? ""}
                disabled={!admin}
                aria-invalid={budgetInvalid}
                onChange={(event) =>
                  change(
                    "maxBudgetUsd",
                    event.target.value.length === 0
                      ? null
                      : Number(event.target.value),
                  )
                }
                className="max-w-28 text-right tabular-nums"
              />
              <span className="text-[11px] text-text-muted">USD</span>
            </div>
            {budgetInvalid ? (
              <FieldError>Enter an amount from 0 to 100 USD.</FieldError>
            ) : (
              <FieldDescription>
                Leave blank when the provider does not report cost.
              </FieldDescription>
            )}
          </div>
          <fieldset className="md:col-span-2">
            <legend className="text-[11px] font-medium text-text-muted">
              Configuration sources
            </legend>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {AI_SETTING_SOURCES.map((source) => (
                <PolicyCheckbox
                  key={source}
                  checked={values.settingSources.includes(source)}
                  disabled={!admin}
                  label={source}
                  onChange={(checked) =>
                    change(
                      "settingSources",
                      checked
                        ? [...new Set([...values.settingSources, source])]
                        : values.settingSources.filter(
                            (item) => item !== source,
                          ),
                    )
                  }
                />
              ))}
            </div>
          </fieldset>
        </div>
      </details>

      {admin ? (
        <SettingsSaveBar
          dirty={dirty}
          invalid={budgetInvalid}
          pending={update.isPending}
          saved={saved}
          error={update.error?.message ?? null}
          saveLabel={`Save ${provider.displayName} policy`}
          onReset={() => {
            setDraft({});
            setSaved(false);
          }}
          onSave={() =>
            update.mutate(
              {
                providerId: provider.providerId,
                changes: persisted ? draft : values,
              },
              {
                onSuccess: () => {
                  setDraft({});
                  setSaved(true);
                },
              },
            )
          }
        />
      ) : null}
    </article>
  );
}

function OrganizationAiPolicies(): React.JSX.Element {
  const admin = useIsAdmin();
  const [providers, setProviders] = useState<AiProviderStatus[]>([]);
  const [providerScanComplete, setProviderScanComplete] = useState(false);
  const [providerScanError, setProviderScanError] = useState(false);
  const [providerScanAttempt, setProviderScanAttempt] = useState(0);
  const policies = useApiQuery<{ items: AiProviderPolicy[] }>(
    ["ai-policies"],
    "/v1/ai/policies",
  );

  useEffect(() => {
    void bridge()
      .ai.providers()
      .then((items) => setProviders(normalizeAiProviderStatuses(items)))
      .catch(() => {
        setProviders([]);
        setProviderScanError(true);
      })
      .finally(() => setProviderScanComplete(true));
  }, [providerScanAttempt]);

  const policyItems = policies.data?.items ?? [];
  const policyRows = AI_PROVIDER_IDS.map((providerId) => {
    const persistedPolicy = policyItems.find(
      (item) => item.providerId === providerId,
    );
    const capabilities = AI_PROVIDER_CAPABILITIES[providerId];
    const policy: AiProviderPolicy = persistedPolicy ?? {
      providerId,
      enabled: false,
      allowedVisibility: ["INTERNAL"],
      allowRestrictedCases: false,
      retainFullPrompts: false,
      allowedModels: [...capabilities.models],
      allowedEfforts: [...capabilities.efforts],
      defaultModel: capabilities.defaultModel,
      settingSources: ["user"],
      isolated: true,
      maxBudgetUsd: null,
      updatedAt: "1970-01-01T00:00:00.000Z",
    };

    return { policy, persisted: persistedPolicy !== undefined };
  });

  return (
    <Card>
      <CardHeader className="items-start py-3">
        <div>
          <CardTitle>AI provider policy</CardTitle>
          <p className="mt-0.5 text-[11px] text-text-muted">
            Control which local providers may receive organization context and
            which models researchers may run.
          </p>
        </div>
        <span className="shrink-0 text-[11px] text-text-muted">
          {admin ? "Administrator access" : "Read only"}
        </span>
      </CardHeader>
      <QueryError query={policies} className="m-4" />
      {providerScanError ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-warning/35 bg-warning/5 px-4 py-3 text-[11px] text-warning">
          <span className="min-w-0 flex-1">
            Local provider detection failed. Stored organization policies are
            still available, but device availability cannot be confirmed.
          </span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setProviderScanComplete(false);
              setProviderScanError(false);
              setProviderScanAttempt((attempt) => attempt + 1);
            }}
          >
            <RotateCcw aria-hidden />
            Retry detection
          </Button>
        </div>
      ) : null}
      {policies.isError ? null : policies.isLoading || !providerScanComplete ? (
        <div className="flex items-center gap-2 px-4 py-5 text-[12px] text-text-muted">
          <Spinner className="size-3.5" />
          {!providerScanComplete
            ? "Detecting local providers…"
            : "Loading provider policy…"}
        </div>
      ) : (
        policyRows.map(({ policy, persisted }) => {
          const localProvider = providers.find(
            (item) => item.providerId === policy.providerId,
          );
          const capabilities = AI_PROVIDER_CAPABILITIES[policy.providerId];
          const provider: AiProviderStatus = localProvider ?? {
            providerId: policy.providerId,
            displayName: capabilities.displayName,
            available: false,
            version: null,
            executablePath: null,
            detail: "No matching provider was detected on this device.",
            models: [...capabilities.models],
            efforts: [...capabilities.efforts],
            defaultModel: capabilities.defaultModel,
          };

          return (
            <OrganizationAiPolicyEditor
              key={policy.providerId}
              admin={admin}
              detectionUnknown={providerScanError}
              persisted={persisted}
              provider={provider}
              policy={policy}
            />
          );
        })
      )}
      {admin ? null : (
        <p className="border-t border-border px-4 py-3 text-[11px] text-text-muted">
          Ask an administrator with a recent authenticator verification to
          change provider access.
        </p>
      )}
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
  const [renderedAt] = useState(() => Date.now());
  const normalizedEmail = email.trim().toLowerCase();
  const invitationEmailInvalid =
    normalizedEmail.length > 0 &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
  const invite = useApiMutation<CreateInviteResponse>(
    () => ({
      path: "/v1/organization/invitations",
      method: "POST",
      body: { email: normalizedEmail, role },
    }),
    () => [["organization", "invitations"]],
  );
  return (
    <OrganizationPage
      title="Members"
      description="Manage membership, roles, account status, and pending invitations."
    >
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Member directory</CardTitle>
              <p className="mt-0.5 text-[11px] text-text-muted">
                Active members can see the organization directory and every case
                their role permits.
              </p>
            </div>
            <span className="text-[11px] tabular-nums text-text-muted">
              {users.data === undefined
                ? "— total"
                : `${users.data.items.length} total`}
            </span>
          </CardHeader>
          <CardBody className="p-0">
            <QueryError query={users} className="m-3" />
            {users.isLoading ? (
              <LoadingState label="Loading organization members…" />
            ) : users.isError ? null : users.data?.items.length === 0 ? (
              <p className="px-4 py-5 text-[12px] text-text-muted">
                No organization members found.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {users.data?.items.map((user) => (
                  <li
                    key={user.id}
                    className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2 text-[12px] md:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_auto_auto]"
                  >
                    <Link
                      to="/organization/users/$userId"
                      params={{ userId: user.id }}
                      className="min-w-0 rounded-(--cv-radius) font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
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
                    <span className="hidden min-w-0 truncate text-text-muted md:block">
                      {user.email}
                    </span>
                    <span className="hidden min-h-5 items-center rounded-full border border-border bg-surface-raised px-1.5 text-[11px] font-medium md:inline-flex">
                      {user.role.toLowerCase()}
                    </span>
                    <span
                      className={cn(
                        "inline-flex min-h-5 items-center gap-1 justify-self-end rounded-full border px-1.5 text-[11px] font-medium leading-none",
                        user.disabled
                          ? "border-danger/40 bg-danger/10 text-danger"
                          : "border-success/40 bg-success/10 text-success",
                      )}
                    >
                      {user.disabled ? (
                        <CircleOff aria-hidden className="size-3" />
                      ) : (
                        <CheckCircle2 aria-hidden className="size-3" />
                      )}
                      {user.disabled ? "Disabled" : "Active"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        {admin ? (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Invite a member</CardTitle>
                <p className="mt-0.5 text-[11px] text-text-muted">
                  Invitations expire according to the organization security
                  policy.
                </p>
              </div>
            </CardHeader>
            <CardBody>
              <div className="grid items-end gap-3 md:grid-cols-[minmax(14rem,1fr)_minmax(18rem,auto)_auto]">
                <div>
                  <Label htmlFor="organization-invite-email">
                    Organization email
                  </Label>
                  <Input
                    id="organization-invite-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="researcher@example.com"
                    aria-invalid={invitationEmailInvalid}
                    aria-describedby="organization-invite-email-description"
                    className="mt-1"
                  />
                  {invitationEmailInvalid ? (
                    <FieldError id="organization-invite-email-description">
                      Enter a complete email address.
                    </FieldError>
                  ) : (
                    <FieldDescription id="organization-invite-email-description">
                      The invitation is scoped to this organization.
                    </FieldDescription>
                  )}
                </div>
                <div>
                  <OrganizationRolePicker
                    legend="Invitation role"
                    value={role as OrganizationUser["role"]}
                    onChange={setRole}
                  />
                </div>
                <Button
                  variant="primary"
                  loading={invite.isPending}
                  disabled={
                    normalizedEmail.length === 0 || invitationEmailInvalid
                  }
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
              {invite.error ? (
                <FieldError>{invite.error.message}</FieldError>
              ) : null}
              {token ? (
                <div className="mt-3 rounded border border-warning/50 bg-warning/5 p-3 text-[12px]">
                  <strong>Copy once:</strong>
                  <code className="mt-1 block break-all">{token}</code>
                </div>
              ) : null}
              <section className="mt-4 border-t border-border pt-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[12px] font-semibold">
                    Pending invitations
                  </h3>
                  <span className="text-[11px] tabular-nums text-text-muted">
                    {invitations.data === undefined
                      ? "— total"
                      : `${invitations.data.items.length} total`}
                  </span>
                </div>
                <QueryError query={invitations} className="mt-3" />
                {invitations.isLoading ? (
                  <LoadingState label="Loading invitations…" />
                ) : invitations.isError ? null : invitations.data?.items
                    .length === 0 ? (
                  <p className="py-4 text-[12px] text-text-muted">
                    No pending invitations.
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-border text-[12px]">
                    {invitations.data?.items.map((item) => {
                      const state =
                        item.revokedAt !== null
                          ? "Revoked"
                          : item.acceptedAt !== null
                            ? "Accepted"
                            : new Date(item.expiresAt).getTime() < renderedAt
                              ? "Expired"
                              : "Pending";

                      return (
                        <li
                          key={item.id}
                          className="grid min-h-11 items-center gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_10rem]"
                        >
                          <span className="truncate text-text">
                            {item.email}
                          </span>
                          <span className="text-text-muted">
                            {item.role.toLowerCase()}
                          </span>
                          <span className="text-text-muted">{state}</span>
                          <span className="text-[11px] text-text-muted sm:text-right">
                            Expires {formatDateTime(item.expiresAt)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </OrganizationPage>
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
  const roleDirty =
    roleDraft !== null &&
    user.data !== undefined &&
    roleDraft !== user.data.role;

  return (
    <OrganizationPage
      title={user.data?.displayName ?? "Organization member"}
      description="Review this member's organization access, account state, and recent activity."
    >
      <div className="max-w-5xl space-y-4">
        <Link
          to="/organization/users"
          className="inline-flex min-h-8 items-center rounded-(--cv-radius) text-[12px] font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          ← Members
        </Link>
        <QueryError query={user} />
        <Card>
          <CardHeader className="items-start">
            <div>
              <CardTitle>Member access</CardTitle>
              <p className="mt-0.5 text-[11px] text-text-muted">
                Role changes apply across organization-owned cases and reports.
              </p>
            </div>
            {user.data === undefined ? null : (
              <span
                className={cn(
                  "inline-flex min-h-5 items-center gap-1 rounded-full border px-1.5 text-[11px] font-medium leading-none",
                  user.data.disabled
                    ? "border-danger/40 bg-danger/10 text-danger"
                    : "border-success/40 bg-success/10 text-success",
                )}
              >
                {user.data.disabled ? (
                  <CircleOff aria-hidden className="size-3" />
                ) : (
                  <CheckCircle2 aria-hidden className="size-3" />
                )}
                {user.data.disabled ? "Disabled" : "Active"}
              </span>
            )}
          </CardHeader>
          {user.isError ? null : user.isLoading || user.data === undefined ? (
            <LoadingState label="Loading member access…" />
          ) : (
            <CardBody className="p-0 text-[12px]">
              <section className="flex flex-wrap items-center gap-3 px-4 py-4">
                <Avatar
                  avatarId={user.data.avatarId}
                  userId={user.data.id}
                  label={user.data.displayName}
                  showLabel
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-text-muted">{user.data.email}</p>
                  <p className="mt-1 text-[11px] text-text-muted">
                    Joined {formatDateTime(user.data.joinedAt)}
                  </p>
                </div>
                <span className="inline-flex min-h-5 items-center rounded-full border border-border bg-surface-raised px-1.5 text-[11px] font-medium">
                  {user.data.role.toLowerCase()}
                </span>
              </section>

              {admin ? (
                <section className="grid gap-3 border-t border-border px-4 py-4 md:grid-cols-[minmax(14rem,1fr)_auto] md:items-end">
                  <div className="max-w-sm">
                    <FieldDescription>
                      Controls which organization records and administration
                      actions this member can access.
                    </FieldDescription>
                    <div className="mt-2">
                      <OrganizationRolePicker
                        value={
                          (roleDraft ??
                            user.data.role) as OrganizationUser["role"]
                        }
                        onChange={setRoleDraft}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button
                      variant={roleDirty ? "primary" : "secondary"}
                      loading={update.isPending && roleDirty}
                      disabled={!roleDirty || update.isPending}
                      title={
                        roleDirty ? undefined : "Choose a different role first."
                      }
                      onClick={() =>
                        update.mutate(
                          {
                            role: roleDraft as OrganizationUser["role"],
                          },
                          { onSuccess: () => setRoleDraft(null) },
                        )
                      }
                    >
                      Save role
                    </Button>
                    <Button
                      variant={user.data.disabled ? "secondary" : "danger"}
                      disabled={update.isPending}
                      onClick={() =>
                        update.mutate({ disabled: !user.data.disabled })
                      }
                    >
                      {user.data.disabled
                        ? "Enable account"
                        : "Disable account"}
                    </Button>
                  </div>
                  <p className="text-[11px] text-text-muted md:col-span-2 md:text-right">
                    Disabling an account blocks future access without removing
                    its audit history.
                  </p>
                </section>
              ) : (
                <p className="border-t border-border px-4 py-3 text-[11px] text-text-muted">
                  Only administrators can change member access.
                </p>
              )}
              {update.error ? (
                <FieldError className="mx-4 mb-4">
                  {update.error.message}
                </FieldError>
              ) : null}
            </CardBody>
          )}
        </Card>
        <Card>
          <CardHeader className="items-start">
            <div>
              <CardTitle>Recent activity</CardTitle>
              <p className="mt-0.5 text-[11px] text-text-muted">
                Audited actions attributed to this member.
              </p>
            </div>
            <span className="text-[11px] tabular-nums text-text-muted">
              {activity.data === undefined
                ? "— events"
                : `${activity.data.items.length} events`}
            </span>
          </CardHeader>
          <QueryError query={activity} className="m-3" />
          {activity.isError ? null : activity.isLoading ||
            activity.data === undefined ? (
            <LoadingState label="Loading recent activity…" />
          ) : (
            <CardBody className="p-0">
              <ul className="divide-y divide-border text-[12px]">
                {activity.data.items.map((event) => (
                  <li
                    key={event.id}
                    className="grid min-h-11 items-center gap-2 px-4 py-2 sm:grid-cols-[11rem_minmax(0,1fr)_9rem]"
                  >
                    <span className="text-[11px] text-text-muted">
                      {formatDateTime(event.occurredAt)}
                    </span>
                    <Mono className="truncate">{event.action}</Mono>
                    <span className="truncate text-[11px] text-text-muted sm:text-right">
                      {event.entityType}
                    </span>
                  </li>
                ))}
              </ul>
              {activity.data.items.length === 0 ? (
                <p className="px-4 py-5 text-[12px] text-text-muted">
                  No activity recorded.
                </p>
              ) : null}
            </CardBody>
          )}
        </Card>
      </div>
    </OrganizationPage>
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
  const [saved, setSaved] = useState(false);
  const name = nameDraft ?? organization.data?.name ?? "";
  const contactName = contactNameDraft ?? organization.data?.contactName ?? "";
  const contactEmail =
    contactEmailDraft ?? organization.data?.contactEmail ?? "";
  const reportFooter =
    reportFooterDraft ?? organization.data?.reportFooter ?? "";
  const normalized = {
    name: name.trim(),
    contactName: contactName.trim().length === 0 ? null : contactName.trim(),
    contactEmail:
      contactEmail.trim().length === 0
        ? null
        : contactEmail.trim().toLowerCase(),
    reportFooter: reportFooter.trim().length === 0 ? null : reportFooter.trim(),
  };
  const emailInvalid =
    normalized.contactEmail !== null &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.contactEmail);
  const invalid = normalized.name.length < 2 || emailInvalid;
  const dirty =
    organization.data !== undefined &&
    (normalized.name !== organization.data.name ||
      normalized.contactName !== organization.data.contactName ||
      normalized.contactEmail !== organization.data.contactEmail ||
      normalized.reportFooter !== organization.data.reportFooter);
  const update = useApiMutation<OrganizationSettings>(
    () => ({
      path: "/v1/organization/settings",
      method: "PATCH",
      body: normalized,
    }),
    () => [["organization", "settings"]],
  );

  const reset = (): void => {
    setNameDraft(null);
    setContactNameDraft(null);
    setContactEmailDraft(null);
    setReportFooterDraft(null);
    setSaved(false);
  };

  return (
    <OrganizationPage
      title="General"
      description="Manage the organization identity and report attribution used across the workspace."
    >
      <div className="max-w-5xl">
        <QueryError query={organization} className="mb-4" />
        {organization.isError ? null : organization.isLoading ||
          organization.data === undefined ? (
          <LoadingState label="Loading organization settings…" />
        ) : (
          <Card>
            <CardHeader className="items-start py-3">
              <div>
                <CardTitle>Identity and attribution</CardTitle>
                <p className="mt-0.5 text-[11px] text-text-muted">
                  These values identify the organization in the application and
                  generated reports.
                </p>
              </div>
              <span className="shrink-0 text-[11px] text-text-muted">
                {admin ? "Administrator access" : "Read only"}
              </span>
            </CardHeader>

            <CardBody className="p-0">
              <section className="grid gap-4 px-4 py-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
                <div>
                  <h3 className="text-[12px] font-semibold">
                    Organization identity
                  </h3>
                  <p className="mt-1 text-[11px] leading-4 text-text-muted">
                    The organization owns every member, case, role, and policy
                    in this workspace.
                  </p>
                </div>
                <div className="max-w-2xl space-y-3">
                  <Avatar
                    avatarId={organization.data.avatarId}
                    label={organization.data.name}
                    seed={organization.data.id}
                    showLabel
                    {...(admin ? { target: "ORGANIZATION" as const } : {})}
                  />
                  <div>
                    <Label htmlFor="organization-name">Organization name</Label>
                    <Input
                      id="organization-name"
                      value={name}
                      disabled={!admin}
                      aria-invalid={normalized.name.length < 2}
                      aria-describedby="organization-name-description"
                      onChange={(event) => {
                        setNameDraft(event.target.value);
                        setSaved(false);
                      }}
                      maxLength={120}
                      className="mt-1"
                    />
                    {normalized.name.length < 2 ? (
                      <FieldError id="organization-name-description">
                        Enter at least two characters.
                      </FieldError>
                    ) : (
                      <FieldDescription id="organization-name-description">
                        Displayed in navigation, invitations, and audit records.
                      </FieldDescription>
                    )}
                  </div>
                </div>
              </section>

              <section className="grid gap-4 border-t border-border px-4 py-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
                <div>
                  <h3 className="text-[12px] font-semibold">
                    Report attribution
                  </h3>
                  <p className="mt-1 text-[11px] leading-4 text-text-muted">
                    Contact details printed on report covers and exports.
                  </p>
                </div>
                <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="organization-contact-name">
                      Contact name
                    </Label>
                    <Input
                      id="organization-contact-name"
                      value={contactName}
                      disabled={!admin}
                      onChange={(event) => {
                        setContactNameDraft(event.target.value);
                        setSaved(false);
                      }}
                      maxLength={120}
                      placeholder="Security team"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="organization-contact-email">
                      Contact email
                    </Label>
                    <Input
                      id="organization-contact-email"
                      type="email"
                      value={contactEmail}
                      disabled={!admin}
                      aria-invalid={emailInvalid}
                      aria-describedby="organization-contact-email-description"
                      onChange={(event) => {
                        setContactEmailDraft(event.target.value);
                        setSaved(false);
                      }}
                      maxLength={320}
                      placeholder="security@example.com"
                      className="mt-1"
                    />
                    {emailInvalid ? (
                      <FieldError id="organization-contact-email-description">
                        Enter a complete email address.
                      </FieldError>
                    ) : null}
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="organization-report-footer">
                      Report identity line
                    </Label>
                    <Input
                      id="organization-report-footer"
                      value={reportFooter}
                      disabled={!admin}
                      aria-describedby="organization-report-footer-description"
                      onChange={(event) => {
                        setReportFooterDraft(event.target.value);
                        setSaved(false);
                      }}
                      maxLength={300}
                      placeholder="Security team · security@example.com"
                      className="mt-1"
                    />
                    <FieldDescription id="organization-report-footer-description">
                      Printed with the organization contact on report covers.
                    </FieldDescription>
                  </div>
                </div>
              </section>
            </CardBody>

            {admin ? (
              <>
                <p className="border-t border-border px-4 py-2 text-[11px] text-warning">
                  Saving organization-wide settings requires a recent
                  authenticator verification.
                </p>
                <SettingsSaveBar
                  dirty={dirty}
                  invalid={invalid}
                  pending={update.isPending}
                  saved={saved}
                  error={update.error?.message ?? null}
                  saveLabel="Save general settings"
                  onReset={reset}
                  onSave={() =>
                    update.mutate(undefined, {
                      onSuccess: () => {
                        reset();
                        setSaved(true);
                      },
                    })
                  }
                />
              </>
            ) : (
              <p className="border-t border-border px-4 py-3 text-[11px] text-text-muted">
                Ask an administrator to change organization-wide settings.
              </p>
            )}
          </Card>
        )}
      </div>
    </OrganizationPage>
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
      mfaRequired: boolean;
      inviteTtlHours: number;
      sessionIdleMinutes: number;
      sessionAbsoluteHours: number;
      recentMfaMinutes: number;
      mcpEnabled: boolean;
    }>
  >({});
  const [saved, setSaved] = useState(false);
  const values = {
    mfaRequired: draft.mfaRequired ?? policy.data?.mfaRequired ?? true,
    inviteTtlHours: draft.inviteTtlHours ?? policy.data?.inviteTtlHours ?? 24,
    sessionIdleMinutes:
      draft.sessionIdleMinutes ?? policy.data?.sessionIdleMinutes ?? 30,
    sessionAbsoluteHours:
      draft.sessionAbsoluteHours ?? policy.data?.sessionAbsoluteHours ?? 12,
    recentMfaMinutes:
      draft.recentMfaMinutes ?? policy.data?.recentMfaMinutes ?? 10,
    mcpEnabled: draft.mcpEnabled ?? policy.data?.mcpEnabled ?? true,
  };
  const invalid = {
    inviteTtlHours: values.inviteTtlHours < 1 || values.inviteTtlHours > 72,
    sessionIdleMinutes:
      values.sessionIdleMinutes < 5 || values.sessionIdleMinutes > 120,
    sessionAbsoluteHours:
      values.sessionAbsoluteHours < 1 || values.sessionAbsoluteHours > 24,
    recentMfaMinutes:
      values.recentMfaMinutes < 5 || values.recentMfaMinutes > 30,
  };
  const hasInvalidValue = Object.values(invalid).some(Boolean);
  const dirty =
    policy.data !== undefined &&
    (values.mfaRequired !== policy.data.mfaRequired ||
      values.inviteTtlHours !== policy.data.inviteTtlHours ||
      values.sessionIdleMinutes !== policy.data.sessionIdleMinutes ||
      values.sessionAbsoluteHours !== policy.data.sessionAbsoluteHours ||
      values.recentMfaMinutes !== policy.data.recentMfaMinutes ||
      values.mcpEnabled !== policy.data.mcpEnabled);
  const update = useApiMutation<OrganizationSecurityPolicy>(
    () => ({
      path: "/v1/organization/security",
      method: "PATCH",
      body: values,
    }),
    () => [["organization", "security"]],
  );

  const setPolicyValue = <K extends keyof typeof values>(
    field: K,
    value: (typeof values)[K],
  ): void => {
    setSaved(false);
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const numberField = ({
    field,
    label,
    description,
    unit,
    min,
    max,
  }: {
    field:
      | "inviteTtlHours"
      | "sessionIdleMinutes"
      | "sessionAbsoluteHours"
      | "recentMfaMinutes";
    label: string;
    description: string;
    unit: string;
    min: number;
    max: number;
  }): React.JSX.Element => (
    <div className="grid gap-3 border-t border-border px-4 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_13rem] sm:items-center">
      <div>
        <Label htmlFor={`organization-policy-${field}`} className="text-text">
          {label}
        </Label>
        <FieldDescription className="max-w-2xl">{description}</FieldDescription>
      </div>
      {admin ? (
        <div>
          <div className="flex items-center gap-2 sm:justify-end">
            <Input
              id={`organization-policy-${field}`}
              type="number"
              min={min}
              max={max}
              step={1}
              value={values[field]}
              aria-invalid={invalid[field]}
              aria-describedby={`organization-policy-${field}-description`}
              onChange={(event) =>
                setPolicyValue(field, Number(event.target.value))
              }
              className="w-24 text-right tabular-nums"
            />
            <span className="w-16 text-[11px] text-text-muted">{unit}</span>
          </div>
          {invalid[field] ? (
            <FieldError
              id={`organization-policy-${field}-description`}
              className="sm:text-right"
            >
              Use {min} to {max} {unit}.
            </FieldError>
          ) : null}
        </div>
      ) : (
        <strong className="text-[12px] tabular-nums sm:text-right">
          {values[field]} {unit}
        </strong>
      )}
    </div>
  );

  return (
    <OrganizationPage
      title="Security & access"
      description="Set the authentication, session, integration, and AI requirements enforced across the organization."
    >
      <div className="space-y-4">
        <QueryError query={policy} />
        {policy.isError ? null : policy.isLoading ||
          policy.data === undefined ? (
          <LoadingState label="Loading organization policy…" />
        ) : (
          <Card>
            <CardHeader className="items-start py-3">
              <div>
                <CardTitle>Security requirements</CardTitle>
                <p className="mt-0.5 text-[11px] text-text-muted">
                  These rules apply to every member and active session.
                </p>
              </div>
              <span className="shrink-0 text-[11px] text-text-muted">
                Updated {formatDateTime(policy.data.updatedAt)}
              </span>
            </CardHeader>

            <CardBody className="p-0">
              <section className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_18rem] sm:items-center">
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-(--cv-radius)",
                      values.mfaRequired
                        ? "bg-success/10 text-success"
                        : "bg-warning/10 text-warning",
                    )}
                  >
                    <LockKeyhole aria-hidden className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[12px] font-semibold">
                        Multi-factor authentication
                      </h3>
                      <span
                        className={cn(
                          "inline-flex min-h-5 items-center gap-1 rounded-full border px-1.5 text-[11px] font-medium leading-none",
                          values.mfaRequired
                            ? "border-success/40 bg-success/10 text-success"
                            : "border-warning/45 bg-warning/10 text-warning",
                        )}
                      >
                        {values.mfaRequired ? (
                          <CheckCircle2 aria-hidden className="size-3" />
                        ) : (
                          <CircleOff aria-hidden className="size-3" />
                        )}
                        {values.mfaRequired ? "Required" : "Optional"}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-text-muted">
                      {values.mfaRequired
                        ? "Members complete a second factor at sign-in and before protected administration actions."
                        : "Members may sign in with a password only. Existing authenticator enrollments are kept."}
                    </p>
                  </div>
                </div>
                {admin ? (
                  <PolicyCheckbox
                    checked={values.mfaRequired}
                    label="Require MFA"
                    description="Applies to every member in this organization."
                    onChange={(checked) =>
                      setPolicyValue("mfaRequired", checked)
                    }
                  />
                ) : (
                  <strong className="text-[12px] sm:text-right">
                    {values.mfaRequired ? "Required" : "Not required"}
                  </strong>
                )}
              </section>

              <section className="border-t border-border">
                <div className="px-4 pb-2 pt-4">
                  <h3 className="text-[12px] font-semibold">
                    Invitations and sessions
                  </h3>
                  <p className="mt-0.5 text-[11px] text-text-muted">
                    Shorter limits reduce exposure but require members to
                    authenticate more often.
                  </p>
                </div>
                {numberField({
                  field: "inviteTtlHours",
                  label: "Invitation lifetime",
                  description:
                    "How long a newly issued organization invitation remains valid.",
                  unit: "hours",
                  min: 1,
                  max: 72,
                })}
                {numberField({
                  field: "sessionIdleMinutes",
                  label: "Idle timeout",
                  description:
                    "Signs a member out after this period without activity.",
                  unit: "minutes",
                  min: 5,
                  max: 120,
                })}
                {numberField({
                  field: "sessionAbsoluteHours",
                  label: "Absolute session limit",
                  description:
                    "Ends a session after this duration, even when the member remains active.",
                  unit: "hours",
                  min: 1,
                  max: 24,
                })}
                {numberField({
                  field: "recentMfaMinutes",
                  label: "Sensitive-action recheck",
                  description:
                    "Sets how recently MFA must have been completed when MFA is required.",
                  unit: "minutes",
                  min: 5,
                  max: 30,
                })}
              </section>

              <section className="border-t border-border px-4 py-4">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_18rem] sm:items-center">
                  <div>
                    <h3 className="text-[12px] font-semibold">
                      User-specific MCP connections
                    </h3>
                    <p className="mt-1 max-w-2xl text-[11px] leading-4 text-text-muted">
                      Turning this off blocks every existing MCP connection on
                      its next request. Interactive desktop sessions continue to
                      work.
                    </p>
                  </div>
                  {admin ? (
                    <PolicyCheckbox
                      checked={values.mcpEnabled}
                      label={
                        values.mcpEnabled
                          ? "Connections allowed"
                          : "Connections blocked"
                      }
                      onChange={(checked) =>
                        setPolicyValue("mcpEnabled", checked)
                      }
                    />
                  ) : (
                    <strong
                      className={cn(
                        "text-[12px] sm:text-right",
                        values.mcpEnabled ? "text-success" : "text-warning",
                      )}
                    >
                      {values.mcpEnabled ? "Allowed" : "Blocked"}
                    </strong>
                  )}
                </div>
              </section>
            </CardBody>

            {admin ? (
              <>
                <p className="border-t border-border px-4 py-2 text-[11px] text-warning">
                  {values.mfaRequired === false && policy.data.mfaRequired
                    ? "Disabling MFA allows password-only sign-in for every member. Enrolled authenticators and recovery codes are kept."
                    : values.mfaRequired && !policy.data.mfaRequired
                      ? "Enabling MFA revokes password-only sessions. Members without an authenticator must enroll at their next sign-in."
                      : "Saving stricter session limits can revoke sessions that already exceed the new policy."}{" "}
                  {policy.data.mfaRequired
                    ? "A recent authenticator verification is required."
                    : "This change applies organization-wide."}
                </p>
                <SettingsSaveBar
                  dirty={dirty}
                  invalid={hasInvalidValue}
                  pending={update.isPending}
                  saved={saved}
                  error={update.error?.message ?? null}
                  saveLabel="Save security policy"
                  onReset={() => {
                    setDraft({});
                    setSaved(false);
                  }}
                  onSave={() =>
                    update.mutate(undefined, {
                      onSuccess: () => {
                        setDraft({});
                        setSaved(true);
                      },
                    })
                  }
                />
              </>
            ) : (
              <p className="border-t border-border px-4 py-3 text-[11px] text-text-muted">
                Ask an administrator with a recent authenticator verification to
                change security requirements.
              </p>
            )}
          </Card>
        )}
        <OrganizationAiPolicies />
      </div>
    </OrganizationPage>
  );
}
