import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { cn } from "../lib/cn.js";

/**
 * Base primitives.
 *
 * Deliberately plain: bordered surfaces, one accent, tight spacing. The visual
 * weight in CodeVault belongs to the data — a table of findings, a diff, an
 * evidence list — not to the chrome around it.
 */

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[--radius] " +
    "text-[13px] font-medium transition-colors disabled:pointer-events-none " +
    "disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 " +
    "focus-visible:outline-focus",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-accent-contrast hover:bg-accent-hover border border-transparent",
        secondary:
          "bg-surface text-text border border-border-strong hover:bg-surface-hover",
        ghost: "bg-transparent text-text-muted hover:bg-surface-hover hover:text-text",
        danger:
          "bg-transparent text-danger border border-danger/40 hover:bg-danger/10",
      },
      size: {
        sm: "h-6 px-2 text-[12px]",
        md: "h-7 px-2.5",
        lg: "h-9 px-4",
        icon: "h-7 w-7 p-0",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Renders the child element instead of a button, for links styled as buttons. */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ className, variant, size, asChild = false, ...props }, ref) {
    const Component = asChild ? Slot : "button";

    return (
      <Component
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-7 w-full rounded-[--radius] border border-border bg-surface px-2 text-[13px]",
        "placeholder:text-text-muted focus-visible:border-focus focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-[--radius] border border-border bg-surface px-2 py-1.5 text-[13px]",
        "placeholder:text-text-muted focus-visible:border-focus focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
});

export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn(
        "rounded-[--radius-lg] border border-border bg-surface",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 border-b border-border px-3 py-2",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>): React.JSX.Element {
  return (
    <h2
      className={cn(
        "text-[12px] font-semibold uppercase tracking-[0.08em] text-text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function CardBody({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("p-3", className)} {...props} />;
}

/** Monospace inline value: identifiers, vectors, paths, versions. */
export function Mono({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  return (
    <span
      className={cn("font-mono text-[12px] tabular-nums", className)}
      {...props}
    />
  );
}

export function Label({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>): React.JSX.Element {
  return (
    <label
      className={cn(
        "block text-[11px] font-medium uppercase tracking-[0.07em] text-text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="text-[13px] font-medium text-text">{title}</p>
      {description === undefined ? null : (
        <p className="max-w-md text-[12px] text-text-muted">{description}</p>
      )}
      {action}
    </div>
  );
}

export { buttonVariants };
