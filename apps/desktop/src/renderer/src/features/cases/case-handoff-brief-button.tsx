import { FileDown } from "lucide-react";
import { useState } from "react";

import type {
  AuditEvent,
  CaseDetail,
  CaseReadiness,
  DisclosureOverview,
  FindingSummary,
} from "@codevault/contracts";
import { buildCaseHandoffBrief } from "@codevault/exchange/case-handoff-brief";
import { Button } from "@codevault/ui";

import { queryKeys, useApiQuery } from "../../lib/api.js";
import { bridge } from "../../lib/bridge.js";

interface AuditPage {
  items: AuditEvent[];
  nextCursor: string | null;
}

export interface CaseHandoffBriefButtonProps {
  researchCase: CaseDetail;
  findings: readonly FindingSummary[] | undefined;
  readiness: CaseReadiness | undefined;
}

export function CaseHandoffBriefButton({
  researchCase,
  findings,
  readiness,
}: CaseHandoffBriefButtonProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const activity = useApiQuery<AuditPage>(
    queryKeys.activity({ caseId: researchCase.id }),
    `/v1/activity?caseId=${encodeURIComponent(researchCase.id)}&limit=200`,
  );
  const disclosure = useApiQuery<DisclosureOverview>(
    queryKeys.disclosure(researchCase.id),
    `/v1/cases/${researchCase.id}/disclosure`,
    { enabled: researchCase.disclosureEnabled },
  );
  const loading =
    findings === undefined ||
    readiness === undefined ||
    activity.isLoading ||
    (researchCase.disclosureEnabled && disclosure.isLoading);

  const exportBrief = async (): Promise<void> => {
    setMessage(null);
    if (
      findings === undefined ||
      readiness === undefined ||
      activity.data === undefined ||
      (researchCase.disclosureEnabled && disclosure.data === undefined)
    ) {
      setMessage("Handoff data is unavailable. Refresh the case and retry.");
      return;
    }

    setBusy(true);
    try {
      const markdown = buildCaseHandoffBrief({
        researchCase,
        findings,
        readiness,
        disclosure: researchCase.disclosureEnabled
          ? (disclosure.data ?? null)
          : null,
        activity: activity.data.items,
        generatedAt: new Date().toISOString(),
      });
      const outcome = await bridge().caseHandoff.saveBrief(
        researchCase.id,
        markdown,
      );
      if (!outcome.ok) {
        setMessage(`${outcome.message} Choose Handoff brief to retry.`);
      } else if (outcome.data.saved) {
        setMessage(
          `Handoff brief saved. SHA-256 ${outcome.data.sha256?.slice(0, 12)}…`,
        );
      }
    } catch {
      setMessage("The handoff brief could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="secondary"
        loading={busy || loading}
        onClick={() => void exportBrief()}
      >
        <FileDown aria-hidden className="size-3.5" />
        Handoff brief
      </Button>
      {message === null ? null : (
        <span
          className="max-w-72 text-right text-[10px] text-text-muted"
          role="status"
        >
          {message}
        </span>
      )}
    </div>
  );
}
