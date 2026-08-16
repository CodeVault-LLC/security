import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import {
  Boxes,
  FilePlus2,
  FileText,
  Search as SearchIcon,
  Settings,
  ShieldAlert,
  ShieldQuestion,
  Upload,
} from "lucide-react";
import { useState } from "react";

import type { SearchResponse } from "@codevault/contracts";
import { Mono, SeverityBadge } from "@codevault/ui";

import { apiRequest, queryKeys } from "../lib/api.js";
import { useDebouncedValue } from "../hooks/use-debounced-value.js";

/**
 * The command palette.
 *
 * One keystroke to anything: open a case, finding or asset by reference, or
 * start one of the actions a researcher takes dozens of times a day. Search is
 * debounced because the server ranks across five entity types and the query
 * runs on every keypress otherwise.
 */

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateCase: () => void;
  onCreateFinding: () => void;
  onUploadEvidence: () => void;
  onCheckPriorArt: () => void;
}

const GROUP_ROUTES: Record<string, (id: string) => string> = {
  CASES: (id) => `/cases/${id}`,
  FINDINGS: (id) => `/findings/${id}`,
  ASSETS: (id) => `/assets/${id}`,
  EVIDENCE: (id) => `/evidence/${id}`,
  REPORTS: (id) => `/reports/${id}`,
};

export function CommandPalette(props: CommandPaletteProps): React.JSX.Element {
  // Remounting on open resets the query and the highlighted row without an
  // effect that writes state back on every close.
  return <PaletteContents key={props.open ? "open" : "closed"} {...props} />;
}

function PaletteContents({
  open,
  onOpenChange,
  onCreateCase,
  onCreateFinding,
  onUploadEvidence,
  onCheckPriorArt,
}: CommandPaletteProps): React.JSX.Element {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 180);
  const term = debouncedQuery.trim();

  const search = useQuery<SearchResponse>({
    queryKey: queryKeys.search(term),
    queryFn: () =>
      apiRequest<SearchResponse>(
        `/v1/search?q=${encodeURIComponent(term)}&limit=8`,
      ),
    enabled: open && term.length >= 2,
    // Search results age quickly and the palette is opened constantly, so a
    // short window keeps repeat lookups instant without showing stale hits.
    staleTime: 10_000,
  });

  const results = search.data ?? null;
  const searching = search.isFetching;

  const run = (action: () => void): void => {
    onOpenChange(false);
    action();
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="CodeVault command palette"
      // The palette filters nothing locally: ranking is the server's job, and
      // it knows about identifiers, hashes and CVEs that a fuzzy string match
      // would bury under title similarity.
      shouldFilter={false}
      className="fixed left-1/2 top-24 z-50 w-[min(680px,90vw)] -translate-x-1/2 overflow-hidden rounded-(--cv-radius-lg) border border-border-strong bg-surface shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-border px-3">
        <SearchIcon aria-hidden className="size-4 text-text-muted" />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search cases, findings, assets, evidence, hashes, CVEs…"
          className="h-10 flex-1 bg-transparent text-[13px] outline-none placeholder:text-text-muted"
        />
        {searching ? (
          <span className="text-[11px] text-text-muted">Searching…</span>
        ) : null}
      </div>

      <Command.List className="max-h-96 overflow-y-auto p-1">
        <Command.Empty className="px-3 py-6 text-center text-[12px] text-text-muted">
          {query.trim().length < 2
            ? "Type to search, or pick an action below."
            : "Nothing matched."}
        </Command.Empty>

        {results?.groups.map((group) => (
          <Command.Group
            key={group.group}
            heading={group.group}
            className="px-1 py-1 text-[10px] font-medium uppercase tracking-[0.09em] text-text-muted"
          >
            {group.hits.map((hit) => (
              <Command.Item
                key={`${group.group}-${hit.id}`}
                value={`${hit.ref} ${hit.title}`}
                onSelect={() =>
                  run(() => {
                    const route = GROUP_ROUTES[group.group];

                    if (route !== undefined) {
                      void navigate({ to: route(hit.id) });
                    }
                  })
                }
                className="flex cursor-pointer items-center gap-2 rounded-(--cv-radius) px-2 py-1.5 text-[13px] text-text data-[selected=true]:bg-surface-hover"
              >
                <Mono className="shrink-0 text-text-muted">{hit.ref}</Mono>
                <span className="min-w-0 flex-1 truncate normal-case tracking-normal">
                  {hit.title}
                </span>
                {hit.severity === null ? null : (
                  <SeverityBadge severity={hit.severity} />
                )}
                <span className="shrink-0 text-[10px] uppercase text-text-muted">
                  {hit.matchKind.replace("_", " ")}
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        ))}

        <Command.Group
          heading="Actions"
          className="px-1 py-1 text-[10px] font-medium uppercase tracking-[0.09em] text-text-muted"
        >
          <PaletteAction
            icon={<Boxes aria-hidden className="size-3.5" />}
            label="Create research case"
            onSelect={() => run(onCreateCase)}
          />
          <PaletteAction
            icon={<ShieldAlert aria-hidden className="size-3.5" />}
            label="Create finding"
            onSelect={() => run(onCreateFinding)}
          />
          <PaletteAction
            icon={<Upload aria-hidden className="size-3.5" />}
            label="Upload evidence"
            onSelect={() => run(onUploadEvidence)}
          />
          <PaletteAction
            icon={<ShieldQuestion aria-hidden className="size-3.5" />}
            label="Check prior art"
            onSelect={() => run(onCheckPriorArt)}
          />
          <PaletteAction
            icon={<FileText aria-hidden className="size-3.5" />}
            label="Open reports"
            onSelect={() => run(() => void navigate({ to: "/reports" }))}
          />
          <PaletteAction
            icon={<FilePlus2 aria-hidden className="size-3.5" />}
            label="Open activity"
            onSelect={() => run(() => void navigate({ to: "/activity" }))}
          />
          <PaletteAction
            icon={<Settings aria-hidden className="size-3.5" />}
            label="Open settings"
            onSelect={() => run(() => void navigate({ to: "/settings" }))}
          />
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}

function PaletteAction({
  icon,
  label,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <Command.Item
      value={label}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2 rounded-(--cv-radius) px-2 py-1.5 text-[13px] normal-case tracking-normal text-text data-[selected=true]:bg-surface-hover"
    >
      <span className="text-text-muted">{icon}</span>
      {label}
    </Command.Item>
  );
}
