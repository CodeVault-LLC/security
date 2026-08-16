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
      icon: Strikethrough,
      label: "Strikethrough",
      command: toggleInline("~~"),
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
    { icon: Quote, label: "Quote", command: toggleLinePrefix("> ") },
  ],
  [
    { icon: Link2, label: "Link", shortcut: "⌘K", command: insertLink },
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
  /** Rendered at the end of the bar, e.g. the saved indicator. */
  children?: React.ReactNode;
}

export function MarkdownToolbar({
  onCommand,
  onInsertMenu,
  disabled = false,
  children,
}: MarkdownToolbarProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1">
      {GROUPS.map((group, index) => (
        <div key={index} className="flex items-center gap-0.5">
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
              className="rounded-(--cv-radius) p-1 text-text-muted hover:bg-surface-hover hover:text-text disabled:pointer-events-none disabled:opacity-40"
            >
              <action.icon aria-hidden className="size-3.5" />
            </button>
          ))}
        </div>
      ))}

      <span aria-hidden className="mx-1 h-4 w-px bg-border" />

      <button
        type="button"
        disabled={disabled}
        title="Insert… (/)"
        aria-label="Insert"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onInsertMenu}
        className="flex items-center gap-1 rounded-(--cv-radius) px-1.5 py-1 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text disabled:pointer-events-none disabled:opacity-40"
      >
        <Plus aria-hidden className="size-3.5" />
        Insert
      </button>

      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}
