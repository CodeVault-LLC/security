import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

import type { SubmissionValidationResult } from "@codevault/contracts";

export function SubmissionValidator({
  result,
}: {
  result: SubmissionValidationResult | undefined;
}): React.JSX.Element {
  if (result === undefined) {
    return <p className="text-[12px] text-text-muted">Checking submission…</p>;
  }
  if (result.findings.length === 0) {
    return (
      <p className="flex items-center gap-2 text-[12px] text-success">
        <CheckCircle2 className="size-3.5" aria-hidden />
        No validation findings
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {result.findings.map((finding) => (
        <li
          key={`${finding.code}:${finding.field ?? ""}`}
          className={`flex items-start gap-2 text-[12px] ${
            finding.severity === "BLOCKING"
              ? "text-danger"
              : finding.severity === "WARNING"
                ? "text-warning"
                : "text-text-muted"
          }`}
        >
          {finding.severity === "INFO" ? (
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          ) : (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          )}
          <span>
            <span className="font-medium">{finding.code}</span> —{" "}
            {finding.message}
          </span>
        </li>
      ))}
    </ul>
  );
}
