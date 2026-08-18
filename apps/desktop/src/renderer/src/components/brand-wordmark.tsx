import type { ElementType } from "react";

import { cn } from "@codevault/ui";

export interface BrandWordmarkProps {
  as?: "div" | "h1";
  className?: string;
  compact?: boolean;
}

export function BrandWordmark({
  as: Component = "div",
  className,
  compact = false,
}: BrandWordmarkProps): React.JSX.Element {
  const Wordmark = Component as ElementType;

  return (
    <Wordmark
      className={cn("flex items-baseline gap-1.5 leading-none", className)}
    >
      <span
        className={cn(
          "font-semibold tracking-tight text-text",
          compact ? "text-[14px]" : "text-[16px]",
        )}
      >
        CodeVault
      </span>{" "}
      <strong
        className={cn(
          "cv-brand-security font-semibold tracking-[-0.025em]",
          compact ? "text-[15px]" : "text-[17px]",
        )}
      >
        Security
      </strong>
    </Wordmark>
  );
}
