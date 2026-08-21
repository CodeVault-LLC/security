import { Download, Upload } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@codevault/ui";

import { bridge } from "../../lib/bridge.js";

export function ExportCaseArchiveButton({
  caseId,
}: {
  caseId: string;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const exportCase = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await bridge().caseArchives.exportCase(caseId);
      if (!outcome.ok) {
        setMessage(`${outcome.message} Choose Export case archive to retry.`);
      } else if (outcome.data.saved) {
        setMessage(
          `Case archive saved. SHA-256 ${outcome.data.sha256?.slice(0, 12)}…`,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        onClick={() => void exportCase()}
      >
        <Download aria-hidden className="size-3.5" />
        Export case archive
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

export function ImportCaseArchiveButton(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const importCase = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await bridge().caseArchives.importCase();
      if (!outcome.ok) {
        setMessage(`${outcome.message} Choose Import case archive to retry.`);
      } else if (outcome.data !== null) {
        setMessage(`${outcome.data.caseRef} was imported.`);
        await queryClient.invalidateQueries({ queryKey: ["cases"] });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        onClick={() => void importCase()}
      >
        <Upload aria-hidden className="size-3.5" />
        Import case archive
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
