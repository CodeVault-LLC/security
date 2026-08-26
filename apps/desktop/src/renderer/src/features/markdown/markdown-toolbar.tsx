import {
  Bold,
  Code,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Plus,
  Quote,
  Strikethrough,
  Table,
} from "lucide-react";

import {
  BLOCK_SNIPPETS,
  insertBlock,
  insertLink,
  toggleHeading,
  toggleInline,
  toggleLinePrefix,
  type Command,
} from "./commands.js";

/**
 * The formatting toolbar.
 *
 * Deliberately short. Everything here is either something a writer reaches for
 * constantly, or something whose Markdown is annoying enough to type by hand
 * that people avoid using it at all — which is how findings end up as walls of
 * prose with no table in sight. The rest lives behind the insert menu.
 */

interface ToolbarAction {
  icon: typeof Bold;
  label: string;
  shortcut?: string;
  command: Command;
}

const GROUPS: ToolbarAction[][] = [
  [
    { icon: Bold, label: "Bold", shortcut: "⌘B", command: toggleInline("**") },
    {
      icon: Italic,
      label: "Italic",
      shortcut: "⌘I",
      command: toggleInline("*"),
    },
    {
      icon: Code,
      label: "Inline code",
      shortcut: "⌘E",
      command: toggleInline("`"),
    },
  ],
  [
    {
      icon: Heading2,
      label: "Heading",
      shortcut: "⌘2",
      command: toggleHeading(2),
    },
    { icon: List, label: "Bullet list", command: toggleLinePrefix("- ") },
    { icon: Quote, label: "Quote", command: toggleLinePrefix("> ") },
    { icon: Link2, label: "Link", shortcut: "⌘K", command: insertLink },
  ],
  [
    {
      icon: ListOrdered,
      label: "Numbered list",
      command: toggleLinePrefix("1. "),
    },
    {
      icon: ListTodo,
      label: "Task list",
      command: toggleLinePrefix("- [ ] "),
    },
    {
      icon: Strikethrough,
      label: "Strikethrough",
      command: toggleInline("~~"),
    },
    {
      icon: Table,
      label: "Table",
      command: insertBlock(BLOCK_SNIPPETS.table),
    },
  ],
];

export interface MarkdownToolbarProps {
  onCommand: (command: Command) => void;
  onInsertMenu: () => void;
  disabled?: boolean;
}

export function MarkdownToolbar({
  onCommand,
  onInsertMenu,
  disabled = false,
}: MarkdownToolbarProps): React.JSX.Element {
  return (
    <div className="flex items-center overflow-x-auto border-b border-border bg-surface-raised/35 px-2 py-1">
      <div className="flex min-w-max flex-1 items-center">
        {GROUPS.map((group, index) => (
          <div key={index} className="flex shrink-0 items-center">
            {index === 2 ? (
              <>
                <span aria-hidden className="mx-1 h-4 w-px bg-border" />
                <button
                  type="button"
                  disabled={disabled}
                  title="Insert… (/)"
                  aria-label="Insert"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={onInsertMenu}
                  className="flex h-8 shrink-0 items-center gap-1 rounded-(--cv-radius) px-2 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-40"
                >
                  <Plus aria-hidden className="size-4" />
                  Insert
                </button>
              </>
            ) : null}
            {index === 0 ? null : (
              <span aria-hidden className="mx-1 h-4 w-px bg-border" />
            )}
            {group.map((action) => (
              <button
                key={action.label}
                type="button"
                disabled={disabled}
                title={
                  action.shortcut === undefined
                    ? action.label
                    : `${action.label} (${action.shortcut})`
                }
                aria-label={action.label}
                // The editor keeps focus, so the command applies to the
                // selection the author can still see.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onCommand(action.command)}
                className="flex size-8 items-center justify-center rounded-(--cv-radius) text-text-muted hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-40"
              >
                <action.icon aria-hidden className="size-4" />
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
