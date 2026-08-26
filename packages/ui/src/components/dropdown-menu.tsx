import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight } from "lucide-react";
import { forwardRef } from "react";

import { cn } from "../lib/cn.js";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export const DropdownMenuContent = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(function DropdownMenuContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-44 origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden",
          "rounded-(--cv-radius-lg) border border-border bg-surface p-1 text-[13px] text-text",
          "shadow-lg focus:outline-none data-[state=closed]:hidden data-[state=open]:animate-popover-in motion-reduce:animate-none",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
});

export const DropdownMenuItem = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(function DropdownMenuItem({ className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      className={cn(
        "flex min-h-9 cursor-default select-none items-center gap-2 rounded-(--cv-radius) px-2 py-1.5 outline-none",
        "text-text-muted data-[highlighted]:bg-surface-hover data-[highlighted]:text-text",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45",
        className,
      )}
      {...props}
    />
  );
});

export const DropdownMenuLabel = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(function DropdownMenuLabel({ className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Label
      ref={ref}
      className={cn("px-2 py-1.5", className)}
      {...props}
    />
  );
});

export const DropdownMenuSeparator = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(function DropdownMenuSeparator({ className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Separator
      ref={ref}
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
});

export const DropdownMenuCheckboxItem = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(function DropdownMenuCheckboxItem({ children, className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      ref={ref}
      className={cn(
        "relative flex min-h-9 cursor-default select-none items-center rounded-(--cv-radius) py-1.5 pl-8 pr-2 outline-none",
        "text-text-muted data-[highlighted]:bg-surface-hover data-[highlighted]:text-text",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check aria-hidden className="size-3.5" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
});

export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuSubTrigger = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>
>(function DropdownMenuSubTrigger({ children, className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      ref={ref}
      className={cn(
        "flex min-h-9 cursor-default select-none items-center gap-2 rounded-(--cv-radius) px-2 py-1.5 outline-none",
        "text-text-muted data-[highlighted]:bg-surface-hover data-[highlighted]:text-text data-[state=open]:bg-surface-hover",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight aria-hidden className="ml-auto size-3.5" />
    </DropdownMenuPrimitive.SubTrigger>
  );
});

export const DropdownMenuSubContent = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(function DropdownMenuSubContent({ className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.SubContent
      ref={ref}
      className={cn(
        "z-50 min-w-40 origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden",
        "rounded-(--cv-radius-lg) border border-border bg-surface p-1 text-[13px] text-text",
        "shadow-lg focus:outline-none data-[state=closed]:hidden data-[state=open]:animate-popover-in motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
});
