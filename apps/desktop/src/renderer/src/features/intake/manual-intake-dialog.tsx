import { useState } from "react";

import type { IntakeItem } from "@codevault/contracts";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  Input,
  Label,
  Textarea,
} from "@codevault/ui";

import { errorHeading, queryKeys, useApiMutation } from "../../lib/api.js";

export function ManualIntakeDialog({
  open,
  onOpenChange,
  caseId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
}): React.JSX.Element {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [technical, setTechnical] = useState("");
  const [impact, setImpact] = useState("");
  const [remediation, setRemediation] = useState("");

  const create = useApiMutation<IntakeItem>(
    () => ({
      path: "/v1/intake/manual",
      method: "POST",
      body: {
        caseId,
        sourceLabel: "Manual entry",
        draft: {
          title: title.trim(),
          ...(summary.trim() === "" ? {} : { summaryMarkdown: summary.trim() }),
          ...(technical.trim() === ""
            ? {}
            : { technicalMarkdown: technical.trim() }),
          ...(impact.trim() === "" ? {} : { impactMarkdown: impact.trim() }),
          ...(remediation.trim() === ""
            ? {}
            : { remediationMarkdown: remediation.trim() }),
          suggestedCweIds: [],
          affectedVersions: [],
        },
        citations: [],
      },
    }),
    () => [queryKeys.intake(caseId)],
  );

  const submit = (): void => {
    create.mutate(undefined, {
      onSuccess: () => {
        onOpenChange(false);
        setTitle("");
        setSummary("");
        setTechnical("");
        setImpact("");
        setRemediation("");
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        width="max-w-2xl"
        title="Record an existing finding"
        description="This creates a reviewable draft, not a canonical finding."
      >
        <DialogBody className="space-y-3">
          <div>
            <Label htmlFor="manual-intake-title">Title</Label>
            <Input
              id="manual-intake-title"
              className="mt-1"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
            />
          </div>
          {(
            [
              ["Summary", summary, setSummary],
              ["Technical description", technical, setTechnical],
              ["Impact", impact, setImpact],
              ["Remediation", remediation, setRemediation],
            ] as const
          ).map(([label, value, setter]) => (
            <div key={label}>
              <Label>{label}</Label>
              <Textarea
                className="mt-1 min-h-20"
                value={value}
                onChange={(event) => setter(event.target.value)}
              />
            </div>
          ))}
          {create.error === null ? null : (
            <p className="text-[12px] text-danger">
              {errorHeading(create.error)}. {create.error.message}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={title.trim().length < 8 || create.isPending}
            onClick={submit}
          >
            Add to intake
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
