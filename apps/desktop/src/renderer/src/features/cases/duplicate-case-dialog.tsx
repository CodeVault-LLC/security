import { useNavigate } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import { useState } from "react";

import type { CaseDetail } from "@codevault/contracts";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  Input,
  Label,
} from "@codevault/ui";

import { errorHeading, queryKeys, useApiMutation } from "../../lib/api.js";

export function DuplicateCaseButton({
  source,
}: {
  source: CaseDetail;
}): React.JSX.Element {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(`${source.title} copy`);
  const [copyAssets, setCopyAssets] = useState(true);
  const [copyMembers, setCopyMembers] = useState(false);

  const duplicate = useApiMutation<
    CaseDetail,
    { title: string; copyAssets: boolean; copyMembers: boolean }
  >(
    (body) => ({
      path: `/v1/cases/${source.id}/duplicate`,
      method: "POST",
      body,
    }),
    () => [queryKeys.cases()],
  );

  const submit = (): void => {
    const nextTitle = title.trim();
    if (nextTitle.length === 0) return;
    duplicate.mutate(
      { title: nextTitle, copyAssets, copyMembers },
      {
        onSuccess: (created) => {
          setOpen(false);
          void navigate({ to: `/cases/${created.id}` });
        },
      },
    );
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Copy aria-hidden className="size-3.5" />
        Duplicate
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Duplicate case as template"
          description="Creates a clean, open case with the same profile, summary, disclosure setting, restriction, and policy packs. Findings, notes, evidence, reports, and disclosure history are never copied."
        >
          <DialogBody className="space-y-3">
            <div>
              <Label htmlFor="duplicate-case-title">New case title</Label>
              <Input
                id="duplicate-case-title"
                value={title}
                maxLength={200}
                autoFocus
                className="mt-1"
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>

            <CopyOption
              checked={copyAssets}
              label="Copy linked assets"
              description="Reuse case-level target links without copying findings."
              onChange={setCopyAssets}
            />
            <CopyOption
              checked={copyMembers}
              label="Copy case members"
              description="Reuse explicit member access levels. You become the new owner."
              onChange={setCopyMembers}
            />

            {duplicate.error === null ? null : (
              <p className="rounded-(--cv-radius) border border-danger/40 bg-danger/10 px-2 py-1.5 text-[12px] text-danger">
                <span className="font-medium">
                  {errorHeading(duplicate.error)}.
                </span>{" "}
                {duplicate.error.message}
              </p>
            )}
          </DialogBody>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={duplicate.isPending}
              disabled={title.trim().length === 0}
              onClick={submit}
            >
              <Copy aria-hidden className="size-3.5" />
              Create duplicate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CopyOption({
  checked,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  label: string;
  description: string;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-(--cv-radius) border border-border px-2.5 py-2 text-[12px] hover:bg-surface-hover">
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        className="mt-0.5 size-3.5 accent-accent"
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-text-muted">{description}</span>
      </span>
    </label>
  );
}
