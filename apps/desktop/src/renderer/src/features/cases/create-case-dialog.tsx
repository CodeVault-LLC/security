import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import type { CaseDetail } from "@codevault/contracts";
import { CASE_PROFILES, type CaseProfile } from "@codevault/core";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  Input,
  Label,
  Select,
  Textarea,
} from "@codevault/ui";

import { errorHeading, queryKeys, useApiMutation } from "../../lib/api.js";

/**
 * Case creation.
 *
 * Three fields. A research case starts the moment someone has a target and a
 * reason, and asking for a scope statement, a client and a methodology first is
 * how a tool stops being used at the moment it is most useful.
 */

const PROFILE_DESCRIPTIONS: Record<CaseProfile, string> = {
  STANDARD: "Ordinary research. No disclosure workflow until you turn it on.",
  COORDINATED_DISCLOSURE:
    "Vendor report required, and a contact must be recorded before you log first contact.",
  CRITICAL_ZERO_DAY:
    "Restricted to named members, peer review before the vendor report, second approver required.",
  PROGRAM:
    "Programme requirements: both CVSS versions, fixed sections, two-person approval.",
};

export interface CreateCaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateCaseDialog({
  open,
  onOpenChange,
}: CreateCaseDialogProps): React.JSX.Element {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [profile, setProfile] = useState<CaseProfile>("STANDARD");
  const [summary, setSummary] = useState("");

  const create = useApiMutation<CaseDetail>(
    () => ({
      path: "/v1/cases",
      method: "POST",
      body: {
        title: title.trim(),
        profile,
        ...(summary.trim().length === 0 ? {} : { summary: summary.trim() }),
      },
    }),
    () => [queryKeys.cases(), queryKeys.dashboard],
  );

  const submit = (): void => {
    if (title.trim().length === 0) {
      return;
    }

    create.mutate(undefined, {
      onSuccess: (created) => {
        onOpenChange(false);
        setTitle("");
        setSummary("");
        setProfile("STANDARD");
        void navigate({ to: `/cases/${created.id}` });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New research case"
        description="Everything else can be filled in as the research goes."
      >
        <DialogBody className="space-y-3">
          <div>
            <Label htmlFor="case-title">Title</Label>
            <Input
              id="case-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Acme Router RT-1200 firmware review"
              autoFocus
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="case-profile">Profile</Label>
            <Select
              aria-label="Case profile"
              value={profile}
              onValueChange={(value) => setProfile(value as CaseProfile)}
              className="mt-1"
              options={CASE_PROFILES.map((value) => ({
                value,
                label: value
                  .toLowerCase()
                  .split("_")
                  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                  .join(" "),
                description: PROFILE_DESCRIPTIONS[value],
              }))}
            />
          </div>

          <div>
            <Label htmlFor="case-summary">Summary (optional)</Label>
            <Textarea
              id="case-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              rows={3}
              placeholder="What is being researched, and why."
              className="mt-1"
            />
          </div>

          {create.error === null ? null : (
            <p className="rounded-(--cv-radius) border border-danger/40 bg-danger/10 px-2 py-1.5 text-[12px] text-danger">
              <span className="font-medium">{errorHeading(create.error)}.</span>{" "}
              {create.error.message}
            </p>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={title.trim().length === 0 || create.isPending}
          >
            {create.isPending ? "Creating…" : "Create case"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
