import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
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
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-(--cv-radius) " +
    "text-[13px] font-medium disabled:pointer-events-none " +
    "disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 " +
    "focus-visible:outline-focus " +
    // A press has to be visible. `duration-75` on the transform keeps the
    // release snappy; anything slower reads as lag rather than as feedback.
    "transition-[background-color,border-color,color,transform] duration-100 " +
    "active:scale-[0.97] active:duration-75 motion-reduce:active:scale-100",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-accent-contrast hover:bg-accent-hover active:bg-accent-hover border border-transparent",
        secondary:
          "bg-surface text-text border border-border-strong hover:bg-surface-hover active:bg-surface-hover",
        ghost:
          "bg-transparent text-text-muted hover:bg-surface-hover hover:text-text active:bg-surface-hover active:text-text",
        danger:
          "bg-transparent text-danger border border-danger/40 hover:bg-danger/10 active:bg-danger/20",
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
  extends
    ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Renders the child element instead of a button, for links styled as buttons. */
  asChild?: boolean;
  /**
   * Shows a spinner in place of any leading icon and blocks further presses.
   *
   * The label stays put so the button keeps its width and the row it sits in
   * does not reflow the moment someone clicks it.
   */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      children,
      disabled,
      ...props
    },
    ref,
  ) {
    const Component = asChild ? Slot : "button";

    // `asChild` hands rendering to the caller's element, which cannot be given
    // a spinner without changing its children, so the flag only guards input.
    if (asChild) {
      return (
        <Component
          ref={ref}
          className={cn(buttonVariants({ variant, size }), className)}
          {...(disabled === undefined ? {} : { disabled })}
          {...props}
        >
          {children}
        </Component>
      );
    }

    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled === true || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <Loader2
            aria-hidden
            className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
          />
        ) : null}
        {children}
      </button>
    );
  },
);

/**
 * A row of buttons joined into one control.
 *
 * The children keep their own variants; this only removes the seam between
 * them, so a split action and its menu read as a single object rather than two
 * buttons that happen to be adjacent.
 */
export function ButtonGroup({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      role="group"
      className={cn(
        "inline-flex items-center",
        // Square the inner edges and collapse the doubled border, without the
        // call site having to know which child is first or last.
        "[&>*:not(:first-child)]:-ml-px [&>*:not(:first-child)]:rounded-l-none",
        "[&>*:not(:last-child)]:rounded-r-none",
        // A focused or hovered member has to paint its border over its
        // neighbour's, or the ring is clipped along the seam.
        "[&>*:focus-visible]:relative [&>*:focus-visible]:z-10",
        "[&>*:hover]:relative [&>*:hover]:z-10",
        className,
      )}
      {...props}
    />
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-7 w-full rounded-(--cv-radius) border border-border bg-surface px-2 text-[13px]",
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
        "w-full rounded-(--cv-radius) border border-border bg-surface px-2 py-1.5 text-[13px]",
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
        "rounded-(--cv-radius-lg) border border-border bg-surface",
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

/** A spinner. Decorative on its own; pair it with text that says what is loading. */
export function Spinner({
  className,
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <Loader2
      aria-hidden
      className={cn(
        "size-4 shrink-0 animate-spin text-text-muted motion-reduce:animate-none",
        className,
      )}
    />
  );
}

/**
 * The waiting state for a panel or a page.
 *
 * Announced politely so a screen reader reports that something is in progress
 * rather than leaving the region silently empty.
 */
export function LoadingState({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center justify-center gap-2 px-4 py-8 text-[12px] text-text-muted",
        className,
      )}
    >
      <Spinner className="size-3.5" />
      {label}
    </div>
  );
}

/**
 * A failure that the researcher needs to see.
 *
 * Errors are never swallowed into an empty list: a findings table that is
 * blank because a request failed looks exactly like a case with no findings,
 * and in this product that difference matters.
 */
export function ErrorState({
  title = "Something went wrong",
  description,
  action,
  className,
}: {
  title?: string;
  description?: string | undefined;
  action?: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-10 text-center",
        className,
      )}
    >
      <AlertTriangle aria-hidden className="size-5 text-danger" />
      <p className="text-[13px] font-medium text-text">{title}</p>
      {description === undefined ? null : (
        <p className="max-w-md text-[12px] text-text-muted">{description}</p>
      )}
      {action}
    </div>
  );
}

/** An inline failure, for a form or a panel where a full block is too much. */
export function InlineError({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <p
      role="alert"
      className={cn(
        "flex items-start gap-1.5 rounded-(--cv-radius) border border-danger/40",
        "bg-danger/10 px-2 py-1.5 text-[12px] text-danger",
        className,
      )}
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
    </p>
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
