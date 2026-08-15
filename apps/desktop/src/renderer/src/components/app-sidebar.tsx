import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Boxes,
  FileText,
  Home,
  Search,
  Settings,
  ShieldAlert,
  Send,
  UserCircle2,
  WifiOff,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@codevault/ui";

import { useSession } from "../lib/session.js";

/**
 * The global sidebar.
 *
 * Nine destinations, not one per database table. Everything else is reached
 * from the thing it belongs to — evidence from a case, scores from a finding —
 * because a flat list of every concept is how a research tool turns into an
 * enterprise console.
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
    icon: <Boxes aria-hidden className="size-4" />,
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
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const user = useSession((state) => state.user);
  const eventsConnected = useSession((state) => state.eventsConnected);

  const isActive = (to: string): boolean =>
    to === "/" ? pathname === "/" : pathname.startsWith(to);

  const renderItem = (item: NavigationItem): React.JSX.Element => (
    <Link
      key={item.to}
      to={item.to}
      className={cn(
        "flex items-center gap-2 rounded-[--radius] px-2 py-1 text-[13px] transition-colors",
        isActive(item.to)
          ? "bg-surface-hover text-text"
          : "text-text-muted hover:bg-surface-hover hover:text-text",
      )}
    >
      <span className="shrink-0">{item.icon}</span>
      <span className="truncate">{item.label}</span>
    </Link>
  );

  return (
    <nav className="flex h-full w-52 shrink-0 flex-col border-r border-border bg-surface">
      <div className="cv-drag-region flex h-11 items-center gap-2 px-3">
        <span className="text-[13px] font-semibold tracking-tight">
          CodeVault
        </span>
      </div>

      <div className="cv-no-drag px-2 pb-2">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="flex w-full items-center gap-2 rounded-[--radius] border border-border bg-surface-raised px-2 py-1 text-[12px] text-text-muted hover:bg-surface-hover"
        >
          <Search aria-hidden className="size-3.5" />
          <span className="flex-1 text-left">Search</span>
          <kbd className="rounded border border-border px-1 font-mono text-[10px]">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-2">
        <div className="flex flex-col gap-0.5">
          {PRIMARY_ITEMS.map(renderItem)}
        </div>

        <div className="flex flex-col gap-0.5">
          <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-[0.09em] text-text-muted">
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
        </div>
      </div>

      <div className="border-t border-border p-2">
        {eventsConnected ? null : (
          <div
            className="mb-2 flex items-center gap-1.5 rounded-[--radius] border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] text-warning"
            title="Live updates are not connected. Data may be out of date until it reconnects."
          >
            <WifiOff aria-hidden className="size-3" />
            Live updates offline
          </div>
        )}

        <div className="flex flex-col gap-0.5">
          {renderItem({
            to: "/settings",
            label: "Settings",
            icon: <Settings aria-hidden className="size-4" />,
          })}

          <Link
            to="/settings/account"
            className="flex items-center gap-2 rounded-[--radius] px-2 py-1 text-[13px] text-text-muted hover:bg-surface-hover hover:text-text"
          >
            <UserCircle2 aria-hidden className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {user?.displayName ?? "Account"}
            </span>
            <span className="shrink-0 rounded border border-border px-1 text-[10px] uppercase text-text-muted">
              {user?.role.slice(0, 1) ?? "?"}
            </span>
          </Link>
        </div>
      </div>
    </nav>
  );
}
