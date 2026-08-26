import { CalendarPlus } from "lucide-react";
import { useState } from "react";

import type { Embargo } from "@codevault/contracts";
import { exportDisclosureCalendar } from "@codevault/exchange/disclosure-calendar";
import { Button } from "@codevault/ui";

import { bridge } from "../../lib/bridge.js";

export function DisclosureCalendarButton({
  caseId,
  caseRef,
  caseTitle,
  embargo,
}: {
  caseId: string;
  caseRef: string;
  caseTitle: string;
  embargo: Embargo | null;
}): React.JSX.Element {
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dates = {
    expectedResponseAt: embargo?.expectedResponseAt ?? null,
    startsAt: embargo?.startsAt ?? null,
    endsAt: embargo?.endsAt ?? null,
    plannedDisclosureAt: embargo?.plannedDisclosureAt ?? null,
  };
  const hasDates = Object.values(dates).some((value) => value !== null);

  const save = async (): Promise<void> => {
    if (!hasDates) return;
    setExporting(true);
    setMessage(null);

    try {
      const calendar = exportDisclosureCalendar({
        caseId,
        caseRef,
        caseTitle,
        generatedAt: new Date().toISOString(),
        dates,
      });
      const outcome = await bridge().disclosure.saveCalendar(caseId, calendar);

      if (!outcome.ok) {
        setMessage(`${outcome.message} Choose Export calendar to retry.`);
      } else if (outcome.data.saved) {
        setMessage(
          `Calendar saved. SHA-256 ${outcome.data.sha256?.slice(0, 12)}…`,
        );
      }
    } catch {
      setMessage("The disclosure calendar could not be saved.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="ml-auto flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="secondary"
        disabled={!hasDates}
        loading={exporting}
        title={hasDates ? undefined : "Add a disclosure date before exporting"}
        onClick={() => void save()}
      >
        <CalendarPlus aria-hidden className="size-3.5" />
        Export calendar
      </Button>
      {message === null ? null : (
        <span
          className="max-w-64 text-right text-[10px] text-text-muted"
          role="status"
        >
          {message}
        </span>
      )}
    </div>
  );
}
