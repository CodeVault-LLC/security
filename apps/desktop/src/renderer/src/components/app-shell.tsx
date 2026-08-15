import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Button } from "@codevault/ui";

import { subscribeToServerEvents } from "../lib/events.js";
import { useSession } from "../lib/session.js";
import { AppSidebar } from "./app-sidebar.js";
import { CommandPalette } from "./command-palette.js";
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

export function AppShell({ children }: AppShellProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const setEventsConnected = useSession((state) => state.setEventsConnected);
  const storageWarning = useSession((state) => state.storageWarning);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [createCaseOpen, setCreateCaseOpen] = useState(false);
  const [createFindingOpen, setCreateFindingOpen] = useState(false);
  const [warningDismissed, setWarningDismissed] = useState(false);

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

  const goToFindings = useCallback(() => {
    void navigate({ to: "/findings" });
  }, [navigate]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background text-text">
      <AppSidebar onOpenCommandPalette={() => setPaletteOpen(true)} />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {storageWarning === null || warningDismissed ? null : (
          <div className="flex items-start gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-[12px] text-warning">
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

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onCreateCase={() => setCreateCaseOpen(true)}
        onCreateFinding={() => setCreateFindingOpen(true)}
        onUploadEvidence={goToFindings}
        onCheckPriorArt={goToFindings}
      />

      <CreateCaseDialog open={createCaseOpen} onOpenChange={setCreateCaseOpen} />
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
    <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h1 className="text-[15px] font-semibold leading-tight">{title}</h1>
        {description === undefined ? null : (
          <p className="mt-0.5 text-[12px] text-text-muted">{description}</p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
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
    <div className={`min-h-0 flex-1 overflow-y-auto p-4 ${className ?? ""}`}>
      {children}
    </div>
  );
}
