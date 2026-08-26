import { FileText, ShieldAlert } from "lucide-react";
import { useState } from "react";

import type { FindingDetail } from "@codevault/contracts";
import { buildPublicAdvisory } from "@codevault/exchange/public-advisory";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  Textarea,
} from "@codevault/ui";

import { bridge } from "../../lib/bridge.js";

export function PublicAdvisoryBuilder({
  finding,
  canEdit,
}: {
  finding: FindingDetail;
  canEdit: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [markdown, setMarkdown] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const publishable =
    finding.visibility === "PUBLIC" && finding.disclosureState === "PUBLIC";
  const canSave = canEdit && publishable && markdown.trim().length > 0;

  const openPreview = (): void => {
    setMarkdown(
      buildPublicAdvisory({
        finding,
        generatedAt: new Date().toISOString(),
      }),
    );
    setMessage(null);
    setOpen(true);
  };

  const save = async (): Promise<void> => {
    if (!canSave) return;

    setSaving(true);
    setMessage(null);
    try {
      const outcome = await bridge().publicAdvisory.save(finding.id, markdown);
      if (!outcome.ok) {
        setMessage(`${outcome.message} Review the advisory and retry.`);
      } else if (outcome.data.saved) {
        setMessage(
          `Advisory saved. SHA-256 ${outcome.data.sha256?.slice(0, 12)}…`,
        );
      }
    } catch {
      setMessage("The advisory could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Public advisory</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3 text-[12px]">
          <p className="leading-5 text-text-muted">
            Build an editable Markdown advisory from approved public fields.
            Private research and internal references are excluded.
          </p>
          {!publishable ? (
            <div className="flex gap-2 rounded-(--cv-radius) border border-warning/30 bg-warning/5 p-2 text-warning">
              <ShieldAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <p className="leading-4">
                Saving unlocks when both visibility and disclosure are Public.
              </p>
            </div>
          ) : null}
          <Button size="sm" variant="secondary" onClick={openPreview}>
            <FileText aria-hidden className="size-3.5" />
            Build advisory
          </Button>
        </CardBody>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogBodyWrapper
          markdown={markdown}
          setMarkdown={setMarkdown}
          publishable={publishable}
          canEdit={canEdit}
          saving={saving}
          message={message}
          onCancel={() => setOpen(false)}
          onSave={() => void save()}
        />
      </Dialog>
    </>
  );
}

function DialogBodyWrapper({
  markdown,
  setMarkdown,
  publishable,
  canEdit,
  saving,
  message,
  onCancel,
  onSave,
}: {
  markdown: string;
  setMarkdown: (value: string) => void;
  publishable: boolean;
  canEdit: boolean;
  saving: boolean;
  message: string | null;
  onCancel: () => void;
  onSave: () => void;
}): React.JSX.Element {
  return (
    <DialogContent
      title="Public advisory preview"
      description="A publication-safe projection you can edit before saving."
      width="max-w-4xl"
    >
      <DialogBody className="space-y-3">
        <p className="text-[12px] leading-5 text-text-muted">
          Review every line before publication. This projection includes the
          summary, impact, remediation, affected versions, public identifiers,
          and public references only.
        </p>
        <Textarea
          aria-label="Public advisory Markdown"
          className="min-h-[50vh] resize-y font-mono text-[12px] leading-5"
          value={markdown}
          onChange={(event) => setMarkdown(event.target.value)}
          spellCheck={false}
        />
        {!canEdit ? (
          <p className="text-[11px] text-text-muted" role="status">
            You have read-only access. An editor can save this advisory.
          </p>
        ) : !publishable ? (
          <p className="text-[11px] text-warning" role="status">
            Save is blocked until visibility and disclosure are both Public.
          </p>
        ) : message === null ? null : (
          <p className="text-[11px] text-text-muted" role="status">
            {message}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Close
        </Button>
        <Button
          onClick={onSave}
          loading={saving}
          disabled={!canEdit || !publishable || markdown.trim().length === 0}
        >
          Save Markdown
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
