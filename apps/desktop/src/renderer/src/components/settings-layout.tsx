import { Link, useRouterState } from "@tanstack/react-router";
import {
  Bot,
  Building2,
  KeyRound,
  Mail,
  Palette,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useId, type ReactNode } from "react";

import { cn } from "@codevault/ui";

type SettingsDestination =
  | "/settings/profile"
  | "/settings/security"
  | "/settings/appearance"
  | "/settings/ai"
  | "/settings/mail"
  | "/organization/users"
  | "/organization/access-review"
  | "/organization/settings"
  | "/organization/security";

interface SettingsNavItem {
  to: SettingsDestination;
  label: string;
  icon: ReactNode;
  matchPrefix?: boolean;
}

interface SettingsNavGroup {
  label: string;
  items: readonly SettingsNavItem[];
}

const PERSONAL_SETTINGS_GROUPS: readonly SettingsNavGroup[] = [
  {
    label: "Account",
    items: [
      {
        to: "/settings/profile",
        label: "Profile",
        icon: <UserRound aria-hidden />,
      },
      {
        to: "/settings/security",
        label: "Security",
        icon: <ShieldCheck aria-hidden />,
      },
    ],
  },
  {
    label: "Application",
    items: [
      {
        to: "/settings/appearance",
        label: "Appearance",
        icon: <Palette aria-hidden />,
      },
      { to: "/settings/ai", label: "AI", icon: <Bot aria-hidden /> },
      { to: "/settings/mail", label: "Mail", icon: <Mail aria-hidden /> },
    ],
  },
];

const ORGANIZATION_SETTINGS_GROUPS: readonly SettingsNavGroup[] = [
  {
    label: "Organization",
    items: [
      {
        to: "/organization/users",
        label: "Members",
        icon: <UsersRound aria-hidden />,
        matchPrefix: true,
      },
      {
        to: "/organization/access-review",
        label: "Access review",
        icon: <KeyRound aria-hidden />,
      },
      {
        to: "/organization/settings",
        label: "General",
        icon: <Building2 aria-hidden />,
      },
      {
        to: "/organization/security",
        label: "Security & access",
        icon: <ShieldCheck aria-hidden />,
      },
    ],
  },
];

function SettingsNavigation({
  groups,
}: {
  groups: readonly SettingsNavGroup[];
}): React.JSX.Element {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <nav
      aria-label="Settings sections"
      className="flex gap-1 overflow-x-auto border-b border-border px-3 lg:block lg:overflow-visible lg:border-b-0 lg:px-0"
    >
      {groups.map((group) => (
        <div key={group.label} className="contents lg:mb-6 lg:block">
          <p className="mb-1 hidden px-3 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted lg:block">
            {group.label}
          </p>
          <div className="contents lg:flex lg:flex-col lg:gap-0.5">
            {group.items.map((item) => {
              const active =
                pathname === item.to ||
                (item.matchPrefix === true &&
                  pathname.startsWith(`${item.to}/`));

              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-10 shrink-0 items-center gap-2 px-3 text-[12px] font-medium lg:rounded-(--cv-radius) lg:pr-2",
                    "transition-[background-color,color] duration-100 hover:bg-surface-hover hover:text-text",
                    "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus",
                    "[&>svg]:size-4 [&>svg]:shrink-0",
                    active
                      ? "bg-surface-hover text-text [&>svg]:text-accent"
                      : "text-text-muted",
                  )}
                >
                  {item.icon}
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

function SettingsPage({
  areaTitle,
  areaDescription,
  title,
  description,
  groups,
  contentClassName,
  children,
}: {
  areaTitle: string;
  areaDescription: string;
  title: string;
  description: string;
  groups: readonly SettingsNavGroup[];
  contentClassName?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-background lg:grid-cols-[224px_minmax(0,1fr)] lg:grid-rows-1">
      <aside className="shrink-0 border-b border-border bg-surface lg:border-b-0 lg:border-r">
        <div className="border-b border-border px-5 py-4 lg:border-b-0 lg:px-4 lg:pb-5 lg:pt-5">
          <h1 className="text-balance text-[14px] font-semibold">
            {areaTitle}
          </h1>
          <p className="mt-1 hidden text-pretty text-[11px] leading-4 text-text-muted lg:block">
            {areaDescription}
          </p>
        </div>
        <SettingsNavigation groups={groups} />
      </aside>

      <main className="min-h-0 overflow-y-auto [scrollbar-gutter:stable]">
        <div
          className={cn(
            "mx-auto w-full max-w-6xl px-5 pb-10 pt-6",
            contentClassName,
          )}
        >
          <header className="pb-6">
            <h2 className="text-balance text-[19px] font-semibold leading-tight tracking-[-0.02em]">
              {title}
            </h2>
            <p className="mt-1.5 max-w-[72ch] text-pretty text-[13px] leading-5 text-text-muted">
              {description}
            </p>
          </header>
          {children}
        </div>
      </main>
    </div>
  );
}

export function PersonalSettingsPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <SettingsPage
      areaTitle="Personal settings"
      areaDescription="Your account, security, and application preferences."
      title={title}
      description={description}
      groups={PERSONAL_SETTINGS_GROUPS}
      contentClassName="max-w-5xl"
    >
      {children}
    </SettingsPage>
  );
}

export function OrganizationSettingsPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <SettingsPage
      areaTitle="Organization"
      areaDescription="Members, organization identity, and shared access policy."
      title={title}
      description={description}
      groups={ORGANIZATION_SETTINGS_GROUPS}
    >
      {children}
    </SettingsPage>
  );
}

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}): React.JSX.Element {
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="border-t border-border py-6">
      <div className="max-w-[72ch]">
        <h3 id={titleId} className="text-[14px] font-semibold">
          {title}
        </h3>
        {description === undefined ? null : (
          <p className="mt-1 text-pretty text-[11px] leading-4 text-text-muted">
            {description}
          </p>
        )}
      </div>
      <div className="mt-4 min-w-0">{children}</div>
    </section>
  );
}
