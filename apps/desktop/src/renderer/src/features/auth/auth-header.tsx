import { ShieldCheck } from "lucide-react";

import { BrandWordmark } from "../../components/brand-wordmark.js";

export function AuthHeader(): React.JSX.Element {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-(--cv-radius) border border-accent/20 bg-accent/10">
        <ShieldCheck aria-hidden className="size-4.5 text-accent" />
      </div>
      <div>
        <BrandWordmark as="h1" />
        <p className="mt-0.5 text-[11px] text-text-muted">
          Security research. Responsible disclosure.
        </p>
      </div>
    </div>
  );
}
