import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as SelectPrimitive from "@radix-ui/react-select";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { Check, ChevronDown, X } from "lucide-react";
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
          "fixed left-1/2 top-1/2 z-50 w-[min(92vw,var(--dialog-width))] -translate-x-1/2 -translate-y-1/2",
          "rounded-[--radius-lg] border border-border-strong bg-surface shadow-2xl",
          width,
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-[14px] font-semibold">
              {title}
            </DialogPrimitive.Title>
            {description === undefined ? null : (
              <DialogPrimitive.Description className="mt-0.5 text-[12px] text-text-muted">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            className="rounded-[--radius] p-1 text-text-muted hover:bg-surface-hover hover:text-text"
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

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        "flex items-center gap-0.5 border-b border-border px-2",
        className,
      )}
      {...props}
    />
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
        "relative -mb-px border-b-2 border-transparent px-2.5 py-1.5 text-[12px] text-text-muted",
        "hover:text-text data-[state=active]:border-accent data-[state=active]:text-text",
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

export interface SelectOption {
  value: string;
  label: string;
  /** Optional second line; `undefined` is accepted so callers can pass it
   *  conditionally under `exactOptionalPropertyTypes`. */
  description?: string | undefined;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  className,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: string | undefined;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}): React.JSX.Element {
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
          "flex h-7 w-full items-center justify-between gap-2 rounded-[--radius] border border-border",
          "bg-surface px-2 text-[13px] disabled:opacity-60",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown aria-hidden className="size-3.5 text-text-muted" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-72 overflow-hidden rounded-[--radius] border border-border-strong bg-surface shadow-xl"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className="flex cursor-pointer items-start gap-2 rounded-[--radius] px-2 py-1.5 text-[13px] data-[highlighted=true]:bg-surface-hover data-[highlighted=true]:outline-none"
              >
                <SelectPrimitive.ItemIndicator className="mt-0.5">
                  <Check aria-hidden className="size-3 text-accent" />
                </SelectPrimitive.ItemIndicator>
                <span className="min-w-0">
                  <SelectPrimitive.ItemText>
                    {option.label}
                  </SelectPrimitive.ItemText>
                  {option.description === undefined ? null : (
                    <span className="block text-[11px] text-text-muted">
                      {option.description}
                    </span>
                  )}
                </span>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
