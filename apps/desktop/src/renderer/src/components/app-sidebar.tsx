import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  Boxes,
  ChevronUp,
  FileText,
  Home,
  LogOut,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Send,
  Users,
  WifiOff,
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

import { bridge } from "../lib/bridge.js";
import { useSession } from "../lib/session.js";
import { Avatar } from "./avatar.js";
import { BrandWordmark } from "./brand-wordmark.js";

/**
 * The global sidebar.
 *
 * Ten destinations, not one per database table. Everything else is reached from
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
];

export interface AppSidebarProps {
  onOpenCommandPalette: () => void;
}

export function AppSidebar({
  onOpenCommandPalette,
}: AppSidebarProps): React.JSX.Element {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const user = useSession((state) => state.user);
  const signOut = useSession((state) => state.signOut);
  const eventsConnected = useSession((state) => state.eventsConnected);
  const [signingOut, setSigningOut] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

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
      aria-label={item.label}
      title={item.label}
      activeOptions={{ exact: item.to === "/" }}
      activeProps={{ className: "bg-surface-hover text-text" }}
      inactiveProps={{
        className: "text-text-muted hover:bg-surface-hover hover:text-text",
      }}
      className="flex min-h-9 items-center gap-2 rounded-(--cv-radius) px-2 text-[13px] transition-colors max-lg:justify-center max-sm:px-1"
    >
      <span className="shrink-0">{item.icon}</span>
      <span className="truncate max-lg:hidden">{item.label}</span>
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
      className="flex h-full w-52 shrink-0 flex-col border-r border-border bg-surface max-lg:w-14 max-sm:w-12"
    >
      <div className="cv-drag-region flex h-14 items-center px-3 max-lg:justify-center max-lg:px-1">
        <BrandWordmark compact className="max-lg:hidden" />
        <span
          aria-label="CodeVault Security"
          className="hidden text-[13px] font-semibold tracking-[-0.02em] text-accent max-lg:inline"
        >
          CV
        </span>
      </div>

      <div className="cv-no-drag px-2 pb-2">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          aria-label="Search and commands"
          className="flex min-h-9 w-full items-center gap-2 rounded-(--cv-radius) border border-border bg-surface-raised px-2 text-[12px] text-text-muted hover:bg-surface-hover max-lg:justify-center"
        >
          <Search aria-hidden className="size-3.5" />
          <span className="flex-1 text-left max-lg:hidden">Search</span>
          <kbd className="rounded border border-border px-1 font-mono text-[10px] max-lg:hidden">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-2 max-lg:gap-2">
        <div className="flex flex-col gap-0.5">
          {PRIMARY_ITEMS.map(renderItem)}
        </div>

        <div className="flex flex-col gap-0.5">
          <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-[0.09em] text-text-muted max-lg:hidden">
            Organization
          </p>
          {renderItem({
            to: "/organization/users",
            label: "Users",
            icon: <Users aria-hidden className="size-4" />,
          })}
          {renderItem({
            to: "/organization/settings",
            label: "Settings",
            icon: <Settings aria-hidden className="size-4" />,
          })}
          {renderItem({
            to: "/organization/security",
            label: "Security",
            icon: <ShieldCheck aria-hidden className="size-4" />,
          })}
        </div>

        <div className="flex flex-col gap-0.5">
          <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-[0.09em] text-text-muted max-lg:hidden">
            Publishing
          </p>
          {PUBLISHING_ITEMS.map(renderItem)}
        </div>

        <div className="flex flex-col gap-0.5">
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
        {eventsConnected ? null : (
          <div
            role="status"
            aria-label="Live updates are offline. Data may be stale."
            className="mb-2 flex items-center gap-1.5 rounded-(--cv-radius) border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] text-warning"
            title="Live updates are not connected. Data may be out of date until it reconnects."
          >
            <WifiOff aria-hidden className="size-3" />
            <span className="max-lg:hidden">Live updates offline</span>
            <span className="hidden max-lg:inline">Stale</span>
          </div>
        )}

        <DropdownMenu open={accountMenuOpen} onOpenChange={setAccountMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Open account menu"
              className={cn(
                "group flex min-h-12 w-full items-center gap-2 rounded-(--cv-radius) px-2 py-1.5 text-left text-[13px]",
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
              <span className="min-w-0 flex-1 max-lg:hidden">
                <span className="block truncate font-medium text-text">
                  {user?.displayName ?? "Account"}
                </span>
                <span className="block truncate text-[11px]">
                  {user?.email ?? "Account menu"}
                </span>
              </span>
              <ChevronUp
                aria-hidden
                className="size-4 shrink-0 transition-transform duration-150 ease-out group-data-[state=open]:rotate-180 motion-reduce:transition-none max-lg:hidden"
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            className="w-[calc(var(--radix-dropdown-menu-trigger-width)+1px)]"
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
