import { useNavigate } from "@tanstack/react-router";
import {
  ClipboardList,
  FolderOpen,
  Handshake,
  ShieldAlert,
} from "lucide-react";
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
  type SelectTone,
} from "@codevault/ui";

import { errorHeading, queryKeys, useApiMutation } from "../../lib/api.js";
import { humanise } from "../../lib/format.js";

/**
 * Case creation.
 *
 * Three fields. A research case starts the moment someone has a target and a
 * reason, and asking for a scope statement, a client and a methodology first is
 * how a tool stops being used at the moment it is most useful.
 */

/**
 * The profiles, as the picker shows them.
 *
 * The tone is doing real work here: a profile is a set of rules the case is
 * then held to, and the escalation from "ordinary research" to "restricted,
 * two approvers" should be visible before someone commits to it rather than
 * discovered when the platform starts refusing things.
 */
const PROFILE_OPTIONS: Record<
  CaseProfile,
  { description: string; tone: SelectTone; icon: React.JSX.Element }
> = {
  STANDARD: {
    description:
      "Ordinary research. No disclosure workflow until you turn it on.",
    tone: "neutral",
    icon: <FolderOpen className="size-3.5" />,
  },
  COORDINATED_DISCLOSURE: {
    description:
      "Vendor report required, and a contact must be recorded before you log first contact.",
    tone: "info",
    icon: <Handshake className="size-3.5" />,
  },
  CRITICAL_ZERO_DAY: {
    description:
      "Restricted to named members, peer review before the vendor report, second approver required.",
    tone: "danger",
    icon: <ShieldAlert className="size-3.5" />,
  },
  PROGRAM: {
    description:
      "Programme requirements: both CVSS versions, fixed sections, two-person approval.",
    tone: "warning",
    icon: <ClipboardList className="size-3.5" />,
  },
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
                label: humanise(value),
                ...PROFILE_OPTIONS[value],
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
