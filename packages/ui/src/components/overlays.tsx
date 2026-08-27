import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as SelectPrimitive from "@radix-ui/react-select";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { Check, ChevronDown, ChevronUp, X } from "lucide-react";
import { forwardRef, type ReactNode } from "react";

import { cn } from "../lib/cn.js";

/**
 * Overlay and navigation primitives.
 *
 * Thin wrappers over Radix so focus management, escape handling and ARIA come
 * from a library that has already got them right, with CodeVault's density and
 * tokens applied on top.
 */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogContent = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    title: string;
    description?: string | undefined;
    /** Width class; dialogs are sized to their content, not to a grid. */
    width?: string | undefined;
  }
>(function DialogContent(
  { className, children, title, description, width = "max-w-lg", ...props },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px]" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          // The width comes from the `width` prop's max-w-* class; this keeps a
          // dialog off the window edges on a small screen. Both are needed: a
          // fixed-position element with no width shrinks to fit its content.
          "fixed left-1/2 top-1/2 z-50 w-[92vw] -translate-x-1/2 -translate-y-1/2",
          "rounded-(--cv-radius-lg) border border-border-strong bg-surface shadow-2xl",
          width,
          className,
        )}
        {...props}
      >
        <div className="flex min-h-14 items-start justify-between gap-4 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-balance text-[15px] font-semibold leading-5 tracking-[-0.01em]">
              {title}
            </DialogPrimitive.Title>
            {description === undefined ? null : (
              <DialogPrimitive.Description className="mt-0.5 text-[12px] text-text-muted">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            className="-mr-1 flex size-9 shrink-0 items-center justify-center rounded-(--cv-radius) text-text-muted transition-colors duration-100 hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
            aria-label="Close"
          >
            <X aria-hidden className="size-4" />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export function DialogBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cn("max-h-[70vh] overflow-y-auto p-4", className)}>
      {children}
    </div>
  );
}

export function DialogFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 border-t border-border px-4 py-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A complementary panel that keeps the current task visible.
 *
 * This follows the shadcn Sheet composition while reusing Radix Dialog for
 * focus management, escape handling and focus return. Use it for inspectors
 * and supporting controls, not for a second primary workspace.
 */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export const SheetContent = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(function SheetContent({ className, children, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/35" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-[24rem] flex-col",
          "border-l border-border-strong bg-surface shadow-2xl outline-none",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute right-2 top-2 flex size-9 items-center justify-center rounded-(--cv-radius) text-text-muted transition-colors duration-100 hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
          aria-label="Close inspector"
        >
          <X aria-hidden className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export function SheetHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn(
        "shrink-0 border-b border-border px-4 py-3 pr-12",
        className,
      )}
      {...props}
    />
  );
}

export const SheetTitle = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function SheetTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn("text-[15px] font-semibold leading-5", className)}
      {...props}
    />
  );
});

export const SheetDescription = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function SheetDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn("mt-0.5 text-[12px] leading-5 text-text-muted", className)}
      {...props}
    />
  );
});

export function SheetBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn("min-h-0 flex-1 overflow-y-auto p-4", className)}
      {...props}
    />
  );
}

export const Tabs = TabsPrimitive.Root;

/** Compact record navigation with a stable active edge. */
export const TabsList = forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <div className="shrink-0 overflow-x-auto border-b border-border bg-surface px-3">
      <TabsPrimitive.List
        ref={ref}
        className={cn("inline-flex min-w-max items-center", className)}
        {...props}
      />
    </div>
  );
});

export const TabsTrigger = forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        "relative inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap px-3 py-1 text-[12px] font-medium text-text-muted",
        "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-t-full after:bg-accent after:opacity-0 after:content-['']",
        "transition-colors duration-100 hover:text-text",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
        "data-[state=active]:text-text data-[state=active]:after:opacity-100",
        className,
      )}
      {...props}
    />
  );
});

export const TabsContent = forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn("min-h-0 flex-1 overflow-auto outline-none", className)}
      {...props}
    />
  );
});

/**
 * Colour families an option can carry.
 *
 * The tone paints the option's icon or dot, not its label. Several of these
 * tokens — medium severity in particular — sit at around 3:1 against the
 * surface, which is fine for a 16px glyph but not for 13px body text, so the
 * label always stays at full contrast and the colour is carried by the mark
 * beside it. That is the same division the badges use.
 */
export type SelectTone =
  | "neutral"
  | "accent"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "critical"
  | "high"
  | "medium"
  | "low";

const toneClasses: Record<SelectTone, string> = {
  neutral: "text-text-muted",
  accent: "text-accent",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  critical: "text-severity-critical",
  high: "text-severity-high",
  medium: "text-severity-medium",
  low: "text-severity-low",
};

export interface SelectOption {
  value: string;
  label: string;
  /** Optional second line; `undefined` is accepted so callers can pass it
   *  conditionally under `exactOptionalPropertyTypes`. */
  description?: string | undefined;
  /**
   * Leading glyph, shown in the list and in the closed trigger.
   *
   * An option with a tone but no icon gets a filled dot instead, so a set of
   * states can be colour-coded without inventing an icon for each one.
   */
  icon?: ReactNode | undefined;
  tone?: SelectTone | undefined;
  disabled?: boolean | undefined;
}

/** The leading mark: the option's own icon, or a tone-coloured dot. */
function OptionMark({
  option,
  className,
}: {
  option: SelectOption;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center",
        toneClasses[option.tone ?? "neutral"],
        className,
      )}
    >
      {option.icon ?? <span className="size-2 rounded-full bg-current" />}
    </span>
  );
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  className,
  contentClassName,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: string | undefined;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  className?: string;
  contentClassName?: string;
  disabled?: boolean;
  "aria-label"?: string;
}): React.JSX.Element {
  const selected = options.find((option) => option.value === value);

  // A mark is reserved for every row as soon as one row has something to show
  // there, so the labels stay on one left edge instead of stepping in and out
  // as the eye runs down the list.
  const marked = options.some(
    (option) => option.icon !== undefined || option.tone !== undefined,
  );

  // Radix's props are not declared as accepting `undefined`, and this project
  // runs with `exactOptionalPropertyTypes`, so optional props are omitted
  // rather than passed as undefined.
  return (
    <SelectPrimitive.Root
      {...(value === undefined ? {} : { value })}
      onValueChange={onValueChange}
      {...(disabled === undefined ? {} : { disabled })}
    >
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          "group flex h-9 w-full items-center justify-between gap-1.5",
          "rounded-(--cv-radius) border border-border bg-surface px-2",
          "text-left text-[13px] text-text",
          "transition-[background-color,border-color] duration-100",
          "hover:border-border-strong hover:bg-surface-hover",
          "focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
          // Open is a held state, and the trigger is the only thing anchoring
          // the panel to the field it belongs to.
          "data-[state=open]:border-focus data-[state=open]:bg-surface-hover",
          "data-[placeholder]:text-text-muted",
          "disabled:cursor-not-allowed disabled:opacity-60",
          "disabled:hover:border-border disabled:hover:bg-surface",
          className,
        )}
      >
        <SelectPrimitive.Value
          className="min-w-0 flex-1 truncate"
          placeholder={placeholder}
        >
          {selected === undefined ? null : (
            <span className="flex min-w-0 items-center gap-1.5">
              {marked ? <OptionMark option={selected} /> : null}
              <span className="truncate">{selected.label}</span>
            </span>
          )}
        </SelectPrimitive.Value>
        <SelectPrimitive.Icon asChild>
          <ChevronDown
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-text-muted",
              "transition-transform duration-150 motion-reduce:transition-none",
              "group-data-[state=open]:rotate-180",
            )}
          />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={5}
          collisionPadding={8}
          className={cn(
            "z-50 overflow-hidden rounded-(--cv-radius-lg) border border-border-strong",
            "bg-surface shadow-lg",
            // Never narrower than the field it belongs to, and never taller
            // than the space actually left on screen — without the second
            // clamp a select near the bottom edge renders a panel that runs
            // off it.
            "min-w-(--radix-select-trigger-width)",
            "max-h-[min(20rem,var(--radix-select-content-available-height))]",
            // Grows out of the corner nearest the trigger, whichever side the
            // popper chose.
            "origin-(--radix-select-content-transform-origin)",
            "data-[state=open]:animate-popover-in",
            contentClassName,
          )}
        >
          <SelectPrimitive.ScrollUpButton className="flex h-5 items-center justify-center bg-surface text-text-muted">
            <ChevronUp aria-hidden className="size-3.5" />
          </SelectPrimitive.ScrollUpButton>

          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                {...(option.disabled === undefined
                  ? {}
                  : { disabled: option.disabled })}
                className={cn(
                  "relative flex cursor-pointer select-none items-start gap-2",
                  "rounded-(--cv-radius) py-1.5 pl-2 pr-7 text-[13px] outline-none",
                  "transition-colors duration-75 motion-reduce:transition-none",
                  // Radix writes `data-highlighted` as an empty attribute, so
                  // this must not be matched against a value.
                  "data-[highlighted]:bg-surface-hover",
                  "data-[state=checked]:bg-accent/10",
                  "data-[state=checked]:data-[highlighted]:bg-accent/16",
                  "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                )}
              >
                {marked ? (
                  <OptionMark option={option} className="mt-[3px]" />
                ) : null}
                <span className="min-w-0 flex-1">
                  <SelectPrimitive.ItemText>
                    {option.label}
                  </SelectPrimitive.ItemText>
                  {option.description === undefined ? null : (
                    <span className="mt-0.5 block text-[11px] leading-4 text-text-muted">
                      {option.description}
                    </span>
                  )}
                </span>
                <SelectPrimitive.ItemIndicator className="absolute right-2 top-2">
                  <Check aria-hidden className="size-3.5 text-accent" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>

          <SelectPrimitive.ScrollDownButton className="flex h-5 items-center justify-center bg-surface text-text-muted">
            <ChevronDown aria-hidden className="size-3.5" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
