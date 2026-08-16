import type {
  AssetSummary,
  Evidence,
  FindingSummary,
} from "@codevault/contracts";
import { Dialog, DialogBody, DialogContent, Input, Mono } from "@codevault/ui";
import { useMemo, useState } from "react";

import { queryKeys, useApiQuery } from "../../lib/api.js";
import { BLOCK_SNIPPETS } from "./commands.js";

/**
 * The insert menu.
 *
 * Two things live here. The first is the syntax that is tedious to type from
 * memory — a table skeleton, a diagram, a callout. The second is the reason
 * this is not a generic Markdown editor: CodeVault directives are references
 * to real records, and typing `[evidence:EVID-000123]` from memory means
 * getting the reference wrong, discovering it at lint time, and going back.
 * Here they are picked from the case's actual evidence.
 */

interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

interface InsertOption {
  id: string;
  label: string;
  detail?: string;
  group: string;
  /** Literal text inserted at the cursor. */
  snippet: string;
}

const BLOCKS: InsertOption[] = [
  {
    id: "table",
    label: "Table",
    detail: "Three columns, two empty rows",
    group: "Blocks",
    snippet: BLOCK_SNIPPETS.table,
  },
  {
    id: "diagram",
    label: "Flowchart",
    detail: "Mermaid — attack path, data flow",
    group: "Blocks",
    snippet: BLOCK_SNIPPETS.diagram,
  },
  {
    id: "sequence",
    label: "Sequence diagram",
    detail: "Mermaid — request and response order",
    group: "Blocks",
    snippet: BLOCK_SNIPPETS.sequence,
  },
  {
    id: "code",
    label: "Code block",
    detail: "Fenced, with a language for highlighting",
    group: "Blocks",
    snippet: BLOCK_SNIPPETS.code,
  },
  {
    id: "callout",
    label: "Warning callout",
    detail: "> [!WARNING]",
    group: "Blocks",
    snippet: BLOCK_SNIPPETS.callout,
  },
  {
    id: "footnote",
    label: "Footnote",
    detail: "A numbered reference and its note",
    group: "Blocks",
    snippet: BLOCK_SNIPPETS.footnote,
  },
  {
    id: "math",
    label: "Maths block",
    detail: "Rendered without loading a font",
    group: "Blocks",
    snippet: BLOCK_SNIPPETS.math,
  },
];

export interface InsertMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (snippet: string) => void;
  /** Enables the directive pickers, which need a case to look records up in. */
  caseId?: string | undefined;
}

export function InsertMenu({
  open,
  onOpenChange,
  onInsert,
  caseId,
}: InsertMenuProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const enabled = open && caseId !== undefined && caseId.length > 0;

  const evidence = useApiQuery<Paginated<Evidence>>(
    queryKeys.evidence({ caseId }),
    `/v1/evidence?caseId=${caseId ?? ""}&limit=100`,
    { enabled },
  );

  const assets = useApiQuery<Paginated<AssetSummary>>(
    queryKeys.assets({ caseId }),
    `/v1/assets?caseId=${caseId ?? ""}&limit=100`,
    { enabled },
  );

  const findings = useApiQuery<Paginated<FindingSummary>>(
    queryKeys.findings({ caseId }),
    `/v1/findings?caseId=${caseId ?? ""}&limit=100`,
    { enabled },
  );

  const options = useMemo((): InsertOption[] => {
    const references: InsertOption[] = [
      ...(evidence.data?.items ?? []).map((item) => ({
        id: `evidence-${item.id}`,
        label: item.title,
        detail: item.ref,
        group: "Evidence",
        snippet: `[evidence:${item.ref}]`,
      })),
      ...(assets.data?.items ?? []).map((item) => ({
        id: `asset-${item.id}`,
        label: item.name,
        detail: item.ref,
        group: "Assets",
        snippet: `[asset:${item.ref}]`,
      })),
      ...(findings.data?.items ?? []).map((item) => ({
        id: `finding-${item.id}`,
        label: item.title,
        detail: item.ref,
        group: "Findings",
        snippet: `[finding:${item.ref}]`,
      })),
    ];

    return [...BLOCKS, ...references];
  }, [evidence.data, assets.data, findings.data]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    if (needle.length === 0) {
      return options;
    }

    return options.filter((option) =>
      `${option.label} ${option.detail ?? ""} ${option.group}`
        .toLowerCase()
        .includes(needle),
    );
  }, [options, query]);

  const choose = (option: InsertOption): void => {
    onInsert(option.snippet);
    onOpenChange(false);
    setQuery("");
  };

  const groups = useMemo(() => {
    const byGroup = new Map<string, InsertOption[]>();

    for (const option of filtered) {
      byGroup.set(option.group, [...(byGroup.get(option.group) ?? []), option]);
    }

    return [...byGroup.entries()];
  }, [filtered]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);

        if (!next) {
          setQuery("");
        }
      }}
    >
      <DialogContent
        title="Insert"
        description="Blocks, and references to this case's own records."
      >
        <DialogBody>
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search blocks, evidence, assets, findings…"
            aria-label="Search things to insert"
            onKeyDown={(event) => {
              // Enter takes the first match, so a known reference is two
              // keystrokes and never a typed identifier.
              if (event.key === "Enter" && filtered[0] !== undefined) {
                event.preventDefault();
                choose(filtered[0]);
              }
            }}
          />

          <div className="mt-2 max-h-72 overflow-y-auto">
            {groups.length === 0 ? (
              <p className="px-1 py-3 text-[12px] text-text-muted">
                Nothing matches “{query}”.
              </p>
            ) : (
              groups.map(([group, items]) => (
                <div key={group} className="mb-2">
                  <p className="px-1 py-1 text-[10.5px] uppercase tracking-wide text-text-muted">
                    {group}
                  </p>
                  <ul>
                    {items.map((option) => (
                      <li key={option.id}>
                        <button
                          type="button"
                          onClick={() => choose(option)}
                          className="flex w-full items-center justify-between gap-2 rounded-(--cv-radius) px-2 py-1.5 text-left text-[12px] hover:bg-surface-hover"
                        >
                          <span className="min-w-0 truncate">
                            {option.label}
                          </span>
                          {option.detail === undefined ? null : (
                            <Mono className="shrink-0 text-[10.5px] text-text-muted">
                              {option.detail}
                            </Mono>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>

          {caseId === undefined ? (
            <p className="mt-1 text-[11px] text-text-muted">
              Open this from within a case to reference its evidence and assets.
            </p>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
