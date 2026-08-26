import { CalendarClock, Plus } from "lucide-react";
import { useState } from "react";

import type { ScannerSyncProfile } from "@codevault/contracts";
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
  Input,
  Label,
  LoadingState,
  Select,
} from "@codevault/ui";

import { QueryError } from "../../components/query-boundary.js";
import { queryKeys, useApiMutation, useApiQuery } from "../../lib/api.js";
import { formatDistanceToNowStrict } from "../../lib/dates.js";

export function ScannerSyncProfiles({
  caseId,
  canEdit,
}: {
  caseId: string;
  canEdit: boolean;
}): React.JSX.Element {
  const [creating, setCreating] = useState(false);
  const profiles = useApiQuery<{ items: ScannerSyncProfile[] }>(
    queryKeys.scannerSyncProfiles(caseId),
    `/v1/intake/scanner-profiles?caseId=${encodeURIComponent(caseId)}`,
  );
  const update = useApiMutation<
    ScannerSyncProfile,
    { profile: ScannerSyncProfile; enabled: boolean }
  >(
    ({ profile, enabled }) => ({
      path: `/v1/intake/scanner-profiles/${profile.id}`,
      method: "PATCH",
      body: { expectedRevision: profile.revision, enabled },
    }),
    () => [queryKeys.scannerSyncProfiles(caseId)],
  );

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Scanner sync profiles</CardTitle>
          <p className="mt-0.5 text-[11px] text-text-muted">
            Remember parser, source, deduplication, and review cadence without
            granting background access to local scanner output.
          </p>
        </div>
        {canEdit ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setCreating(true)}
          >
            <Plus aria-hidden className="size-3.5" />
            Add profile
          </Button>
        ) : null}
      </CardHeader>
      {profiles.error !== null ? (
        <QueryError query={profiles} className="m-3" />
      ) : profiles.isLoading ? (
        <LoadingState label="Loading scanner profiles…" />
      ) : profiles.data?.items.length === 0 ? (
        <CardBody className="text-[12px] text-text-muted">
          No recurring scanner review is configured for this case.
        </CardBody>
      ) : (
        <ul className="divide-y divide-border">
          {profiles.data?.items.map((profile) => (
            <li key={profile.id} className="flex items-start gap-3 px-3 py-2.5">
              <span className="mt-0.5 rounded-full bg-surface-raised p-2 text-text-muted">
                <CalendarClock aria-hidden className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium">{profile.name}</p>
                <p className="mt-0.5 text-[11px] text-text-muted">
                  {profile.sourceLabel} · {profile.format} · every{" "}
                  {cadenceLabel(profile.cadenceHours)}
                </p>
                <p className="mt-0.5 text-[11px] text-text-muted">
                  {profile.enabled
                    ? `Next review ${formatDistanceToNowStrict(profile.nextRunAt)}`
                    : "Review schedule paused"}
                  {profile.deduplicationPolicy === "SKIP_MATCHING_TITLES"
                    ? " · skip matching titles"
                    : " · stage every result"}
                </p>
              </div>
              {canEdit ? (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={update.isPending}
                  onClick={() =>
                    update.mutate({ profile, enabled: !profile.enabled })
                  }
                >
                  {profile.enabled ? "Pause" : "Resume"}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {update.error === null ? null : (
        <p className="border-t border-border px-3 py-2 text-[11px] text-danger">
          {update.error.message}
        </p>
      )}
      <CreateScannerSyncProfileDialog
        open={creating}
        onOpenChange={setCreating}
        caseId={caseId}
      />
    </Card>
  );
}

function CreateScannerSyncProfileDialog({
  open,
  onOpenChange,
  caseId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [format, setFormat] = useState<ScannerSyncProfile["format"]>("SARIF");
  const [cadenceHours, setCadenceHours] = useState(24);
  const [deduplicationPolicy, setDeduplicationPolicy] = useState<
    ScannerSyncProfile["deduplicationPolicy"]
  >("SKIP_MATCHING_TITLES");
  const create = useApiMutation<ScannerSyncProfile>(
    () => ({
      path: "/v1/intake/scanner-profiles",
      method: "POST",
      body: {
        caseId,
        name: name.trim(),
        sourceLabel: sourceLabel.trim(),
        format,
        cadenceHours,
        deduplicationPolicy,
      },
    }),
    () => [queryKeys.scannerSyncProfiles(caseId)],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add scanner sync profile"
        description="Define how often this case should review one scanner's finding exchange. Imports remain reviewable drafts."
      >
        <DialogBody className="space-y-3">
          <div>
            <Label htmlFor="scanner-profile-name">Profile name</Label>
            <Input
              id="scanner-profile-name"
              className="mt-1"
              value={name}
              placeholder="Nightly Semgrep"
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="scanner-source-label">Source label</Label>
            <Input
              id="scanner-source-label"
              className="mt-1"
              value={sourceLabel}
              placeholder="Semgrep CI"
              onChange={(event) => setSourceLabel(event.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Exchange format</Label>
              <Select
                value={format}
                onValueChange={(value) =>
                  setFormat(value as ScannerSyncProfile["format"])
                }
                options={[
                  { value: "SARIF", label: "SARIF" },
                  { value: "JSON", label: "CodeVault JSON" },
                  { value: "CSV", label: "CSV" },
                ]}
              />
            </div>
            <div>
              <Label>Review cadence</Label>
              <Select
                value={String(cadenceHours)}
                onValueChange={(value) => setCadenceHours(Number(value))}
                options={[
                  { value: "24", label: "Daily" },
                  { value: "168", label: "Weekly" },
                  { value: "720", label: "Every 30 days" },
                ]}
              />
            </div>
          </div>
          <div>
            <Label>Deduplication</Label>
            <Select
              value={deduplicationPolicy}
              onValueChange={(value) =>
                setDeduplicationPolicy(
                  value as ScannerSyncProfile["deduplicationPolicy"],
                )
              }
              options={[
                {
                  value: "SKIP_MATCHING_TITLES",
                  label: "Skip matching titles",
                  description:
                    "Stage only scanner results without a matching title.",
                },
                {
                  value: "STAGE_ALL",
                  label: "Stage every result",
                  description:
                    "Send every scanner result through intake review.",
                },
              ]}
            />
          </div>
          {create.error === null ? null : (
            <p className="text-[12px] text-danger">{create.error.message}</p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={name.trim() === "" || sourceLabel.trim() === ""}
            onClick={() =>
              create.mutate(undefined, {
                onSuccess: () => {
                  setName("");
                  setSourceLabel("");
                  onOpenChange(false);
                },
              })
            }
          >
            Add profile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function cadenceLabel(hours: number): string {
  if (hours === 24) return "day";
  if (hours === 168) return "week";
  if (hours === 720) return "30 days";
  return `${hours} hours`;
}
