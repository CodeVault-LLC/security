import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  Bell,
  BriefcaseBusiness,
  Building2,
  Boxes,
  ChevronUp,
  FileText,
  Home,
  LogOut,
  Mail,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Send,
  Users,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@codevault/ui";
import type { SecurityNotificationInbox } from "@codevault/contracts";

import { bridge } from "../lib/bridge.js";
import { queryKeys, useApiQuery } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { Avatar } from "./avatar.js";

/**
 * The global sidebar.
 *
 * A small set of destinations, not one per database table. Everything else is reached from
 * the thing it belongs to — evidence from a case, scores from a finding —
 * because a flat list of every concept is how a research tool turns into an
 * enterprise console.
 *
 * Metrics is the tenth, and earns its place by not fitting anywhere else: the
 * deep analytics are workspace-wide rather than belonging to any one case,
 * asset or finding, and folding them into the dashboard would push the
 * operational lists off the first screen.
 */

interface NavigationItem {
  to: string;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  badge?: number;
}

const PRIMARY_ITEMS: NavigationItem[] = [
  { to: "/", label: "Home", icon: <Home aria-hidden className="size-4" /> },
  {
    to: "/cases",
    label: "Cases",
    icon: <BriefcaseBusiness aria-hidden className="size-4" />,
  },
  {
    to: "/findings",
    label: "Findings",
    icon: <ShieldAlert aria-hidden className="size-4" />,
  },
  {
    to: "/assets",
    label: "Assets",
    icon: <Boxes aria-hidden className="size-4" />,
  },
  {
    to: "/vendors",
    label: "Vendors",
    icon: <Building2 aria-hidden className="size-4" />,
  },
];

const PUBLISHING_ITEMS: NavigationItem[] = [
  {
    to: "/reports",
    label: "Reports",
    icon: <FileText aria-hidden className="size-4" />,
  },
  {
    to: "/disclosure",
    label: "Disclosure",
    icon: <Send aria-hidden className="size-4" />,
  },
  {
    to: "/mail",
    label: "Mail",
    icon: <Mail aria-hidden className="size-4" />,
  },
];

export function AppSidebar({
  expanded,
}: {
  expanded: boolean;
}): React.JSX.Element {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const user = useSession((state) => state.user);
  const signOut = useSession((state) => state.signOut);
  const [signingOut, setSigningOut] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const notifications = useApiQuery<SecurityNotificationInbox>(
    queryKeys.notifications,
    "/v1/notifications",
    { refetchInterval: 30_000 },
  );

  useEffect(() => {
    let active = true;
    void bridge()
      .app.version()
      .then((value) => {
        if (active) setVersion(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const renderItem = (item: NavigationItem): React.JSX.Element => (
    <Link
      key={item.to}
      to={item.to}
      aria-label={
        item.badge === undefined || item.badge === 0
          ? item.label
          : `${item.label}, ${item.badge} unread`
      }
      title={
        item.badge === undefined || item.badge === 0
          ? item.label
          : `${item.label} (${item.badge} unread)`
      }
      activeOptions={{ exact: item.to === "/" }}
      activeProps={{
        className:
          "bg-surface-raised text-text shadow-[inset_0_0_0_1px_var(--cv-border)] [&>span:first-child]:text-accent",
      }}
      inactiveProps={{
        className: "text-text-muted hover:bg-surface-hover hover:text-text",
      }}
      className={cn(
        "group relative flex min-h-9 items-center rounded-(--cv-radius) text-[13px] transition-[background-color,color,box-shadow] duration-100",
        expanded ? "gap-2 px-2" : "justify-center px-1",
      )}
    >
      <span className="shrink-0">{item.icon}</span>
      {expanded ? <span className="truncate">{item.label}</span> : null}
      {item.badge === undefined || item.badge === 0 ? null : (
        <span
          className={cn(
            "min-w-5 rounded-full bg-accent px-1.5 text-center text-[10px] font-semibold text-white",
            expanded ? "ml-auto" : "absolute right-0 top-0 min-w-4 px-1",
          )}
        >
          {item.badge > 99 ? "99+" : item.badge}
        </span>
      )}
    </Link>
  );

  const handleSignOut = async (): Promise<void> => {
    if (signingOut) return;

    setSigningOut(true);
    setAccountMenuOpen(false);
    try {
      await bridge().auth.logout();
    } finally {
      signOut();
      setSigningOut(false);
    }
  };

  return (
    <nav
      aria-label="Primary"
      className="flex h-full w-full min-w-0 flex-col bg-surface"
    >
      <div
        className={cn(
          "flex flex-1 flex-col overflow-y-auto px-2 py-2",
          expanded ? "gap-4" : "gap-2",
        )}
      >
        <div className="flex flex-col gap-0.5">
          {PRIMARY_ITEMS.map(renderItem)}
        </div>

        <div className="flex flex-col gap-0.5">
          {expanded ? (
            <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-[0.09em] text-text-muted">
              Organization
            </p>
          ) : (
            <div aria-hidden className="mx-2 mb-1 border-t border-border" />
          )}
          {renderItem({
            to: "/organization/users",
            label: "Users",
            icon: <Users aria-hidden className="size-4" />,
          })}
          {renderItem({
            to: "/organization/settings",
            label: "General",
            icon: <Settings aria-hidden className="size-4" />,
          })}
          {renderItem({
            to: "/organization/security",
            label: "Policy & access",
            icon: <ShieldCheck aria-hidden className="size-4" />,
          })}
        </div>

        <div className="flex flex-col gap-0.5">
          {expanded ? (
            <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-[0.09em] text-text-muted">
              Publishing
            </p>
          ) : (
            <div aria-hidden className="mx-2 mb-1 border-t border-border" />
          )}
          {PUBLISHING_ITEMS.map(renderItem)}
        </div>

        <div className="flex flex-col gap-0.5">
          {renderItem({
            to: "/notifications",
            label: "Notifications",
            icon: <Bell aria-hidden className="size-4" />,
            badge: notifications.data?.unreadCount ?? 0,
          })}
          {renderItem({
            to: "/activity",
            label: "Activity",
            icon: <Activity aria-hidden className="size-4" />,
          })}
          {renderItem({
            to: "/metrics",
            label: "Metrics",
            icon: <BarChart3 aria-hidden className="size-4" />,
          })}
        </div>
      </div>

      <div className="border-t border-border p-2">
        <DropdownMenu open={accountMenuOpen} onOpenChange={setAccountMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Open account menu"
              className={cn(
                "group flex w-full items-center rounded-(--cv-radius) text-left text-[13px]",
                expanded
                  ? "min-h-11 gap-2 px-2 py-1.5"
                  : "size-10 justify-center p-0",
                "text-text-muted hover:bg-surface-hover hover:text-text",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
                pathname.startsWith("/settings") &&
                  "bg-surface-hover text-text",
              )}
            >
              <Avatar
                avatarId={null}
                {...(user ? { userId: user.id } : {})}
                seed={user?.id ?? "account"}
                label={user?.displayName ?? "Account"}
                size="sm"
              />
              {expanded ? (
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-text">
                    {user?.displayName ?? "Account"}
                  </span>
                  <span className="block truncate text-[11px]">
                    {user?.email ?? "Account menu"}
                  </span>
                </span>
              ) : null}
              {expanded ? (
                <ChevronUp
                  aria-hidden
                  className="size-4 shrink-0 transition-transform duration-150 ease-out group-data-[state=open]:rotate-180 motion-reduce:transition-none"
                />
              ) : null}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            className={
              expanded
                ? "w-[calc(var(--radix-dropdown-menu-trigger-width)+1px)]"
                : "w-64"
            }
          >
            <DropdownMenuLabel>
              <span className="block truncate font-medium text-text">
                {user?.displayName ?? "Account"}
              </span>
              <span className="block truncate text-[11px] text-text-muted">
                {user?.email}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link
                to="/settings/profile"
                onClick={() => setAccountMenuOpen(false)}
              >
                <Settings aria-hidden className="size-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {version === null ? null : (
              <DropdownMenuLabel className="font-mono text-[10.5px] font-normal text-text-muted">
                CodeVault Desktop {version}
              </DropdownMenuLabel>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={signingOut}
              className="text-danger data-[highlighted]:bg-danger/10 data-[highlighted]:text-danger"
              onSelect={() => void handleSignOut()}
            >
              <LogOut aria-hidden className="size-4" />
              {signingOut ? "Signing out…" : "Sign out"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
