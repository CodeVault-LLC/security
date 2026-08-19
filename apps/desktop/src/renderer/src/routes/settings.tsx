import { Link, useRouterState } from "@tanstack/react-router";
import {
  Bot,
  Check,
  KeyRound,
  Laptop,
  Loader2,
  Mail,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import type {
  AiProviderPolicy,
  AiProviderStatus,
  GmailAuthorization,
  MailboxConnection,
  OrganizationUser,
} from "@codevault/contracts";
import { Button, cn, Input, Label } from "@codevault/ui";

import { PageBody } from "../components/app-shell.js";
import { Avatar } from "../components/avatar.js";
import { QueryError } from "../components/query-boundary.js";
import { useAiProviderPreference } from "../hooks/use-ai-provider-preference.js";
import { useTheme } from "../hooks/use-theme.js";
import {
  configuredAiProviderStatuses,
  normalizeAiProviderStatuses,
} from "../lib/ai-providers.js";
import { queryKeys, useApiMutation, useApiQuery } from "../lib/api.js";
import { bridge } from "../lib/bridge.js";
import { formatDateTime } from "../lib/dates.js";
import { useSession } from "../lib/session.js";

const SETTINGS_GROUPS = [
  {
    label: "Account",
    items: [
      { to: "/settings/profile", label: "Profile" },
      { to: "/settings/security", label: "Security" },
    ],
  },
  {
    label: "Application",
    items: [
      { to: "/settings/appearance", label: "Appearance" },
      { to: "/settings/ai", label: "AI" },
      { to: "/settings/mail", label: "Mail" },
    ],
  },
] as const;

function SettingsNav(): React.JSX.Element {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <nav
      aria-label="Settings"
      className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1 pb-2 lg:mx-0 lg:flex-col lg:gap-7 lg:overflow-visible lg:border-b-0 lg:px-0 lg:pb-0"
    >
      {SETTINGS_GROUPS.map((group) => (
        <div key={group.label} className="contents lg:block">
          <p className="mb-1 hidden px-2 text-[11px] font-medium text-text-muted lg:block">
            {group.label}
          </p>
          <div className="contents lg:flex lg:flex-col lg:gap-0.5">
            {group.items.map((item) => {
              const active = pathname === item.to;

              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-10 shrink-0 items-center rounded-(--cv-radius) px-3 text-[13px] font-medium",
                    "transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100",
                    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
                    active
                      ? "bg-surface-hover text-text"
                      : "text-text-muted hover:bg-surface-hover hover:text-text",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function PersonalPage(props: {
  title: string;
  description: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <PageBody className="bg-background [scrollbar-gutter:stable]">
        <div className="mx-auto grid max-w-6xl gap-8 py-2 lg:grid-cols-[176px_minmax(0,780px)] lg:gap-14 lg:py-5">
          <aside className="lg:sticky lg:top-5 lg:self-start">
            <h1 className="mb-5 text-balance text-[18px] font-semibold tracking-[-0.02em]">
              Settings
            </h1>
            <SettingsNav />
          </aside>
          <div className="min-w-0" aria-labelledby="settings-page-title">
            <header className="pb-7 lg:pt-0.5">
              <h2
                id="settings-page-title"
                className="text-balance text-[20px] font-semibold tracking-[-0.02em]"
              >
                {props.title}
              </h2>
              <p className="mt-1.5 max-w-[68ch] text-pretty text-[13px] leading-5 text-text-muted">
                {props.description}
              </p>
            </header>
            <div>{props.children}</div>
          </div>
        </div>
      </PageBody>
    </div>
  );
}

function SettingsSection(props: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="border-t border-border py-7">
      <h3 id={titleId} className="text-[14px] font-semibold">
        {props.title}
      </h3>
      <div className="mt-4 min-w-0">{props.children}</div>
    </section>
  );
}

function InlineDisclosure(props: {
  open: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      data-inline-disclosure
      data-state={props.open ? "open" : "closed"}
      aria-hidden={!props.open}
      inert={!props.open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
        "motion-reduce:transition-[opacity] motion-reduce:duration-100",
        props.open
          ? "grid-rows-[1fr] opacity-100"
          : "pointer-events-none grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="min-h-0 overflow-hidden">{props.children}</div>
    </div>
  );
}

function RefreshStatus({ label }: { label: string }): React.JSX.Element {
  return (
    <p
      role="status"
      className="flex items-center gap-1.5 text-[11px] text-text-muted"
    >
      <RefreshCw
        aria-hidden
        className="size-3 animate-spin motion-reduce:animate-none"
      />
      {label}
    </p>
  );
}

function LoadingLine({ label }: { label: string }): React.JSX.Element {
  return (
    <p
      role="status"
      className="flex min-h-10 items-center gap-2 text-[12px] text-text-muted"
    >
      <Loader2
        aria-hidden
        className="size-4 animate-spin motion-reduce:animate-none"
      />
      {label}
    </p>
  );
}

export function PersonalProfileRoute(): React.JSX.Element {
  const user = useSession((state) => state.user);
  const profile = useApiQuery<OrganizationUser>(
    ["organization", "users", user?.id],
    `/v1/organization/users/${user?.id ?? "00000000-0000-0000-0000-000000000000"}`,
    { enabled: user !== null },
  );
  const [draft, setDraft] = useState<string | null>(null);
  const savedName = profile.data?.displayName ?? user?.displayName ?? "";
  const displayName = draft ?? savedName;
  const trimmedName = displayName.trim();
  const profileIsDirty = draft !== null && trimmedName !== savedName.trim();
  const profileIsValid = trimmedName.length >= 2;
  const displayNameHint = "At least 2 characters.";
  const update = useApiMutation<{ displayName: string }>(
    () => ({
      path: "/v1/settings/profile",
      method: "PATCH",
      body: { displayName: trimmedName },
    }),
    () => [["organization", "users"]],
  );

  return (
    <PersonalPage
      title="Profile"
      description="Update how your name and photo appear. Email and role are managed by an administrator."
    >
      <SettingsSection title="Profile photo">
        <Avatar
          avatarId={profile.data?.avatarId ?? null}
          {...((profile.data?.id ?? user?.id)
            ? { userId: profile.data?.id ?? user!.id }
            : {})}
          label={displayName || "User"}
          target="USER"
        />
      </SettingsSection>

      <SettingsSection title="Personal details">
        {profile.error ? <QueryError query={profile} className="mb-3" /> : null}
        {profile.isLoading && profile.data === undefined ? (
          <LoadingLine label="Loading profile details…" />
        ) : (
          <div className="max-w-lg">
            <Label htmlFor="personal-display-name">Display name</Label>
            <Input
              id="personal-display-name"
              className="mt-1.5 h-10"
              value={displayName}
              aria-describedby={
                profileIsValid ? undefined : "personal-display-name-hint"
              }
              onChange={(event) => {
                update.reset();
                setDraft(event.target.value);
              }}
            />
            {profileIsValid ? null : (
              <p
                id="personal-display-name-hint"
                className="mt-1.5 text-pretty text-[11px] leading-4 text-danger"
              >
                {displayNameHint}
              </p>
            )}

            <dl className="mt-5 divide-y divide-border border-y border-border text-[13px]">
              <div className="grid gap-1 py-3 sm:grid-cols-[112px_minmax(0,1fr)]">
                <dt className="text-text-muted">Email</dt>
                <dd className="break-words sm:text-right">
                  {user?.email ?? "Unavailable"}
                </dd>
              </div>
              <div className="grid gap-1 py-3 sm:grid-cols-[112px_minmax(0,1fr)]">
                <dt className="text-text-muted">Organization role</dt>
                <dd className="capitalize sm:text-right">
                  {user?.role.toLowerCase() ?? "Unavailable"}
                </dd>
              </div>
            </dl>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                className="h-10 px-4"
                loading={update.isPending}
                disabled={!profileIsValid || !profileIsDirty}
                aria-describedby={
                  profileIsValid ? undefined : "personal-display-name-hint"
                }
                onClick={() =>
                  update.mutate(undefined, {
                    onSuccess: (result) => {
                      setDraft(result.displayName);
                      useSession.setState((state) => ({
                        user:
                          state.user === null
                            ? null
                            : {
                                ...state.user,
                                displayName: result.displayName,
                              },
                      }));
                    },
                  })
                }
              >
                Save profile
              </Button>
              {profile.isFetching && profile.data !== undefined ? (
                <RefreshStatus label="Refreshing profile…" />
              ) : null}
            </div>
            {update.isSuccess ? (
              <p
                role="status"
                className="mt-3 flex items-center gap-1.5 text-[12px] text-success"
              >
                <Check aria-hidden className="size-3.5" />
                Profile saved.
              </p>
            ) : null}
            {update.error ? (
              <p role="alert" className="mt-3 text-[12px] text-danger">
                {update.error.message} Your changes are still here. Try saving
                again.
              </p>
            ) : null}
          </div>
        )}
      </SettingsSection>
    </PersonalPage>
  );
}

const THEMES = [
  {
    value: "system",
    label: "System",
  },
  {
    value: "light",
    label: "Light",
  },
  {
    value: "dark",
    label: "Dark",
  },
] as const;

const ACCENTS = [
  {
    value: "default",
    label: "Default",
    swatches: ["oklch(72% 0.17 255)", "oklch(51% 0.2 285)"],
  },
  {
    value: "ocean",
    label: "Ocean",
    swatches: ["oklch(76% 0.12 215)", "oklch(52% 0.12 215)"],
  },
  {
    value: "ember",
    label: "Ember",
    swatches: ["oklch(75% 0.15 55)", "oklch(56% 0.16 48)"],
  },
  {
    value: "iris",
    label: "Iris",
    swatches: ["oklch(76% 0.15 292)", "oklch(53% 0.17 292)"],
  },
] as const;

function ColorSchemePreview({
  value,
}: {
  value: (typeof THEMES)[number]["value"];
}): React.JSX.Element {
  const light = value === "light";
  return (
    <span
      aria-hidden
      className={cn(
        "relative block h-24 overflow-hidden rounded-(--cv-radius) border",
        light ? "border-black/10 bg-[#f5f7fa]" : "border-white/10 bg-[#111820]",
        value === "system" &&
          "border-black/10 bg-[linear-gradient(90deg,#f5f7fa_0_50%,#111820_50%_100%)]",
      )}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-[29%] border-r",
          light
            ? "border-black/10 bg-[#e4ebf2]"
            : "border-white/10 bg-[#17232e]",
          value === "system" && "border-black/10 bg-[#e4ebf2]",
        )}
      >
        <span className="absolute left-2 top-3 h-1.5 w-8 rounded-full bg-sky-400/35" />
        <span className="absolute left-2 top-7 h-1.5 w-6 rounded-full bg-sky-400/20" />
        <span className="absolute left-2 top-11 h-1.5 w-7 rounded-full bg-sky-400/20" />
      </span>
      <span
        className={cn(
          "absolute left-[37%] top-4 h-2 w-[34%] rounded-full",
          light ? "bg-black/14" : "bg-white/16",
          value === "system" && "bg-black/14",
        )}
      />
      <span
        className={cn(
          "absolute left-[37%] top-8 h-1.5 w-[24%] rounded-full",
          light ? "bg-black/9" : "bg-white/10",
          value === "system" && "bg-black/9",
        )}
      />
      <span
        className={cn(
          "absolute bottom-3 left-[36%] right-3 h-4 rounded-full border",
          light ? "border-black/10 bg-white/70" : "border-white/10 bg-white/3",
          value === "system" && "border-white/10 bg-white/3",
        )}
      >
        <span className="absolute right-1 top-1/2 size-2 -translate-y-1/2 rounded-full bg-accent" />
      </span>
      {value === "system" ? (
        <span className="absolute inset-y-0 left-1/2 w-px bg-black/15" />
      ) : null}
    </span>
  );
}

export function PersonalAppearanceRoute(): React.JSX.Element {
  const {
    preference,
    setPreference,
    accent,
    setAccent,
    reduceMotion,
    setReduceMotion,
  } = useTheme();

  return (
    <PersonalPage
      title="Appearance"
      description="Choose how CodeVault looks and moves on this device."
    >
      <SettingsSection title="Color scheme">
        <fieldset>
          <legend className="sr-only">Color scheme</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {THEMES.map((theme) => {
              const selected = preference === theme.value;

              return (
                <label
                  key={theme.value}
                  className={cn(
                    "group relative cursor-pointer rounded-xl border p-2",
                    "transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
                    selected
                      ? "border-accent bg-accent/6 shadow-[0_0_0_1px_var(--cv-accent)]"
                      : "border-border bg-surface hover:border-border-strong hover:bg-surface-raised",
                  )}
                >
                  <input
                    type="radio"
                    name="color-theme"
                    value={theme.value}
                    checked={selected}
                    className="peer sr-only"
                    onChange={() => setPreference(theme.value)}
                  />
                  <span className="absolute inset-0 rounded-xl peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus" />
                  <ColorSchemePreview value={theme.value} />
                  <span className="mt-2 flex min-h-6 items-center justify-between px-1 text-[13px] font-medium">
                    {theme.label}
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-4 items-center justify-center rounded-full border",
                        selected
                          ? "border-accent bg-accent text-accent-contrast"
                          : "border-border-strong",
                      )}
                    >
                      {selected ? <Check className="size-2.5" /> : null}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </SettingsSection>

      <SettingsSection title="Accent color">
        <fieldset>
          <legend className="sr-only">Accent color</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {ACCENTS.map((option) => {
              const selected = accent === option.value;

              return (
                <label
                  key={option.value}
                  className={cn(
                    "relative flex min-h-20 cursor-pointer items-center gap-4 rounded-xl border px-4 py-3",
                    "transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
                    selected
                      ? "border-accent bg-accent/6 shadow-[0_0_0_1px_var(--cv-accent)]"
                      : "border-border bg-surface hover:border-border-strong hover:bg-surface-raised",
                  )}
                >
                  <input
                    type="radio"
                    name="accent-color"
                    value={option.value}
                    checked={selected}
                    className="peer sr-only"
                    onChange={() => setAccent(option.value)}
                  />
                  <span className="absolute inset-0 rounded-xl peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus" />
                  <span className="flex -space-x-2" aria-hidden>
                    {option.swatches.map((swatch) => (
                      <span
                        key={swatch}
                        className="size-9 rounded-full outline outline-2 -outline-offset-1 outline-surface"
                        style={{ backgroundColor: swatch }}
                      />
                    ))}
                  </span>
                  <span className="flex-1 text-[13px] font-medium">
                    {option.label}
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-4 items-center justify-center rounded-full border",
                      selected
                        ? "border-accent bg-accent text-accent-contrast"
                        : "border-border-strong",
                    )}
                  >
                    {selected ? <Check className="size-2.5" /> : null}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </SettingsSection>

      <SettingsSection title="Motion">
        <div className="flex min-h-12 items-center justify-between gap-4 border-y border-border py-2">
          <span className="text-[13px] font-medium">Reduce motion</span>
          <button
            type="button"
            role="switch"
            aria-label="Reduce motion"
            aria-checked={reduceMotion}
            className="group flex min-h-10 min-w-14 items-center justify-center rounded-(--cv-radius) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
            onClick={() => setReduceMotion(!reduceMotion)}
          >
            <span
              aria-hidden
              className={cn(
                "relative h-5 w-9 rounded-full transition-[background-color] duration-150 ease-out motion-reduce:transition-none",
                reduceMotion ? "bg-accent" : "bg-surface-hover",
              )}
            >
              <span
                className={cn(
                  "absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform duration-150 ease-out motion-reduce:transition-none",
                  reduceMotion && "translate-x-4",
                )}
              />
            </span>
          </button>
        </div>
      </SettingsSection>
    </PersonalPage>
  );
}

function providerReadiness(
  provider: AiProviderStatus,
  policy: AiProviderPolicy | undefined,
): { label: string; tone: "success" | "warning" | "danger" } {
  if (!provider.available) {
    return { label: "Not detected", tone: "danger" };
  }

  if (policy === undefined) {
    return { label: "Policy unavailable", tone: "warning" };
  }

  if (!policy.enabled) {
    return { label: "Disabled by organization", tone: "warning" };
  }

  if (policy.allowedModels.length === 0) {
    return { label: "No models allowed", tone: "warning" };
  }

  if (policy.allowedEfforts.length === 0) {
    return { label: "No effort levels allowed", tone: "warning" };
  }

  return { label: "Ready", tone: "success" };
}

export function PersonalAiRoute(): React.JSX.Element {
  const user = useSession((state) => state.user);
  const { providerId, setProviderId } = useAiProviderPreference();
  const [providers, setProviders] = useState<AiProviderStatus[] | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const policies = useApiQuery<{ items: AiProviderPolicy[] }>(
    queryKeys.aiPolicies,
    "/v1/ai/policies",
  );

  const loadProviders = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    setProviderError(null);

    try {
      const statuses = await bridge().ai.providers();
      setProviders(normalizeAiProviderStatuses(statuses));
    } catch {
      setProviderError(
        "CodeVault could not inspect the local AI providers on this device.",
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void bridge()
      .ai.providers()
      .then((statuses) => {
        if (!cancelled) {
          setProviders(normalizeAiProviderStatuses(statuses));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProviderError(
            "CodeVault could not inspect the local AI providers on this device.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const configuredProviders = configuredAiProviderStatuses(
    providers ?? [],
    policies.data?.items ?? [],
  );
  const preferredProviderReady =
    providerId === null ||
    configuredProviders.some((provider) => provider.providerId === providerId);

  return (
    <PersonalPage
      title="AI"
      description="Choose a local provider and see what this organization permits."
    >
      <SettingsSection title="Default provider">
        {policies.error ? (
          <QueryError query={policies} className="mb-3" />
        ) : null}
        {policies.data === undefined && policies.error === null ? (
          <LoadingLine label="Loading AI policy…" />
        ) : (
          <fieldset>
            <legend className="sr-only">Default AI provider</legend>
            <div className="divide-y divide-border border-y border-border">
              <label className="flex min-h-12 cursor-pointer items-center gap-3 px-2 py-2 hover:bg-surface-hover">
                <input
                  type="radio"
                  name="default-ai-provider"
                  checked={providerId === null}
                  className="size-4 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  onChange={() => setProviderId(null)}
                />
                <span className="text-[13px] font-medium">Automatic</span>
                <span className="ml-auto text-[11px] text-text-muted">
                  First ready provider
                </span>
              </label>
              {(providers ?? []).map((provider) => {
                const ready = configuredProviders.some(
                  (item) => item.providerId === provider.providerId,
                );

                return (
                  <label
                    key={provider.providerId}
                    className={cn(
                      "flex min-h-12 items-center gap-3 px-2 py-2",
                      ready
                        ? "cursor-pointer hover:bg-surface-hover"
                        : "cursor-not-allowed opacity-55",
                    )}
                  >
                    <input
                      type="radio"
                      name="default-ai-provider"
                      value={provider.providerId}
                      checked={providerId === provider.providerId}
                      disabled={!ready}
                      className="size-4 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                      onChange={() => setProviderId(provider.providerId)}
                    />
                    <span className="text-[13px] font-medium">
                      {provider.displayName}
                    </span>
                    <span className="ml-auto text-[11px] text-text-muted">
                      {ready ? "Ready" : "Unavailable"}
                    </span>
                  </label>
                );
              })}
            </div>
            {preferredProviderReady ? null : (
              <p role="status" className="mt-3 text-[12px] text-warning">
                Your preferred provider is unavailable. CodeVault will use the
                first ready provider until it returns.
              </p>
            )}
          </fieldset>
        )}
      </SettingsSection>

      <SettingsSection title="Local integrations">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-pretty text-[12px] text-text-muted">
            Detection runs on this device. Organization policy still controls
            which providers may receive case data.
          </p>
          <Button
            variant="secondary"
            className="h-10 shrink-0 px-3"
            loading={refreshing}
            onClick={() => void loadProviders()}
          >
            <RefreshCw aria-hidden className="size-3.5" />
            Check again
          </Button>
        </div>

        {providerError ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 border-y border-danger/35 py-4 text-[12px] text-danger"
          >
            <p>{providerError}</p>
            <button
              type="button"
              className="min-h-10 shrink-0 underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              onClick={() => void loadProviders()}
            >
              Try again
            </button>
          </div>
        ) : null}

        {providers === null && providerError === null ? (
          <LoadingLine label="Detecting local AI providers…" />
        ) : null}

        {providers?.length === 0 ? (
          <div className="border-y border-border py-5">
            <p className="text-[13px] font-medium">
              No supported providers were returned.
            </p>
            <p className="mt-1 text-[11px] text-text-muted">
              Check again after installing a supported local provider.
            </p>
          </div>
        ) : null}

        {providers && providers.length > 0 ? (
          <ul className="divide-y divide-border border-y border-border">
            {providers.map((provider) => {
              const policy = policies.data?.items.find(
                (item) => item.providerId === provider.providerId,
              );
              const readiness = providerReadiness(provider, policy);

              return (
                <li key={provider.providerId} className="flex gap-3 py-4">
                  <Bot
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-text-muted"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <p className="text-[13px] font-medium">
                        {provider.displayName}
                      </p>
                      <span
                        className={cn(
                          "flex items-center gap-1.5 text-[11px] font-semibold",
                          readiness.tone === "success" && "text-success",
                          readiness.tone === "warning" && "text-warning",
                          readiness.tone === "danger" && "text-danger",
                        )}
                      >
                        <span className="size-1.5 rounded-full bg-current" />
                        {readiness.label}
                      </span>
                    </div>
                    <p className="mt-1 text-pretty text-[11px] leading-4 text-text-muted">
                      {provider.available
                        ? `Version ${provider.version ?? "unavailable"}`
                        : (provider.detail ??
                          "The provider executable was not found on this device.")}
                    </p>
                    {provider.executablePath ? (
                      <code className="mt-1 block break-all font-mono text-[11px] text-text-muted">
                        {provider.executablePath}
                      </code>
                    ) : null}
                    {policy && policy.allowedModels.length > 0 ? (
                      <p className="mt-2 text-pretty text-[11px] leading-4 text-text-muted">
                        Allowed models: {policy.allowedModels.join(", ")}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}

        <p className="mt-4 text-[12px] text-text-muted">
          {user?.role === "ADMIN"
            ? "Organization-wide access rules are managed in Organization Security."
            : "An administrator manages organization-wide AI access rules."}{" "}
          <Link
            to="/organization/security"
            className="font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            View organization policy
          </Link>
        </p>
      </SettingsSection>
    </PersonalPage>
  );
}

interface SessionItem {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
  current: boolean;
}

interface SecuritySummary {
  totp: {
    status: "ACTIVE" | "NOT_CONFIGURED";
    enrolledAt: string | null;
  };
  recoveryCodes: {
    remaining: number;
  };
}

function SecuritySummaryView(props: {
  security: ReturnType<typeof useApiQuery<SecuritySummary>>;
}): React.JSX.Element {
  const { security } = props;

  if (security.error && security.data === undefined) {
    return <QueryError query={security} />;
  }

  if (security.data === undefined) {
    return <LoadingLine label="Checking account protection…" />;
  }

  const totpActive = security.data.totp.status === "ACTIVE";
  const recoveryCodes = security.data.recoveryCodes.remaining;
  const lowRecoveryCodes = recoveryCodes <= 2;
  const authenticatorDetail = totpActive
    ? security.data.totp.enrolledAt
      ? `Required at sign-in. Enrolled ${formatDateTime(security.data.totp.enrolledAt)}.`
      : "Required at sign-in. Enrollment date unavailable."
    : "No active authenticator was found for this account.";

  return (
    <div>
      {security.error ? <QueryError query={security} className="mb-3" /> : null}
      {security.isFetching ? (
        <div className="mb-2">
          <RefreshStatus label="Refreshing security status…" />
        </div>
      ) : null}
      <dl className="divide-y divide-border border-y border-border">
        <div className="flex gap-3 py-4">
          <Smartphone
            aria-hidden
            className={cn(
              "mt-0.5 size-4 shrink-0",
              totpActive ? "text-success" : "text-danger",
            )}
          />
          <div className="min-w-0 flex-1">
            <dt className="text-[13px] font-medium">Authenticator app</dt>
            <dd className="mt-0.5 text-pretty text-[11px] leading-4 text-text-muted">
              {authenticatorDetail}
            </dd>
          </div>
          <dd
            className={cn(
              "flex shrink-0 items-center gap-1.5 text-[12px] font-semibold",
              totpActive ? "text-success" : "text-danger",
            )}
          >
            <span className="size-1.5 rounded-full bg-current" />
            {totpActive ? "Active" : "Not set up"}
          </dd>
        </div>

        <div className="flex gap-3 py-4">
          <KeyRound
            aria-hidden
            className={cn(
              "mt-0.5 size-4 shrink-0",
              lowRecoveryCodes ? "text-warning" : "text-text-muted",
            )}
          />
          <div className="min-w-0 flex-1">
            <dt className="text-[13px] font-medium">Recovery codes</dt>
            <dd className="mt-0.5 text-pretty text-[11px] leading-4 text-text-muted">
              {recoveryCodes === 0
                ? "No unused recovery codes remain."
                : "Keep unused codes offline."}
            </dd>
          </div>
          <dd
            className={cn(
              "shrink-0 text-[12px] font-semibold tabular-nums",
              recoveryCodes === 0
                ? "text-danger"
                : lowRecoveryCodes
                  ? "text-warning"
                  : "text-text",
            )}
          >
            {recoveryCodes} unused
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function PersonalSecurityRoute(): React.JSX.Element {
  const security = useApiQuery<SecuritySummary>(
    ["settings", "security"],
    "/v1/settings/security",
  );
  const sessions = useApiQuery<{ items: SessionItem[] }>(
    ["settings", "sessions"],
    "/v1/settings/sessions",
  );
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [revokedSession, setRevokedSession] = useState<string | null>(null);
  const revokeReturnFocusId = useRef<string | null>(null);
  const revokeStatusRef = useRef<HTMLParagraphElement>(null);
  const revokeTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const cancelRevokeRefs = useRef(new Map<string, HTMLButtonElement>());
  const passwordIsValid =
    currentPassword.length > 0 && newPassword.length >= 12;
  const changePassword = useApiMutation<{ ok: true }>(
    () => ({
      path: "/v1/settings/password",
      method: "POST",
      body: { currentPassword, newPassword },
    }),
    () => [["settings", "sessions"]],
  );
  const revoke = useApiMutation<{ ok: true }, string>(
    (id) => ({ path: `/v1/settings/sessions/${id}`, method: "DELETE" }),
    () => [["settings", "sessions"]],
  );

  useEffect(() => {
    if (confirmRevokeId !== null) {
      cancelRevokeRefs.current.get(confirmRevokeId)?.focus();
    }
  }, [confirmRevokeId]);

  useEffect(() => {
    if (confirmRevokeId === null && revokeReturnFocusId.current !== null) {
      revokeTriggerRefs.current.get(revokeReturnFocusId.current)?.focus();
      revokeReturnFocusId.current = null;
    }
  }, [confirmRevokeId]);

  useEffect(() => {
    if (revokedSession !== null) {
      revokeStatusRef.current?.focus();
    }
  }, [revokedSession]);

  return (
    <PersonalPage
      title="Security"
      description="Review sign-in protection, your password, and active devices."
    >
      <SettingsSection title="Account protection">
        <SecuritySummaryView security={security} />
      </SettingsSection>

      <SettingsSection title="Password">
        <div className="max-w-lg space-y-4">
          <div>
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              className="mt-1.5 h-10"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => {
                changePassword.reset();
                setCurrentPassword(event.target.value);
              }}
            />
          </div>
          <div>
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              className="mt-1.5 h-10"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              aria-describedby="password-requirement"
              onChange={(event) => {
                changePassword.reset();
                setNewPassword(event.target.value);
              }}
            />
            <p
              id="password-requirement"
              className="mt-1.5 text-pretty text-[11px] leading-4 text-text-muted"
            >
              12 characters minimum.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button
              variant="primary"
              className="h-10 px-4"
              loading={changePassword.isPending}
              disabled={!passwordIsValid}
              aria-describedby="password-consequence"
              onClick={() =>
                changePassword.mutate(undefined, {
                  onSuccess: () => {
                    setCurrentPassword("");
                    setNewPassword("");
                  },
                })
              }
            >
              Change password
            </Button>
            <p
              id="password-consequence"
              className="text-[11px] text-text-muted"
            >
              Signs out other devices.
            </p>
          </div>
          {changePassword.isSuccess ? (
            <p
              role="status"
              className="flex items-center gap-1.5 text-[12px] text-success"
            >
              <Check aria-hidden className="size-3.5" />
              Password changed. Other sessions were signed out.
            </p>
          ) : null}
          {changePassword.error ? (
            <p role="alert" className="text-pretty text-[12px] text-danger">
              {changePassword.error.message} Your passwords were not cleared, so
              you can correct the problem and try again.
            </p>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection title="Signed-in devices">
        {revokedSession ? (
          <p
            ref={revokeStatusRef}
            role="status"
            tabIndex={-1}
            className="mb-3 flex items-center gap-1.5 text-[12px] text-success"
          >
            <Check aria-hidden className="size-3.5" />
            Access removed from {revokedSession}.
          </p>
        ) : null}
        {sessions.error ? (
          <QueryError query={sessions} className="mb-3" />
        ) : null}
        {sessions.data !== undefined && sessions.isFetching ? (
          <div className="mb-2">
            <RefreshStatus label="Refreshing signed-in devices…" />
          </div>
        ) : null}
        {sessions.data === undefined && sessions.error === null ? (
          <LoadingLine label="Loading signed-in devices…" />
        ) : null}
        {sessions.data?.items.length === 0 ? (
          <div className="border-y border-border py-5">
            <p className="text-[13px] font-medium">
              No signed-in devices were returned.
            </p>
            <p className="mt-1 text-pretty text-[11px] leading-4 text-text-muted">
              Refresh the list before making another security change.
            </p>
            <Button
              variant="secondary"
              className="mt-3 h-10"
              loading={sessions.isFetching}
              onClick={() => void sessions.refetch()}
            >
              Refresh devices
            </Button>
          </div>
        ) : null}
        {sessions.data && sessions.data.items.length > 0 ? (
          <ul className="divide-y divide-border border-y border-border">
            {sessions.data.items.map((session) => {
              const confirming = confirmRevokeId === session.id;
              const sessionName =
                session.userAgent ??
                (session.current ? "This device" : "Device");

              return (
                <li key={session.id} className="py-4">
                  <div className="flex items-start gap-3">
                    <Laptop
                      aria-hidden
                      className="mt-0.5 size-4 shrink-0 text-text-muted"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="text-[13px] font-medium">
                          {session.current ? "This device" : "Signed-in device"}
                        </p>
                        {session.current ? (
                          <span className="flex items-center gap-1.5 text-[11px] font-medium text-success">
                            <span className="size-1.5 rounded-full bg-current" />
                            Current session
                          </span>
                        ) : null}
                      </div>
                      <p
                        className="mt-0.5 break-words text-[11px] leading-4 text-text-muted"
                        title={session.userAgent ?? undefined}
                      >
                        {sessionName}
                      </p>
                      <p className="mt-1 text-pretty text-[11px] leading-4 text-text-muted tabular-nums">
                        {session.lastSeenAt
                          ? `Last active ${formatDateTime(session.lastSeenAt)}`
                          : `Created ${formatDateTime(session.createdAt)}`}
                        {` · Expires ${formatDateTime(session.expiresAt)}`}
                      </p>
                    </div>
                    {!session.current && !confirming ? (
                      <Button
                        ref={(node) => {
                          if (node === null) {
                            revokeTriggerRefs.current.delete(session.id);
                          } else {
                            revokeTriggerRefs.current.set(session.id, node);
                          }
                        }}
                        variant="ghost"
                        className="h-10 shrink-0 px-3 text-danger hover:bg-danger/10 hover:text-danger"
                        aria-expanded={confirming}
                        aria-controls={`revoke-confirmation-${session.id}`}
                        onClick={() => {
                          revoke.reset();
                          setRevokedSession(null);
                          setConfirmRevokeId(session.id);
                        }}
                      >
                        Revoke access
                      </Button>
                    ) : null}
                  </div>

                  {session.current ? null : (
                    <InlineDisclosure open={confirming}>
                      <div
                        id={`revoke-confirmation-${session.id}`}
                        role="group"
                        aria-label={`Confirm access removal for ${sessionName}`}
                        className="ml-7 mt-3 border-t border-danger/30 pt-3"
                      >
                        <p className="text-pretty text-[12px] leading-5">
                          Revoke access for {sessionName}? This signs the device
                          out. It can sign in again with valid credentials.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            ref={(node) => {
                              if (node === null) {
                                cancelRevokeRefs.current.delete(session.id);
                              } else {
                                cancelRevokeRefs.current.set(session.id, node);
                              }
                            }}
                            variant="secondary"
                            className="h-10"
                            disabled={revoke.isPending}
                            onClick={() => {
                              revoke.reset();
                              revokeReturnFocusId.current = session.id;
                              setConfirmRevokeId(null);
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            variant="danger"
                            className="h-10 px-3"
                            loading={
                              revoke.isPending &&
                              revoke.variables === session.id
                            }
                            onClick={() =>
                              revoke.mutate(session.id, {
                                onSuccess: () => {
                                  setConfirmRevokeId(null);
                                  setRevokedSession(sessionName);
                                },
                              })
                            }
                          >
                            Revoke device access
                          </Button>
                        </div>
                        {revoke.error ? (
                          <p
                            role="alert"
                            className="mt-2 text-[12px] text-danger"
                          >
                            {revoke.error.message} Access was not removed. Try
                            again or cancel.
                          </p>
                        ) : null}
                      </div>
                    </InlineDisclosure>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
      </SettingsSection>
    </PersonalPage>
  );
}

export function PersonalMailRoute(): React.JSX.Element {
  const [trackReplies, setTrackReplies] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnectId, setConfirmDisconnectId] = useState<string | null>(
    null,
  );
  const [disconnectedMailbox, setDisconnectedMailbox] = useState<string | null>(
    null,
  );
  const disconnectReturnFocusId = useRef<string | null>(null);
  const disconnectStatusRef = useRef<HTMLParagraphElement>(null);
  const disconnectTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const cancelDisconnectRefs = useRef(new Map<string, HTMLButtonElement>());
  const mailConnections = useApiQuery<{ items: MailboxConnection[] }>(
    queryKeys.mailConnections,
    "/v1/mail/connections",
  );
  const connectGmail = useApiMutation<
    GmailAuthorization,
    { enableReplyTracking: boolean }
  >(
    (body) => ({ path: "/v1/mail/gmail/connect", method: "POST", body }),
    () => [queryKeys.mailConnections],
  );
  const disconnectMailbox = useApiMutation<null, { id: string }>(
    ({ id }) => ({ path: `/v1/mail/connections/${id}`, method: "DELETE" }),
    () => [queryKeys.mailConnections],
  );

  useEffect(() => {
    if (confirmDisconnectId !== null) {
      cancelDisconnectRefs.current.get(confirmDisconnectId)?.focus();
    }
  }, [confirmDisconnectId]);

  useEffect(() => {
    if (
      confirmDisconnectId === null &&
      disconnectReturnFocusId.current !== null
    ) {
      disconnectTriggerRefs.current
        .get(disconnectReturnFocusId.current)
        ?.focus();
      disconnectReturnFocusId.current = null;
    }
  }, [confirmDisconnectId]);

  useEffect(() => {
    if (disconnectedMailbox !== null) {
      disconnectStatusRef.current?.focus();
    }
  }, [disconnectedMailbox]);

  const connect = (): void => {
    setError(null);
    connectGmail.mutate(
      { enableReplyTracking: trackReplies },
      {
        onSuccess: (authorization) => {
          void bridge()
            .app.openExternal(authorization.authorizationUrl)
            .then((opened) => {
              if (!opened) {
                setError(
                  "CodeVault could not open the Gmail authorization page. Try connecting again.",
                );
              }
            })
            .catch(() => {
              setError(
                "CodeVault could not open the Gmail authorization page. Try connecting again.",
              );
            });
        },
        onError: (mutationError) => setError(mutationError.message),
      },
    );
  };

  return (
    <PersonalPage
      title="Mail"
      description="Connect Gmail for reviewed disclosures. CodeVault never receives your Google password."
    >
      <SettingsSection title="Gmail connection">
        {disconnectedMailbox ? (
          <p
            ref={disconnectStatusRef}
            role="status"
            tabIndex={-1}
            className="mb-3 flex items-center gap-1.5 text-[12px] text-success"
          >
            <Check aria-hidden className="size-3.5" />
            {disconnectedMailbox} disconnected.
          </p>
        ) : null}
        {mailConnections.error ? (
          <QueryError query={mailConnections} className="mb-3" />
        ) : null}
        {mailConnections.data === undefined &&
        mailConnections.error === null ? (
          <LoadingLine label="Checking Gmail connections…" />
        ) : null}
        {mailConnections.data !== undefined && mailConnections.isFetching ? (
          <div className="mb-2">
            <RefreshStatus label="Refreshing Gmail connections…" />
          </div>
        ) : null}

        {mailConnections.data ? (
          <div>
            {mailConnections.data.items.length === 0 ? (
              <div className="border-y border-border py-4">
                <p className="text-[13px] font-medium">No mailbox connected</p>
                <p className="mt-1 text-pretty text-[11px] leading-4 text-text-muted">
                  Choose the access you need, then connect Gmail.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {mailConnections.data.items.map((connection) => {
                  const confirming = confirmDisconnectId === connection.id;
                  const active = connection.status === "ACTIVE";

                  return (
                    <li key={connection.id} className="py-4">
                      <div className="flex items-start gap-3">
                        <Mail
                          aria-hidden
                          className="mt-0.5 size-4 shrink-0 text-text-muted"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="break-all text-[13px] font-medium">
                              {connection.emailAddress}
                            </p>
                            <span
                              className={cn(
                                "flex items-center gap-1.5 text-[11px] font-medium",
                                active ? "text-success" : "text-warning",
                              )}
                            >
                              <span className="size-1.5 rounded-full bg-current" />
                              {connection.status
                                .toLowerCase()
                                .replaceAll("_", " ")}
                            </span>
                          </div>
                          <p className="mt-0.5 text-pretty text-[11px] leading-4 text-text-muted">
                            {connection.capabilities.includes("TRACK_REPLIES")
                              ? "Can send mail and track replies."
                              : "Can send mail. Reply tracking is off."}
                          </p>
                          {connection.lastSuccessfulSyncAt === null ? null : (
                            <p className="mt-1 text-[11px] text-text-muted tabular-nums">
                              Last synced{" "}
                              {formatDateTime(connection.lastSuccessfulSyncAt)}
                            </p>
                          )}
                          {connection.watchExpiresAt === null ? null : (
                            <p className="mt-1 text-pretty text-[11px] leading-4 text-text-muted tabular-nums">
                              Reply tracking renews before{" "}
                              {formatDateTime(connection.watchExpiresAt)}.
                            </p>
                          )}
                          {connection.errorCategory === null ? null : (
                            <p className="mt-1 text-[11px] text-warning">
                              Connection needs attention:{" "}
                              {connection.errorCategory
                                .toLowerCase()
                                .replaceAll("_", " ")}
                              .
                            </p>
                          )}
                        </div>
                        {!confirming ? (
                          <Button
                            ref={(node) => {
                              if (node === null) {
                                disconnectTriggerRefs.current.delete(
                                  connection.id,
                                );
                              } else {
                                disconnectTriggerRefs.current.set(
                                  connection.id,
                                  node,
                                );
                              }
                            }}
                            variant="ghost"
                            className="h-10 shrink-0 px-3 text-danger hover:bg-danger/10 hover:text-danger"
                            aria-expanded={confirming}
                            aria-controls={`disconnect-confirmation-${connection.id}`}
                            onClick={() => {
                              setError(null);
                              disconnectMailbox.reset();
                              setDisconnectedMailbox(null);
                              setConfirmDisconnectId(connection.id);
                            }}
                          >
                            Disconnect
                          </Button>
                        ) : null}
                      </div>

                      <InlineDisclosure open={confirming}>
                        <div
                          id={`disconnect-confirmation-${connection.id}`}
                          role="group"
                          aria-label={`Confirm disconnecting ${connection.emailAddress}`}
                          className="ml-7 mt-3 border-t border-danger/30 pt-3"
                        >
                          <p className="text-pretty text-[12px] leading-5">
                            Disconnect {connection.emailAddress}? New mail and
                            reply tracking stop. Existing disclosure records
                            stay in CodeVault.
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              ref={(node) => {
                                if (node === null) {
                                  cancelDisconnectRefs.current.delete(
                                    connection.id,
                                  );
                                } else {
                                  cancelDisconnectRefs.current.set(
                                    connection.id,
                                    node,
                                  );
                                }
                              }}
                              variant="secondary"
                              className="h-10"
                              disabled={disconnectMailbox.isPending}
                              onClick={() => {
                                disconnectMailbox.reset();
                                disconnectReturnFocusId.current = connection.id;
                                setConfirmDisconnectId(null);
                              }}
                            >
                              Cancel
                            </Button>
                            <Button
                              variant="danger"
                              className="h-10 px-3"
                              loading={
                                disconnectMailbox.isPending &&
                                disconnectMailbox.variables?.id ===
                                  connection.id
                              }
                              onClick={() =>
                                disconnectMailbox.mutate(
                                  { id: connection.id },
                                  {
                                    onSuccess: () => {
                                      setConfirmDisconnectId(null);
                                      setDisconnectedMailbox(
                                        connection.emailAddress,
                                      );
                                    },
                                  },
                                )
                              }
                            >
                              Disconnect mailbox
                            </Button>
                          </div>
                          {disconnectMailbox.error ? (
                            <p
                              role="alert"
                              className="mt-2 text-[12px] text-danger"
                            >
                              {disconnectMailbox.error.message} The mailbox is
                              still connected. Try again or cancel.
                            </p>
                          ) : null}
                        </div>
                      </InlineDisclosure>
                    </li>
                  );
                })}
              </ul>
            )}

            <label className="mt-5 flex min-h-11 cursor-pointer items-start gap-3 py-1">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                checked={trackReplies}
                onChange={(event) => {
                  setError(null);
                  connectGmail.reset();
                  setTrackReplies(event.target.checked);
                }}
              />
              <span>
                <span className="block text-[13px] font-medium">
                  Track replies to CodeVault-created threads
                </span>
                <span className="mt-0.5 block text-pretty text-[11px] leading-4 text-text-muted">
                  Requests Gmail read-only access. Enable it only if your
                  organization has approved that access.
                </span>
              </span>
            </label>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                className="h-10 px-4"
                loading={connectGmail.isPending}
                onClick={connect}
              >
                {mailConnections.data.items.length
                  ? "Connect another Gmail account"
                  : "Connect Gmail"}
              </Button>
              <Button
                variant="ghost"
                className="h-10 px-3"
                loading={mailConnections.isFetching}
                onClick={() => void mailConnections.refetch()}
              >
                Refresh status
              </Button>
            </div>
            {error === null ? null : (
              <p
                role="alert"
                className="mt-3 text-pretty text-[12px] text-danger"
              >
                {error}
              </p>
            )}
          </div>
        ) : null}
      </SettingsSection>
    </PersonalPage>
  );
}
