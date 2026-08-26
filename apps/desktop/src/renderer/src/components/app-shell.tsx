import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Button } from "@codevault/ui";

import { subscribeToServerEvents } from "../lib/events.js";
import { useSession } from "../lib/session.js";
import { AppSidebar } from "./app-sidebar.js";
import { CommandPalette } from "./command-palette.js";
import { ResizablePanels } from "./resizable-panels.js";
import { CreateCaseDialog } from "../features/cases/create-case-dialog.js";
import { CreateFindingDialog } from "../features/findings/create-finding-dialog.js";

/**
 * The application frame.
 *
 * Sidebar, command palette, live-update subscription and the quick-create
 * dialogs that the palette opens. Route content renders in the remaining area.
 */

export interface AppShellProps {
  children: ReactNode;
}

const SIDEBAR_OPEN_KEY = "codevault.workspace.sidebar-open";

function initialSidebarOpen(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_OPEN_KEY) !== "false";
  } catch {
    return true;
  }
}

function workspaceLabel(pathname: string): string {
  if (pathname === "/") return "Home";
  if (pathname.startsWith("/organization/users")) return "Organization users";
  if (pathname.startsWith("/organization/settings"))
    return "Organization settings";
  if (pathname.startsWith("/organization/security"))
    return "Organization policy";
  if (pathname.startsWith("/organization")) return "Organization";
  if (pathname.startsWith("/settings")) return "Personal settings";
  if (pathname.startsWith("/cases")) return "Cases";
  if (pathname.startsWith("/findings")) return "Findings";
  if (pathname.startsWith("/assets")) return "Assets";
  if (pathname.startsWith("/vendors")) return "Vendors";
  if (pathname.startsWith("/reports")) return "Reports";
  if (pathname.startsWith("/submissions")) return "Submissions";
  if (pathname.startsWith("/disclosure")) return "Disclosure";
  if (pathname.startsWith("/activity")) return "Activity";
  if (pathname.startsWith("/metrics")) return "Metrics";
  if (pathname.startsWith("/notifications")) return "Notifications";
  return "Workspace";
}

export function AppShell({ children }: AppShellProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const setEventsConnected = useSession((state) => state.setEventsConnected);
  const storageWarning = useSession((state) => state.storageWarning);
  const eventsConnected = useSession((state) => state.eventsConnected);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [createCaseOpen, setCreateCaseOpen] = useState(false);
  const [createFindingOpen, setCreateFindingOpen] = useState(false);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(initialSidebarOpen);

  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  useEffect(() => {
    const subscription = subscribeToServerEvents(
      queryClient,
      setEventsConnected,
    );

    return () => subscription.stop();
  }, [queryClient, setEventsConnected]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_OPEN_KEY, String(sidebarOpen));
    } catch {
      // The layout preference is useful, but the workspace does not depend on it.
    }
  }, [sidebarOpen]);

  const goToFindings = useCallback(() => {
    void navigate({ to: "/findings" });
  }, [navigate]);

  const workspace = (
    <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="cv-drag-region flex h-11 shrink-0 items-center gap-2 border-b border-border bg-surface px-2">
        <button
          type="button"
          onClick={() => setSidebarOpen((open) => !open)}
          aria-label={sidebarOpen ? "Hide navigation" : "Show navigation"}
          title={sidebarOpen ? "Hide navigation" : "Show navigation"}
          className="cv-no-drag flex size-9 shrink-0 items-center justify-center rounded-(--cv-radius) text-text-muted transition-colors duration-100 hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
        >
          {sidebarOpen ? (
            <PanelLeftClose aria-hidden className="size-4" />
          ) : (
            <PanelLeftOpen aria-hidden className="size-4" />
          )}
        </button>
        <div className="h-4 w-px bg-border" />
        <div className="flex min-w-0 items-center gap-1.5 text-[12px]">
          <span className="truncate font-medium text-text">
            CodeVault Security
          </span>
          <ChevronRight
            aria-hidden
            className="size-3.5 shrink-0 text-text-muted"
          />
          <span className="truncate text-text-muted">
            {workspaceLabel(pathname)}
          </span>
        </div>
        <div className="cv-no-drag ml-auto flex shrink-0 items-center gap-1.5">
          <span
            role="status"
            className={`hidden items-center gap-1.5 px-1.5 text-[11px] sm:flex ${
              eventsConnected ? "text-text-muted" : "text-warning"
            }`}
            title={
              eventsConnected
                ? "Live updates connected"
                : "Live updates are offline. Data may be stale."
            }
          >
            {eventsConnected ? (
              <span aria-hidden className="size-1.5 rounded-full bg-success" />
            ) : (
              <WifiOff aria-hidden className="size-3.5" />
            )}
            {eventsConnected ? "Live" : "Offline"}
          </span>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 items-center gap-2 rounded-(--cv-radius) border border-border bg-surface-raised px-2.5 text-[12px] text-text-muted transition-[background-color,border-color,color] duration-100 hover:border-border-strong hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
          >
            <Search aria-hidden className="size-3.5" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden rounded border border-border bg-surface px-1 font-mono text-[10px] leading-4 md:inline">
              ⌘K
            </kbd>
          </button>
        </div>
      </div>

      {storageWarning === null || warningDismissed ? null : (
        <div className="flex items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-[12px] text-warning">
          <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <p className="flex-1">
            <span className="font-medium">
              Secure credential storage is unavailable.
            </span>{" "}
            {storageWarning}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setWarningDismissed(true)}
          >
            Dismiss
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </main>
  );

  return (
    <div className="h-full w-full overflow-hidden bg-background text-text">
      {sidebarOpen ? (
        <ResizablePanels
          primary={<AppSidebar />}
          secondary={workspace}
          primaryLabel="Primary navigation"
          secondaryLabel="Workspace"
          resizeLabel="Resize primary navigation"
          storageKey="codevault.workspace.sidebar-width"
          initialPrimarySize={0.16}
          minPrimarySize={184}
          maxPrimarySize={280}
          minSecondarySize={560}
          className="cv-app-shell-layout h-full w-full"
        />
      ) : (
        workspace
      )}

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onCreateCase={() => setCreateCaseOpen(true)}
        onCreateFinding={() => setCreateFindingOpen(true)}
        onUploadEvidence={goToFindings}
        onCheckPriorArt={goToFindings}
      />

      <CreateCaseDialog
        open={createCaseOpen}
        onOpenChange={setCreateCaseOpen}
      />
      <CreateFindingDialog
        open={createFindingOpen}
        onOpenChange={setCreateFindingOpen}
      />
    </div>
  );
}

/** A page header with a title, optional description and actions. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}): React.JSX.Element {
  return (
    <header className="flex min-h-[72px] flex-wrap items-start justify-between gap-4 border-b border-border bg-surface px-5 py-3.5">
      <div className="min-w-0">
        <h1 className="text-balance text-[19px] font-semibold leading-tight tracking-[-0.02em]">
          {title}
        </h1>
        {description === undefined ? null : (
          <p className="mt-1 max-w-3xl text-pretty text-[13px] leading-5 text-text-muted">
            {description}
          </p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {actions}
        </div>
      )}
    </header>
  );
}

/** Scrollable body area for a page. */
export function PageBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={`min-h-0 flex-1 overflow-y-auto p-5 ${className ?? ""}`}>
      {children}
    </div>
  );
}
