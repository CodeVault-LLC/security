import { useState } from "react";

import type { FindingSummary } from "@codevault/contracts";
import { REMEDIATION_STATES, type RemediationState } from "@codevault/core";
import { Button, Select, stateSelectOptions } from "@codevault/ui";

import { queryKeys, useApiMutation } from "../../lib/api.js";
import { humanise } from "../../lib/format.js";

export function BulkRemediationControls({
  caseId,
  findings,
  selectedIds,
  onComplete,
}: {
  caseId: string;
  findings: readonly FindingSummary[];
  selectedIds: ReadonlySet<string>;
  onComplete: () => void;
}): React.JSX.Element {
  const [target, setTarget] = useState<RemediationState>("FIXED");
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const selected = findings.filter((finding) => selectedIds.has(finding.id));
  const update = useApiMutation<
    { updatedIds: string[] },
    { target: RemediationState; findings: FindingSummary[] }
  >(
    ({ target: remediationState, findings: chosen }) => ({
      path: "/v1/findings/actions/bulk-remediation",
      method: "POST",
      body: {
        caseId,
        remediationState,
        items: chosen.map((finding) => ({
          id: finding.id,
          expectedRevision: finding.revision,
        })),
      },
    }),
    () => [
      queryKeys.findings({ caseId }),
      queryKeys.caseReadiness(caseId),
      queryKeys.dashboard,
    ],
  );

  const apply = (): void => {
    update.mutate(
      { target, findings: selected },
      {
        onSuccess: (result) => {
          setMessage(
            `${result.updatedIds.length} finding${result.updatedIds.length === 1 ? "" : "s"} updated.`,
          );
          setConfirming(false);
          onComplete();
        },
      },
    );
  };

  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-text-muted">
          {selected.length} selected
        </span>
        <Select
          aria-label="Bulk remediation state"
          value={target}
          disabled={update.isPending}
          onValueChange={(value) => {
            setTarget(value as RemediationState);
            setConfirming(false);
            setMessage(null);
          }}
          options={stateSelectOptions("remediation", REMEDIATION_STATES)}
          className="w-44"
        />
        <Button
          size="sm"
          variant="primary"
          disabled={selected.length === 0 || update.isPending}
          onClick={() => {
            setConfirming(true);
            setMessage(null);
          }}
        >
          Review bulk change
        </Button>
        {message === null ? null : (
          <span className="text-[11px] text-text-muted" role="status">
            {message}
          </span>
        )}
      </div>

      {confirming && selected.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-warning/35 pt-2 text-[12px]">
          <p className="mr-auto font-medium text-warning">
            Set {selected.length} finding{selected.length === 1 ? "" : "s"} to{" "}
            {humanise(target)}? This creates one audit event per finding.
          </p>
          <Button
            size="sm"
            variant="ghost"
            disabled={update.isPending}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={update.isPending}
            onClick={apply}
          >
            Apply to {selected.length} finding
            {selected.length === 1 ? "" : "s"}
          </Button>
        </div>
      ) : null}

      {update.error === null ? null : (
        <p className="mt-2 text-[11px] text-danger" role="alert">
          {update.error.message} Refresh the case before retrying the batch.
        </p>
      )}
    </div>
  );
}
